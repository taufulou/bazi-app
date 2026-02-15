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
}
