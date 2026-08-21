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
   * KEYS[1] hits counter · KEYS[2] block marker
   * ARGV[1] ttl(ms) · ARGV[2] limit · ARGV[3] blockDuration(ms)
   * → { totalHits, hitsPttl(ms), isBlocked(0|1), blockPttl(ms) }
   */
  private static readonly SCRIPT = `
    local hitsKey, blockKey = KEYS[1], KEYS[2]
    local ttl        = tonumber(ARGV[1])
    local limit      = tonumber(ARGV[2])
    local blockMs    = tonumber(ARGV[3])

    local blockPttl = redis.call('PTTL', blockKey)
    if blockPttl > 0 then
      -- Blocked: the reference does not count hits while blocked.
      local held = tonumber(redis.call('GET', hitsKey) or '0')
      local heldTtl = redis.call('PTTL', hitsKey)
      if heldTtl < 0 then heldTtl = 0 end
      return { held, heldTtl, 1, blockPttl }
    end

    -- Block has lapsed (or never existed). The reference resets the counter
    -- when a block expires, so a lapsed block starts a fresh window rather
    -- than leaving the caller permanently over the limit.
    local current = tonumber(redis.call('GET', hitsKey) or '0')
    if current > limit then
      redis.call('DEL', hitsKey)
    end

    local hits = redis.call('INCR', hitsKey)
    local pttl = redis.call('PTTL', hitsKey)
    if pttl < 0 then
      redis.call('PEXPIRE', hitsKey, ttl)
      pttl = ttl
    end

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

    try {
      const raw = (await this.redis
        .getClient()
        .eval(RedisThrottlerStorage.SCRIPT, 2, hitsKey, blockKey, String(ttl), String(limit), String(blockDuration))) as
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
