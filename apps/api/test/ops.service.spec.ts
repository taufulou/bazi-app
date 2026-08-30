import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { OpsService, __testables } from '../src/admin/ops.service';
import { AdminController } from '../src/admin/admin.controller';
import {
  absorbRateLimitHeaders,
  resetRateLimitSnapshot,
} from '../src/ai/anthropic-rate-limit';

/**
 * Ob2 — the ops snapshot.
 *
 * The failure this endpoint exists to prevent is pulling the wrong lever during
 * an incident, so the tests are written around the ways it could mislead:
 * disagreeing with the breaker it reports on, ranking the wrong account as the
 * heaviest, or presenting a Redis outage as "nobody used anything today".
 */

const POOLS = {
  reading: { inFlight: 3, queued: 1, limit: 12, peak: 9, admitted: 140, rejected: 2 },
  interactive: { inFlight: 0, queued: 0, limit: 20, peak: 7, admitted: 88, rejected: 0 },
};

function makeService(opts: {
  spend?: Partial<{
    dayUsd: number; monthUsd: number; dayLimitUsd: number; monthLimitUsd: number; enabled: boolean;
  }>;
  quotaKeys?: Record<string, string>;
  truncated?: boolean;
  redisThrows?: boolean;
  spendThrows?: boolean;
  replicas?: string;
} = {}) {
  const spend = {
    dayUsd: 1.5, monthUsd: 20, dayLimitUsd: 50, monthLimitUsd: 400,
    dayKey: '2026-08-28', monthKey: '2026-08', enabled: true, ...opts.spend,
  };
  const store = opts.quotaKeys ?? {};
  const redis = {
    scanKeys: jest.fn(async () => {
      if (opts.redisThrows) throw new Error('ECONNREFUSED');
      return { keys: Object.keys(store), truncated: opts.truncated ?? false };
    }),
    mget: jest.fn(async (keys: string[]) => keys.map((k) => store[k] ?? null)),
  };
  const aiSpend = {
    getSnapshot: async () => {
      if (opts.spendThrows) throw new Error('ECONNREFUSED');
      return spend;
    },
    // Config-derived, so still readable when Redis is down — the service now
    // takes limits and keys from here rather than from the Redis-backed
    // snapshot, which is what lets it degrade instead of 500.
    dailyLimitUsd: spend.dayLimitUsd,
    monthlyLimitUsd: spend.monthLimitUsd,
    dayKey: () => spend.dayKey,
    monthKey: () => spend.monthKey,
    enabled: spend.enabled,
  };
  const service = new OpsService(
    { snapshot: () => POOLS } as never,
    aiSpend as never,
    {
      dayKey: () => '20260828',
      limitFor: (k: string) => ({ reading: 20, chat: 200, fortune: 30 })[k] ?? 0,
    } as never,
    redis as never,
    { get: () => opts.replicas } as never,
  );
  return { service, redis };
}

