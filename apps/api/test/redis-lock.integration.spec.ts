import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../src/redis/redis.service';
import { needRedis } from './support/real-redis';

/**
 * todo #23 — the lock's ownership semantics against a REAL Redis.
 *
 * `redis-lock.spec.ts` mocks ioredis, so it can only prove what we SEND. Whether
 * the compare-and-delete actually protects a successor is a property of Redis
 * executing the script, so it is tested here, end to end.
 *
 * Needs a real Redis. CI's `test-api` job provides one and sets
 * `REQUIRE_REDIS_TESTS=1`, under which an unreachable Redis FAILS this spec —
 * a skip there would be green while testing nothing. Elsewhere (a dev machine
 * without Redis, or a sandbox that merely sets the generic `CI` variable) it
 * skips loudly. It is deliberately NOT keyed on `CI`. The rule lives in
 * `test/support/real-redis.ts` (`needRedis`), shared with the throttler spec.
 */
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let probe: Redis;
let service: RedisService | null = null;
let available = false;
const PREFIX = `locktest:${Date.now()}:${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  // Probe with a separate LAZY client first: RedisService's constructor opens a
  // non-lazy connection, and building it against an absent Redis leaks the
  // handle and emits unhandled 'error' events.
  probe = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, retryStrategy: () => null });
  try {
    await probe.connect();
    await probe.ping();
    available = true;
  } catch {
    available = false;
  }
  if (available) {
    service = new RedisService({ get: () => REDIS_URL } as unknown as ConfigService);
    // Silence the expected lost-lock warnings in test output.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  }
});

afterAll(async () => {
  if (available) {
    // Explicit list, not KEYS — this may run against a shared dev Redis.
    await probe.del(...['hazard', 'held', 'owner', 'ttl', 'reply'].map((k) => `${PREFIX}:${k}`));
  }
  if (service) await service.onModuleDestroy();
  if (probe) await probe.quit().catch(() => undefined);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RedisService lock ownership — real Redis', () => {
  it('THE HAZARD: an expired holder releasing does NOT delete its successor\'s lock', async () => {
    if (!needRedis(available, REDIS_URL)) return;
    const key = `${PREFIX}:hazard`;

    const tokenA = await service!.acquireLock(key, 30);
    expect(tokenA).not.toBeNull();

    // A's lock expires while A is still working.
    await probe.pexpire(key, 1);
    await sleep(20);
    expect(await probe.exists(key)).toBe(0);

    // B acquires legitimately.
    const tokenB = await service!.acquireLock(key, 30);
    expect(tokenB).not.toBeNull();
    expect(tokenB).not.toBe(tokenA);

    // A finishes and releases with ITS token. With the old bare DEL this
    // deleted B's lock and let a third holder in.
    await expect(service!.releaseLock(key, tokenA!)).resolves.toBe(false);
    expect(await probe.get(key)).toBe(tokenB);

    // And B can still release its own.
    await expect(service!.releaseLock(key, tokenB!)).resolves.toBe(true);
    expect(await probe.exists(key)).toBe(0);
  });

  it('a held lock refuses a second acquirer', async () => {
    if (!needRedis(available, REDIS_URL)) return;
    const key = `${PREFIX}:held`;
    const t = await service!.acquireLock(key, 30);
    expect(t).not.toBeNull();
    await expect(service!.acquireLock(key, 30)).resolves.toBeNull();
    await service!.releaseLock(key, t!);
  });

  it('the owner\'s release returns true and removes the key', async () => {
    if (!needRedis(available, REDIS_URL)) return;
    const key = `${PREFIX}:owner`;
    const t = await service!.acquireLock(key, 30);
    await expect(service!.releaseLock(key, t!)).resolves.toBe(true);
    expect(await probe.exists(key)).toBe(0);
  });

  it('releasing an absent key returns false', async () => {
    if (!needRedis(available, REDIS_URL)) return;
    await expect(service!.releaseLock(`${PREFIX}:absent`, 'u.1.30')).resolves.toBe(false);
  });

  it('sets the TTL Redis enforces', async () => {
    if (!needRedis(available, REDIS_URL)) return;
    const key = `${PREFIX}:ttl`;
    const t = await service!.acquireLock(key, 105);
    const ttl = await probe.ttl(key);
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(105);
    await service!.releaseLock(key, t!);
  });

  it('the script reply ioredis hands back is a NUMBER (pins the === 1 check)', async () => {
    if (!needRedis(available, REDIS_URL)) return;
    const key = `${PREFIX}:reply`;
    const t = await service!.acquireLock(key, 30);
    const reply = await probe.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1, key, t!,
    );
    expect(typeof reply).toBe('number');
    expect(reply).toBe(1);
  });
});
