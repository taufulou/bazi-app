import { HttpException } from '@nestjs/common';
import { QuotaService, QUOTA_EXCEEDED_CODE, QuotaKind } from '../src/ai/quota.service';

/**
 * S4 — per-user daily quotas.
 *
 * The property that matters is that the Nth+1 attempt is refused and the Nth is
 * not, under concurrency, without the counter being gameable by inducing
 * failures. Most of these tests are about the ways a counter stops counting.
 */

function makeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    incrementRateLimit: jest.fn(async (k: string) => {
      const next = (store.get(k) ?? 0) + 1;
      store.set(k, next);
      return next;
    }),
    getRateLimit: jest.fn(async (k: string) => store.get(k) ?? 0),
  };
}

const make = (env: Record<string, string | number> = {}, redis = makeRedis()) => ({
  svc: new QuotaService(redis as never, { get: (k: string) => env[k] } as never),
  redis,
});

describe('S4 — limits', () => {
  it('uses A4\'s documented defaults', () => {
    const { svc } = make();
    expect(svc.limitFor('reading')).toBe(20);
    expect(svc.limitFor('chat')).toBe(200);
    expect(svc.limitFor('fortune')).toBe(30);
  });

  it('honours an override', () => {
    expect(make({ QUOTA_READINGS_PER_DAY: '3' }).svc.limitFor('reading')).toBe(3);
  });

  it('falls back to the default on a malformed value', () => {
    // A quota is a COUNT. `0.5` is the dangerous one: it is not `=== 0`, so it
    // skips the disable branch, and then `used = 1 > 0.5` blocks that user for
    // the entire day. `'20abc'` parses to 20 under parseFloat, which silently
    // accepts a typo'd env var as a real limit.
    for (const bad of ['', 'abc', '-1', '0.5', '19.9', '20abc', 'Infinity']) {
      expect(make({ QUOTA_READINGS_PER_DAY: bad }).svc.limitFor('reading')).toBe(20);
    }
  });

  it('a fractional limit cannot block a user for the day', async () => {
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '0.5' });
    await expect(svc.consume('reading', 'u1')).resolves.toBeUndefined();
  });

  it('0 disables that quota — the documented rollback', async () => {
    const { svc, redis } = make({ QUOTA_READINGS_PER_DAY: '0' });
    for (let i = 0; i < 50; i++) await svc.consume('reading', 'u1');
    expect(redis.incrementRateLimit).not.toHaveBeenCalled();
  });

  it('disabling one quota does not disable the others', () => {
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '0' });
    expect(svc.limitFor('reading')).toBe(0);
    expect(svc.limitFor('chat')).toBe(200);
  });
});

describe('S4 — day keys', () => {
  it('rolls at Taipei midnight, matching the S2 spend ledger', () => {
    const { svc } = make();
    expect(svc.dayKey(new Date('2026-03-01T16:30:00Z'))).toBe('20260302');
    expect(svc.dayKey(new Date('2026-03-01T15:00:00Z'))).toBe('20260301');
  });
});

describe('S4 — consumption', () => {
  it('allows exactly the limit, then refuses', async () => {
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '3' });
    await svc.consume('reading', 'u1');
    await svc.consume('reading', 'u1');
    await svc.consume('reading', 'u1'); // the 3rd is still allowed
    await expect(svc.consume('reading', 'u1')).rejects.toBeInstanceOf(HttpException);
  });

  it('refuses with a typed 429', async () => {
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '1' });
    await svc.consume('reading', 'u1');
    try {
      await svc.consume('reading', 'u1');
      throw new Error('should have refused');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(429);
      expect(e.getResponse()).toMatchObject({ code: QUOTA_EXCEEDED_CODE, kind: 'reading' });
    }
  });

  it('counts per USER — one user cannot exhaust another', async () => {
    // The whole point: this is the only per-user control of the three.
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '1' });
    await svc.consume('reading', 'u1');
    await expect(svc.consume('reading', 'u1')).rejects.toThrow();
    await expect(svc.consume('reading', 'u2')).resolves.toBeUndefined();
  });

  it('counts per KIND — chat and readings do not share a budget', async () => {
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '1', QUOTA_CHAT_MESSAGES_PER_DAY: '1' });
    await svc.consume('reading', 'u1');
    await expect(svc.consume('chat', 'u1')).resolves.toBeUndefined();
  });

  it('counts per DAY — yesterday does not spend today', async () => {
    const { svc, redis } = make({ QUOTA_READINGS_PER_DAY: '1' });
    // Simulate yesterday's key already at the limit.
    redis.store.set(`quota:reading:u1:20200101`, 99);
    await expect(svc.consume('reading', 'u1')).resolves.toBeUndefined();
  });

  it('is atomic under a concurrent burst — exactly `limit` get through', async () => {
    // Increment-then-compare, not read-then-increment: a read-first
    // implementation lets a burst all observe the same under-limit count and
    // all pass, which is precisely the abuse pattern being rationed.
    const limit = 5;
    const { svc } = make({ QUOTA_READINGS_PER_DAY: String(limit) });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => svc.consume('reading', 'u1')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(limit);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(15);
  });

  it('fails OPEN when Redis is unreachable', async () => {
    // A monitoring outage must not become a full outage; S1 and S2 still apply.
    const redis = makeRedis();
    redis.incrementRateLimit.mockRejectedValue(new Error('redis down'));
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '1' }, redis);
    await expect(svc.consume('reading', 'u1')).resolves.toBeUndefined();
  });

  it('counts the ATTEMPT, so a failure cannot be used to reclaim quota', async () => {
    // Refunding on failure would make the quota gameable by inducing errors,
    // and a failed generation still costs us tokens.
    const { svc, redis } = make({ QUOTA_READINGS_PER_DAY: '2' });
    await svc.consume('reading', 'u1'); // caller then throws — nothing gives it back
    expect(await redis.getRateLimit('quota:reading:u1:' + svc.dayKey())).toBe(1);
  });
});

describe('S4 — peek', () => {
  it('reports usage without consuming', async () => {
    const { svc } = make({ QUOTA_READINGS_PER_DAY: '20' });
    await svc.consume('reading', 'u1');
    expect(await svc.peek('reading', 'u1')).toEqual({ used: 1, limit: 20 });
    expect(await svc.peek('reading', 'u1')).toEqual({ used: 1, limit: 20 });
  });

  it('degrades to 0 rather than throwing when Redis is down', async () => {
    const redis = makeRedis();
    redis.getRateLimit.mockRejectedValue(new Error('redis down'));
    const { svc } = make({}, redis);
    expect(await svc.peek('chat' as QuotaKind, 'u1')).toEqual({ used: 0, limit: 200 });
  });
});
