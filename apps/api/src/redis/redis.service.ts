import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/nestjs';
import Redis from 'ioredis';

/**
 * Compare-and-delete: remove KEYS[1] only if it still holds ARGV[1] (the
 * caller's token). Atomic in Redis, so no other client can slip a new value in
 * between the GET and the DEL.
 */
export const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export type LostLockCause = 'overran_ttl' | 'lost_early' | 'unparseable';

/**
 * Why was a lock gone when its holder released it? Read from the caller's OWN
 * token (`uuid.acquiredAtMs.ttlSeconds`), never from what is stored in Redis —
 * so a mixed fleet mid-deploy (old replicas storing '1') cannot confuse it.
 *
 * - `overran_ttl` — held ≥ TTL: the guarded work outlived its TTL. The TTL is
 *   too short for that work; this is a real defect.
 * - `lost_early` — held < TTL: the key vanished early. Eviction (prod Redis is
 *   `volatile-lru`, and lock keys carry a TTL), a FLUSHALL, a Redis restart, an
 *   old replica's bare DEL during a rolling deploy, or a double / wrong-key
 *   release. The runbook lists the check for each.
 * - `unparseable` — the token is not in our shape. Defensive only.
 */
export function classifyLostLock(
  token: string,
  nowMs: number,
): { cause: LostLockCause; heldMs: number | null; ttlSeconds: number | null } {
  const parts = token.split('.');
  if (parts.length !== 3) return { cause: 'unparseable', heldMs: null, ttlSeconds: null };
  const acquiredAt = Number(parts[1]);
  const ttlSeconds = Number(parts[2]);
  if (!Number.isFinite(acquiredAt) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return { cause: 'unparseable', heldMs: null, ttlSeconds: null };
  }
  const heldMs = Math.max(0, nowMs - acquiredAt);
  return {
    cause: heldMs >= ttlSeconds * 1000 ? 'overran_ttl' : 'lost_early',
    heldMs,
    ttlSeconds,
  };
}

/**
 * Every lock key prefix in use — each is `<prefix>:<one id>`. Sentry only ever
 * receives a value from THIS list, so "no id reaches Sentry" holds by
 * construction: a future key shaped differently (say `user:<id>:lock`) reports
 * `'other'` rather than leaking the id that stripping a last segment would
 * leave behind. Add a new lock's prefix here.
 */
export const KNOWN_LOCK_PREFIXES = [
  'reading:create',
  'stream:reading',
  'comparison:create',
  'ai:generate:comparison',
  'chat-extend',
  'chat-session-stream',
] as const;

