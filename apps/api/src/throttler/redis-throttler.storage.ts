import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../redis/redis.service';

/**
 * M1(a) — throttle counters in Redis instead of per-process memory.
 *
 * WHY: `@nestjs/throttler`'s default storage is an in-process `Map`. With one
 * replica that is merely lossy across restarts; at M8's two replicas it means
 * the effective limit is N× what the config says, because each replica counts
 * its own share. A limit that silently doubles when you scale is not a limit.
 *
 * ⚠️ THE CONTRACT IS NOT OBVIOUS — mirrored from the bundled
 * `ThrottlerStorageService`, which is the only real specification:
 *
 *  - `ttl` and `blockDuration` arrive in MILLISECONDS.
 *  - `timeToExpire` and `timeToBlockExpire` are returned in SECONDS
 *    (`Math.ceil`), because the guard writes them straight into `Retry-After`.
 *  - **The guard throws on `isBlocked`, NOT on `totalHits > limit`**
 *    (`throttler.guard.js` — `if (isBlocked) { … throwThrottlingException }`).
 *    So a storage that counts perfectly but never sets `isBlocked` disables
 *    rate limiting completely while looking healthy. That is the failure this
 *    class is most likely to have, so it is the one the tests target hardest.
 *  - `blockDuration` defaults to `ttl` when unset, so blocking IS live for us
 *    even though nothing configures it.
 *  - While blocked, hits are NOT counted; when the block lapses the counter
 *    resets and the current request counts as hit 1.
 *
 * Atomicity via a single Lua script: the read-modify-write spans several
 * commands, and under concurrency a MULTI pipeline would let two requests both
 * observe "not yet over the limit". Redis runs a script to completion, so the
 * whole decision is one atomic step. This matters most for exactly the traffic
 * a rate limiter exists to stop.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  /** Warn once, not once per request, if Redis is unreachable. */
  private warned = false;

  constructor(private readonly redis: RedisService) {}

  /**
   * KEYS[1] hit log (sorted set) · KEYS[2] block marker
   * ARGV[1] ttl(ms) · ARGV[2] limit · ARGV[3] blockDuration(ms) · ARGV[4] unique member
   * → { totalHits, hitsPttl(ms), isBlocked(0|1), blockPttl(ms) }
   *
   * A SLIDING window (sorted set of hit timestamps), not a fixed one.
   *
   * ⚠️ The obvious implementation — INCR plus PEXPIRE on first hit — is a fixed
   * window, and it is NOT what the reference does: `setExpirationTime` schedules
   * a decrement per individual hit, so hits age out one by one. The difference
   * is not academic. Under a fixed window a caller who places one hit early and
   * then bursts at the boundary gets a whole fresh allowance immediately,
   * sustaining ~2x the configured rate indefinitely — on `/payments/upgrade`
   * that is 10/min against a limit of 5. Measured, not theorised.
   *
   * ZREMRANGEBYSCORE drops anything older than the window before counting, so
   * the count is always "hits in the last `ttl` ms", which is what the limit is
   * supposed to mean.
   *
   * Time comes from Redis's own clock (`TIME`), not the app's: with several API
   * replicas, clock skew between them would otherwise shift the window per
   * caller. `TIME` makes the script non-deterministic, which is fine — Redis
   * has replicated script EFFECTS rather than the script itself since 5.0.
   */
  private static readonly SCRIPT = `
    local hitsKey, blockKey = KEYS[1], KEYS[2]
    local ttl     = tonumber(ARGV[1])
    local limit   = tonumber(ARGV[2])
    local blockMs = tonumber(ARGV[3])
    local member  = ARGV[4]

    local t = redis.call('TIME')
    local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)

    local blockPttl = redis.call('PTTL', blockKey)
    if blockPttl > 0 then
      -- Blocked: the reference does not count hits while blocked.
      local held = redis.call('ZCARD', hitsKey)
      local heldTtl = redis.call('PTTL', hitsKey)
      if heldTtl < 0 then heldTtl = 0 end
      return { held, heldTtl, 1, blockPttl }
    end

    -- Age out everything older than the window, then record this hit. PEXPIRE
    -- is unconditional so the key can never outlive its contents.
    redis.call('ZREMRANGEBYSCORE', hitsKey, 0, now - ttl)
    redis.call('ZADD', hitsKey, now, member)
    redis.call('PEXPIRE', hitsKey, ttl)

    local hits = redis.call('ZCARD', hitsKey)
    local pttl = redis.call('PTTL', hitsKey)
    if pttl < 0 then pttl = ttl end

    local isBlocked = 0
    local blockRemaining = 0
    if hits > limit and blockMs > 0 then
      redis.call('SET', blockKey, '1', 'PX', blockMs)
      isBlocked = 1
      blockRemaining = blockMs
    end

    return { hits, pttl, isBlocked, blockRemaining }
  `;

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;

    // Validate BEFORE the script runs. A non-numeric `ttl` makes Lua's
    // `tonumber` return nil, and the failure then lands on PEXPIRE — after ZADD
    // has already committed, leaving a key with no expiry that grows forever.
    // Nothing passes a dynamic value today; this is here so that when something
    // does, it fails loudly at the boundary instead of leaking keys.
    if (!Number.isFinite(ttl) || !Number.isFinite(limit) || !Number.isFinite(blockDuration)) {
      throw new TypeError(
        `Throttler storage got a non-numeric argument (ttl=${ttl}, limit=${limit}, ` +
          `blockDuration=${blockDuration}) for "${throttlerName}"`,
      );
    }

    try {
      const raw = (await this.redis
        .getClient()
        .eval(
          RedisThrottlerStorage.SCRIPT,
          2,
          hitsKey,
          blockKey,
          String(ttl),
          String(limit),
          String(blockDuration),
          // Unique per hit — the sorted set stores one member per request, and
          // a repeated member would overwrite rather than add.
          `${Date.now()}-${randomUUID()}`,
        )) as
        | [number, number, number, number]
        | null;

      if (!raw) throw new Error('empty EVAL reply');
      const [totalHits, hitsPttl, isBlocked, blockPttl] = raw;

      return {
        totalHits,
        timeToExpire: Math.ceil(hitsPttl / 1000),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: Math.ceil(blockPttl / 1000),
      };
    } catch (err) {
      // ⚠️ FAIL OPEN, deliberately and narrowly.
      //
      // Redis being down must not take the API down with it: every request on
      // every route passes through here. The cost of failing open is that rate
      // limits lapse during a Redis outage; the cost of failing closed is a
      // total outage triggered by a cache. S1/S2/S4 (concurrency governor,
      // spend cap, per-user quota) are the controls that actually bound spend,
      // and they are not in this path.
      //
      // Logged once rather than per request, because the failure mode here is
      // a flood of identical lines drowning the incident that caused it.
      if (!this.warned) {
        this.warned = true;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Throttler storage is UNAVAILABLE — rate limiting is not being ` +
            `enforced until Redis recovers: ${msg}`,
        );
      }
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