beforeEach(() => {
  resetRateLimitSnapshot();
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('assembly', () => {
  it('returns every section in one read', async () => {
    absorbRateLimitHeaders(
      new Headers({ 'anthropic-ratelimit-output-tokens-remaining': '9000' }),
      200,
    );
    const { service } = makeService();
    const snap = await service.snapshot();
    expect(Object.keys(snap).sort()).toEqual(
      ['aiBaseUrlEffective', 'aiBaseUrlOverride', 'breaker', 'generatedAt', 'pools', 'quota', 'rateLimit', 'replicas', 'spend'].sort(),
    );
    expect(snap.pools).toEqual(POOLS);
    expect(snap.rateLimit.outputTokensRemaining).toBe(9000);
  });

  it('reports the replica count, because `pools` cannot be read without it', async () => {
    // `pools.reading.limit` of 12 across 2 replicas is a fleet ceiling of 25.
    // Omitting the divisor makes the most important number on the page wrong
    // by exactly the factor nobody would think to apply.
    const { service } = makeService({ replicas: '2' });
    expect((await service.snapshot()).replicas).toBe(2);
  });

  it('defaults the replica count to 1 when unset', async () => {
    expect((await makeService().service.snapshot()).replicas).toBe(1);
  });

  it('reports spend as both absolute and percent-of-cap', async () => {
    const { service } = makeService({ spend: { dayUsd: 12.5, dayLimitUsd: 50 } });
    const snap = await service.snapshot();
    expect(snap.spend.dayUsd).toBe(12.5);
    expect(snap.spend.dayPct).toBe(25);
  });
});

describe('breaker state agrees with the breaker itself', () => {
  it('reports null under both caps', async () => {
    const { service } = makeService();
    expect((await service.snapshot()).breaker).toEqual({ enabled: true, trippedOn: null });
  });

  it('reports daily at exactly the cap — `>=`, matching assertUnderCap', async () => {
    // An ops view using `>` would show "healthy" on the very request that
    // starts returning 503s.
    const { service } = makeService({ spend: { dayUsd: 50, dayLimitUsd: 50 } });
    expect((await service.snapshot()).breaker.trippedOn).toBe('daily');
  });

  it('prefers daily when both have tripped, as assertUnderCap does', async () => {
    const { service } = makeService({
      spend: { dayUsd: 60, dayLimitUsd: 50, monthUsd: 500, monthLimitUsd: 400 },
    });
    expect((await service.snapshot()).breaker.trippedOn).toBe('daily');
  });

  it('reports monthly when only the month is over', async () => {
    const { service } = makeService({ spend: { monthUsd: 400, monthLimitUsd: 400 } });
    expect((await service.snapshot()).breaker.trippedOn).toBe('monthly');
  });

  it('never claims a trip while the breaker is disabled', async () => {
    // With `AI_SPEND_BREAKER_ENABLED=0` nothing is refused, so a "tripped" badge
    // would send an operator hunting a block that is not happening.
    const { service } = makeService({ spend: { dayUsd: 999, enabled: false } });
    expect((await service.snapshot()).breaker).toEqual({ enabled: false, trippedOn: null });
  });
});

describe('L1 — the load-test redirect is visible here', () => {
  const saved = process.env.LOADTEST_ANTHROPIC_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    else process.env.LOADTEST_ANTHROPIC_BASE_URL = saved;
  });

  it('reports null in normal operation', async () => {
    delete process.env.LOADTEST_ANTHROPIC_BASE_URL;
    const { service } = makeService();
    expect((await service.snapshot()).aiBaseUrlOverride).toBeNull();
  });

  it('names the mock when the override is live', async () => {
    // The failure this exists for: the variable is left set after a load test,
    // production talks to a torn-down mock, and the app looks perfectly healthy
    // from every other angle.
    process.env.LOADTEST_ANTHROPIC_BASE_URL = 'http://mock-anthropic.railway.internal:8080';
    const { service } = makeService();
    expect((await service.snapshot()).aiBaseUrlOverride).toBe(
      'http://mock-anthropic.railway.internal:8080',
    );
  });
});

describe('a Redis outage must not take the whole page down', () => {
  it('degrades the spend section instead of 500-ing', async () => {
    // The bug this replaces: `topQuotaConsumers` was guarded and the spend read
    // directly above it was not, so an outage threw out of `snapshot()` and the
    // request failed — taking the pool and rate-limit numbers with it, which
    // come from process memory and were fine. The endpoint whose whole purpose
    // is "open this during an incident" broke during incidents.
    const { service } = makeService({ spendThrows: true });
    const snap = await service.snapshot();

    expect(snap.spend.available).toBe(false);
    expect(snap.pools).toEqual(POOLS); // the point: still there
    expect(snap.rateLimit).toBeDefined();
  });

  it('reports unknown spend as null, never as zero', async () => {
    // A `0` here during a budget incident renders as "nothing spent today",
    // which is the most reassuring possible display of "we have no idea".
    const { service } = makeService({ spendThrows: true });
    const { spend } = await service.snapshot();
    expect(spend.dayUsd).toBeNull();
    expect(spend.monthUsd).toBeNull();
    expect(spend.dayPct).toBeNull();
    expect(spend.monthPct).toBeNull();
  });

  it('still reports the limits and the day keys, which are config not Redis', async () => {
    const { service } = makeService({ spendThrows: true });
    const { spend } = await service.snapshot();
    expect(spend.dayLimitUsd).toBe(50);
    expect(spend.monthLimitUsd).toBe(400);
    expect(spend.dayKey).toBe('2026-08-28');
  });

  it("reports the breaker as 'unknown', which is not the same as healthy", async () => {
    // `null` means "checked, you are fine". Collapsing the two would tell an
    // operator generation is flowing when we cannot tell.
    const { service } = makeService({ spendThrows: true });
    expect((await service.snapshot()).breaker.trippedOn).toBe('unknown');
  });

  it('survives BOTH reads failing at once', async () => {
    // The realistic outage: Redis is down, so neither collaborator works.
    const { service } = makeService({ spendThrows: true, redisThrows: true });
    const snap = await service.snapshot();
    expect(snap.spend.available).toBe(false);
    expect(snap.quota.available).toBe(false);
    expect(snap.pools).toEqual(POOLS);
  });
});