/** The Sentry-safe name of a lock key: its known prefix, or `'other'`. */
export function lockKeyPrefix(key: string): string {
  return KNOWN_LOCK_PREFIXES.find((p) => key.startsWith(`${p}:`)) ?? 'other';
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private configService: ConfigService) {
    this.client = new Redis(this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
  }

  async onModuleInit() {
    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
    this.client.on('connect', () => {
      this.logger.log('Connected to Redis');
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  // ============ Key-Value Operations ============

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // ============ JSON Operations ============

  async getJson<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const json = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, json);
    } else {
      await this.client.set(key, json);
    }
  }

  // ============ Rate Limiting Helpers ============

  /**
   * Increment a rate limit counter with sliding window.
   * Returns the current count after increment.
   */
  async incrementRateLimit(key: string, windowSeconds: number): Promise<number> {
    const multi = this.client.multi();
    multi.incr(key);
    multi.expire(key, windowSeconds);
    const results = await multi.exec();
    if (!results) return 0;
    return (results[0]?.[1] as number) ?? 0;
  }

  async getRateLimit(key: string): Promise<number> {
    const count = await this.client.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * Atomically add a fractional amount to a counter and return the new total.
   *
   * S2's spend ledger. `INCRBYFLOAT` rather than read-modify-write because the
   * counter is incremented from every concurrent AI call, and a lost update here
   * is spend that the breaker never sees.
   *
   * The TTL is refreshed on every increment, which is correct for the day/month
   * keys it serves: each is written throughout its own window, and the TTL is set
   * well beyond that window's length. Do NOT reuse this for a key whose lifetime
   * must not slide.
   */
  async incrByFloat(key: string, amount: number, ttlSeconds: number): Promise<number> {
    const multi = this.client.multi();
    multi.incrbyfloat(key, amount);
    multi.expire(key, ttlSeconds);
    const results = await multi.exec();
    if (!results) return 0;
    // ioredis returns INCRBYFLOAT as a STRING (it is a float, not an integer),
    // unlike the sibling `incrementRateLimit` above, which can cast INCR directly.
    const raw = results[0]?.[1];
    const parsed = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // ============ Cache Operations ============

  /**
   * Get cached value or compute and cache it.
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.setJson(key, value, ttlSeconds);
    return value;
  }

  // ============ Distributed Lock Operations ============
  //
  // ⚠️ OWNERSHIP (todo #23). The value stored under a lock key is a per-holder
  // TOKEN, and release is a compare-and-delete. It used to be the constant '1'
  // with a bare DEL, so a holder whose lock had EXPIRED deleted its
  // SUCCESSOR's lock on the way out — and the mutual exclusion then cascaded
  // away for as long as work kept overrunning. Never add a raw `SET … NX` lock,
  // or `del()` a lock key, elsewhere: `test/redis-lock-ownership.guard.spec.ts`
  // fails on both (a static ratchet, not a proof — see its docblock).

  /**
   * Acquire a distributed lock using Redis `SET key <token> EX ttl NX`.
   *
   * Returns an OPAQUE ownership token, or `null` when someone else holds the
   * lock. Pass the token back to {@link releaseLock}; nothing else may parse it.
   *
   * @param key - Lock key (e.g., 'reading:create:{userId}')
   * @param ttlSeconds - REQUIRED. Derive it from the bound of the work the lock
   *   guards — a lock that expires under a live holder stops excluding anyone.
   *   (It used to default to 30, which is how an underived TTL gets copied.)
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    // `uuid.acquiredAtMs.ttlSeconds` — the last two let a failed release say
    // WHY the lock was gone (see `classifyLostLock`), with no extra Redis state.
    // A UUID contains only hex and hyphens, so '.' splits it unambiguously.
    const token = `${randomUUID()}.${Date.now()}.${ttlSeconds}`;
    const result = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  }

  /**
   * Release a lock — ONLY if it still holds this caller's token.
   *
   * Returns `true` when our lock was deleted, `false` otherwise. A `false` from
   * a compare that missed means the lock was gone before we released it: either
   * the guarded work outlived its TTL, or the key vanished early (eviction,
   * FLUSHALL, Redis restart). That is reported as
   * `redis.lock.lost_before_release` — see {@link classifyLostLock}.
   *
   * ⚠️ NEVER throws. Callers `await` this inside a `finally` on CHARGED paths
   * (create, reveal); a throw there turns a reading the user already paid for
   * into a 500. Release is best-effort; the TTL is the backstop. The whole body
   * — the eval, the token parsing, the logging and Sentry — is inside the try.
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    try {
      const deleted = await this.client.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
      if (Number(deleted) === 1) return true;
      this.reportLostLock(key, token);
      return false;
    } catch (err) {
      try {
        this.logger.error(
          `Lock release failed for ${key} — leaving it to its TTL: ` +
            `${err instanceof Error ? err.name : 'error'}`,
        );
      } catch {
        // Nothing left to report with; the promise "never throws" wins.
      }
      return false;
    }
  }

  /**
   * The compare-and-delete RAN and missed: say so. Its own try, so a failure to
   * REPORT (a throwing logger or Sentry) is not mis-logged as a failed release —
   * by now the release question is already answered.
   */
  private reportLostLock(key: string, token: string): void {
    try {
      const { cause, heldMs, ttlSeconds } = classifyLostLock(token, Date.now());
      const lockPrefix = lockKeyPrefix(key);
      // The full key (with its id) stays in OUR log, as other logs already
      // carry these ids. Only a KNOWN prefix goes to Sentry.
      this.logger.warn(
        `Lock ${key} was not held at release (cause=${cause}, held=${heldMs ?? '?'}ms, ` +
          `ttl=${ttlSeconds ?? '?'}s)`,
      );
      Sentry.captureMessage('redis.lock.lost_before_release', {
        level: 'warning',
        tags: { lockPrefix, cause },
        extra: { heldMs, ttlSeconds },
        fingerprint: ['redis.lock.lost_before_release', lockPrefix, cause],
      });
    } catch {
      // Reporting is best-effort; releaseLock's promise is "never throws".
    }
  }

  /**
   * Execute a function while holding a distributed lock.
   * Automatically acquires and releases the lock (by token).
   * @param ttlSeconds - REQUIRED, see {@link acquireLock}.
   * @throws Error if the lock cannot be acquired
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    const token = await this.acquireLock(key, ttlSeconds);
    if (!token) {
      throw new Error(`Failed to acquire lock: ${key}`);
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(key, token);
    }
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Ob2 — enumerate keys matching a glob, bounded.
   *
   * ⚠️ SCAN, never KEYS. `KEYS` is O(N) over the entire keyspace and blocks the
   * single-threaded server for the whole walk, so on a production instance it
   * is an outage waiting for the first admin who opens the ops page while the
   * cache is warm. SCAN is incremental and yields between passes.
   *
   * Two bounds, because SCAN alone is not one:
   *
   * - `limit` caps what we return. The caller only ever renders a top-N.
   * - `maxIterations` caps the walk itself. SCAN's cursor is only guaranteed to
   *   terminate on a keyspace that is not growing faster than we read it; an
   *   unbounded loop against a hot Redis is a hang in a request handler.
   *
   * Returns `{ keys, truncated }` rather than a bare array so a caller can say
   * "top 10 of at least 500" instead of silently presenting a partial scan as
   * the whole picture.
   */
  async scanKeys(
    match: string,
    { limit = 500, count = 200, maxIterations = 50 }: {
      limit?: number;
      count?: number;
      maxIterations?: number;
    } = {},
  ): Promise<{ keys: string[]; truncated: boolean }> {
    const keys: string[] = [];
    let cursor = '0';
    let iterations = 0;
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', count);
      cursor = next;
      for (const k of batch) {
        if (keys.length >= limit) return { keys, truncated: true };
        keys.push(k);
      }
      iterations += 1;
      if (iterations >= maxIterations) return { keys, truncated: cursor !== '0' };
    } while (cursor !== '0');
    return { keys, truncated: false };
  }

  /** Ob2 — batched read for the keys `scanKeys` found. */
  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.client.mget(...keys);
  }
}
