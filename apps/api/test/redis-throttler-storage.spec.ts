import Redis from 'ioredis';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { RedisThrottlerStorage } from '../src/throttler/redis-throttler.storage';

/**
 * M1(a) — the Redis storage must behave like the bundled in-memory one.
 *
 * Asserting against the REFERENCE rather than against numbers I chose myself:
 * the contract (ms in, seconds out, hits uncounted while blocked, counter reset
 * when a block lapses, and `isBlocked` — not `totalHits` — being what the guard
 * throws on) is defined only by `ThrottlerStorageService`'s implementation. A
 * test full of hand-written expectations would encode my reading of it, which
 * is the thing most likely to be wrong.
 *
 * Needs a real Redis. Skips (loudly) rather than fails when there is none, so
 * the suite still runs in a container that has no Redis — CI's API job has no
 * Redis service, and a silent pass there would be worse than a visible skip.
 */
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let client: Redis;
let available = false;

beforeAll(async () => {
  client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, retryStrategy: () => null });
  try {
    await client.connect();
    await client.ping();
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (client) await client.quit().catch(() => undefined);
});

function makeStorage() {
  return new RedisThrottlerStorage({ getClient: () => client } as never);
}

const TTL = 60_000;
const BLOCK = 60_000;
const LIMIT = 3;

describe('RedisThrottlerStorage — parity with the bundled reference', () => {
  it('matches ThrottlerStorageService hit-for-hit through and past the limit', async () => {
    if (!available) return void console.warn('SKIPPED: no Redis at ' + REDIS_URL);

    const key = `paritytest:${Date.now()}:${Math.random()}`;
    await client.del(`throttle:default:${key}`, `throttle:default:${key}:blocked`);

    const mine = makeStorage();
    const reference = new ThrottlerStorageService();

    // Walk well past the limit — the interesting transitions are at limit and
    // limit+1, and the reference stops counting once blocked.
    for (let i = 1; i <= LIMIT + 3; i++) {
      const a = await mine.increment(key, TTL, LIMIT, BLOCK, 'default');
      const b = await reference.increment(key, TTL, LIMIT, BLOCK, 'default');

      expect({ hit: i, totalHits: a.totalHits, isBlocked: a.isBlocked }).toEqual({
        hit: i,
        totalHits: b.totalHits,
        isBlocked: b.isBlocked,
      });
      // seconds, not ms — off-by-1000 here would make Retry-After nonsense
      expect(a.timeToExpire).toBeGreaterThan(0);
      expect(a.timeToExpire).toBeLessThanOrEqual(TTL / 1000);
    }
    reference.onApplicationShutdown();
  });

  it('sets isBlocked exactly when the limit is exceeded — the flag the guard throws on', async () => {
    if (!available) return void console.warn('SKIPPED: no Redis');

    const key = `blocktest:${Date.now()}:${Math.random()}`;
    const s = makeStorage();

    for (let i = 1; i <= LIMIT; i++) {
      const r = await s.increment(key, TTL, LIMIT, BLOCK, 'default');
      expect(r.isBlocked).toBe(false); // at the limit is still allowed
      expect(r.totalHits).toBe(i);
    }
    const over = await s.increment(key, TTL, LIMIT, BLOCK, 'default');
    expect(over.isBlocked).toBe(true);
    expect(over.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('two callers with different keys do not share a bucket', async () => {
    if (!available) return void console.warn('SKIPPED: no Redis');
    const s = makeStorage();
    const a = `iso-a:${Date.now()}:${Math.random()}`;
    const b = `iso-b:${Date.now()}:${Math.random()}`;

    for (let i = 0; i < LIMIT + 1; i++) await s.increment(a, TTL, LIMIT, BLOCK, 'default');
    const other = await s.increment(b, TTL, LIMIT, BLOCK, 'default');

    expect(other.isBlocked).toBe(false);
    expect(other.totalHits).toBe(1);
  });

  it('is atomic under concurrency — 20 parallel hits produce exactly 20', async () => {
    if (!available) return void console.warn('SKIPPED: no Redis');
    // A MULTI-based read-modify-write loses updates here; the Lua script cannot.
    const s = makeStorage();
    const key = `race:${Date.now()}:${Math.random()}`;

    const results = await Promise.all(
      Array.from({ length: 20 }, () => s.increment(key, TTL, 1000, BLOCK, 'default')),
    );
    expect(new Set(results.map((r) => r.totalHits)).size).toBe(20);
    expect(Math.max(...results.map((r) => r.totalHits))).toBe(20);
  });

  it('separate throttler names do not collide on the same tracker', async () => {
    if (!available) return void console.warn('SKIPPED: no Redis');
    const s = makeStorage();
    const key = `named:${Date.now()}:${Math.random()}`;

    await s.increment(key, TTL, LIMIT, BLOCK, 'default');
    const other = await s.increment(key, TTL, LIMIT, BLOCK, 'strict');
    expect(other.totalHits).toBe(1);
  });

  it('FAILS OPEN when Redis is unreachable, rather than 500ing every route', async () => {
    const dead = new RedisThrottlerStorage({
      getClient: () => ({ eval: () => Promise.reject(new Error('ECONNREFUSED')) }),
    } as never);

    const r = await dead.increment('anything', TTL, LIMIT, BLOCK, 'default');
    expect(r.isBlocked).toBe(false);
    expect(r.totalHits).toBe(0);
    expect(r.timeToExpire).toBe(TTL / 1000);
  });
});
