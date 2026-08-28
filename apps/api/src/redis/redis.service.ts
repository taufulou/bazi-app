import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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

  /**
   * Acquire a distributed lock using Redis SET NX EX.
   * Returns true if lock was acquired, false if already held.
   * @param key - Lock key (e.g., 'reading:create:{userId}')
   * @param ttlSeconds - Lock expiry in seconds (prevents deadlock on crash)
   */
  async acquireLock(key: string, ttlSeconds: number = 30): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Release a distributed lock.
   * @param key - Lock key to release
   */
  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Execute a function while holding a distributed lock.
   * Automatically acquires and releases the lock.
   * @throws ConflictException if lock cannot be acquired
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = 30,
  ): Promise<T> {
    const acquired = await this.acquireLock(key, ttlSeconds);
    if (!acquired) {
      throw new Error(`Failed to acquire lock: ${key}`);
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(key);
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