describe('quota top-consumers', () => {
  const keys = {
    'quota:chat:user-light:20260828': '150',
    'quota:reading:user-heavy:20260828': '19',
    'quota:fortune:user-mid:20260828': '25',
  };

  it('ranks by absolute usage, not by percent of limit', async () => {
    // chat 150/200 = 75%, reading 19/20 = 95%. Percent would put the reading
    // user first — but the question is who is spending our money, and 150 chat
    // turns cost more than 19 readings do not.
    const { service } = makeService({ quotaKeys: keys });
    const top = (await service.snapshot()).quota.topConsumers;
    expect(top.map((c) => c.userId)).toEqual(['user-light', 'user-mid', 'user-heavy']);
    expect(top[0]).toMatchObject({ kind: 'chat', used: 150, limit: 200, pctOfLimit: 75 });
  });

  it('scans with SCAN, never KEYS, and scopes to today', async () => {
    const { service, redis } = makeService({ quotaKeys: keys });
    await service.snapshot();
    expect(redis.scanKeys).toHaveBeenCalledWith('quota:*:*:20260828', expect.any(Object));
  });

  it('surfaces truncation instead of passing a sample off as the whole picture', async () => {
    const { service } = makeService({ quotaKeys: keys, truncated: true });
    expect((await service.snapshot()).quota.truncated).toBe(true);
  });

  it('marks the section unavailable on a Redis outage — and still returns the rest', async () => {
    // This is the page you open when things are broken. A 500 here would hide
    // the pool and rate-limit numbers, which come from memory and are fine.
    const { service } = makeService({ redisThrows: true });
    const snap = await service.snapshot();
    expect(snap.quota).toMatchObject({ available: false, topConsumers: [] });
    expect(snap.pools).toEqual(POOLS);
  });

  it('distinguishes "unavailable" from "nobody used anything"', async () => {
    const { service } = makeService({ quotaKeys: {} });
    expect((await service.snapshot()).quota).toMatchObject({
      available: true,
      topConsumers: [],
    });
  });

  it('reports null rather than 0% for a disabled quota', async () => {
    const svc = new OpsService(
      { snapshot: () => POOLS } as never,
      {
        getSnapshot: async () => ({ dayUsd: 0, monthUsd: 0, dayLimitUsd: 50, monthLimitUsd: 400, dayKey: 'd', monthKey: 'm', enabled: true }),
        dailyLimitUsd: 50,
        monthlyLimitUsd: 400,
        dayKey: () => 'd',
        monthKey: () => 'm',
        enabled: true,
      } as never,
      { dayKey: () => '20260828', limitFor: () => 0 } as never,
      {
        scanKeys: async () => ({ keys: ['quota:chat:u1:20260828'], truncated: false }),
        mget: async () => ['5'],
      } as never,
      { get: () => undefined } as never,
    );
    // 0 means DISABLED. Rendering it as 0% would rank an unlimited heavy user
    // below a light limited one.
    expect((await svc.snapshot()).quota.topConsumers[0].pctOfLimit).toBeNull();
  });

  it('skips a key whose value is not a number', async () => {
    const { service } = makeService({ quotaKeys: { 'quota:chat:u1:20260828': 'nope' } });
    expect((await service.snapshot()).quota.topConsumers).toEqual([]);
  });
});

describe('parseQuotaKey', () => {
  const { parseQuotaKey } = __testables;

  it('reads a normal key', () => {
    expect(parseQuotaKey('quota:reading:abc-123:20260828')).toEqual({
      kind: 'reading',
      userId: 'abc-123',
    });
  });

  it('survives a user id containing a colon', () => {
    // Positional indexing would attribute this to `a`, silently.
    expect(parseQuotaKey('quota:chat:a:b:c:20260828')).toEqual({ kind: 'chat', userId: 'a:b:c' });
  });

  it('rejects an unknown kind and a foreign namespace', () => {
    expect(parseQuotaKey('quota:bogus:u:20260828')).toBeNull();
    expect(parseQuotaKey('ai:spend:day:2026-08-28')).toBeNull();
    expect(parseQuotaKey('quota:chat::20260828')).toBeNull();
    expect(parseQuotaKey('nonsense')).toBeNull();
  });
});

/**
 * The wiring. `snapshot()` being correct is worth nothing if no route reaches
 * it — the shape of bug this repo has now hit repeatedly.
 */
describe('the route exists and is guarded', () => {
  it('delegates GET ops to the service', async () => {
    const ops = { snapshot: jest.fn(async () => ({ ok: true })) };
    const controller = new AdminController({} as never, ops as never);
    await expect(controller.getOps()).resolves.toEqual({ ok: true });
    expect(ops.snapshot).toHaveBeenCalledTimes(1);
  });

  it('is mounted under the admin controller, which is AdminGuard-protected', () => {
    // The guard is a class decorator, so no unit call can observe it. Assert on
    // the source: this endpoint exposes per-account usage and spend, and
    // shipping it unguarded is the one mistake that matters here.
    const src = readFileSync(
      join(__dirname, '..', 'src', 'admin', 'admin.controller.ts'),
      'utf8',
    );
    expect(src).toMatch(/@UseGuards\(AdminGuard\)/);
    expect(src).toMatch(/@Controller\('api\/admin'\)/);
    expect(src).toMatch(/@Get\('ops'\)/);
  });
});
