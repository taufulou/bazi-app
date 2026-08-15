import { ServiceUnavailableException } from '@nestjs/common';
import { AiSpendService, AI_SPEND_CAP_CODE } from '../src/ai/ai-spend.service';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));
import * as Sentry from '@sentry/nestjs';

/**
 * S2 — the spend ledger and circuit breaker.
 *
 * This is the only ceiling on AI spend that we control, so the tests are
 * written around the ways a ceiling silently stops being one: counting in the
 * wrong timezone, under-pricing an unknown model, losing an increment, failing
 * closed on a cache blip, or throwing an error nobody maps to a refund.
 */

/** In-memory Redis with real INCRBYFLOAT semantics (returns the new total). */
function makeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    get: jest.fn(async (k: string) => (store.has(k) ? String(store.get(k)) : null)),
    incrByFloat: jest.fn(async (k: string, amt: number) => {
      const next = (store.get(k) ?? 0) + amt;
      store.set(k, next);
      return next;
    }),
  };
}

function makeService(env: Record<string, string | number> = {}, redis = makeRedis()) {
  const config = { get: (k: string) => env[k] };
  const service = new AiSpendService(redis as never, config as never);
  return { service, redis };
}

beforeEach(() => jest.clearAllMocks());

describe('S2 — pricing', () => {
  it('prices a dated model snapshot via longest-prefix match', () => {
    const { service } = makeService();
    // 1M in + 1M out at Sonnet's $3/$15 — no per-snapshot row needed.
    const cost = service.estimateCostUsd('claude-sonnet-4-5-20250929', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(18, 6);
  });

  it('prefers the longer prefix when several match', () => {
    const { service } = makeService();
    // `gpt-4o-mini` must not be priced as `gpt-4o`.
    const mini = service.estimateCostUsd('gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 0 });
    const full = service.estimateCostUsd('gpt-4o', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(mini).toBeCloseTo(0.15, 6);
    expect(full).toBeCloseTo(2.5, 6);
  });

  it('bills an UNKNOWN model at the most expensive known rate', () => {
    // The load-bearing direction. Under-counting sails past the cap invisibly;
    // over-counting trips it early, which is visible and recoverable.
    const { service } = makeService();
    const unknown = service.estimateCostUsd('some-new-model-v9', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    const opus = service.estimateCostUsd('claude-opus-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(unknown).toBe(opus);
    expect(unknown).toBeGreaterThan(
      service.estimateCostUsd('claude-sonnet-4-5', { inputTokens: 1_000_000, outputTokens: 0 }),
    );
  });

  it('prices cache reads cheaper than input and cache writes dearer', () => {
    // Chat sends a 1h-cached system block on every turn; treating cache reads as
    // full-price input would overstate chat spend several-fold, and treating
    // writes as reads would understate the first turn.
    const { service } = makeService();
    const u = { inputTokens: 0, outputTokens: 0 };
    const read = service.estimateCostUsd('claude-sonnet-4-5', { ...u, cacheReadTokens: 1_000_000 });
    const write = service.estimateCostUsd('claude-sonnet-4-5', { ...u, cacheWriteTokens: 1_000_000 });
    const input = service.estimateCostUsd('claude-sonnet-4-5', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(read).toBeLessThan(input);
    expect(write).toBeGreaterThan(input);
  });

  it('treats missing cache fields as zero, not NaN', () => {
    const { service } = makeService();
    const cost = service.estimateCostUsd('claude-sonnet-4-5', { inputTokens: 100, outputTokens: 100 });
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});

describe('S2 — Asia/Taipei day keys', () => {
  it('rolls the day at Taipei midnight, not UTC midnight', () => {
    // 2026-03-01T16:30Z is already 2026-03-02 in Taipei (UTC+8). A UTC-keyed cap
    // would reset at 08:00 local, splitting the busiest hours across buckets.
    const { service } = makeService();
    expect(service.dayKey(new Date('2026-03-01T16:30:00Z'))).toBe('2026-03-02');
    expect(service.dayKey(new Date('2026-03-01T15:00:00Z'))).toBe('2026-03-01');
  });

  it('derives the month key from the Taipei day, including across a month boundary', () => {
    const { service } = makeService();
    expect(service.monthKey(new Date('2026-03-31T16:30:00Z'))).toBe('2026-04');
  });
});

describe('S2 — recording', () => {
  it('accumulates into both the day and month counters', async () => {
    const { service, redis } = makeService();
    await service.record({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    const keys = [...redis.store.keys()];
    expect(keys.some((k) => k.startsWith('ai:spend:day:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('ai:spend:month:'))).toBe(true);
    expect([...redis.store.values()].every((v) => Math.abs(v - 3) < 1e-6)).toBe(true);
  });

  it('records fallback-provider usage too', async () => {
    // The fallback chain is Claude → GPT-4o → Gemini. Spend on a fallback is
    // still spend; a breaker blind to it under-counts exactly when the primary
    // is failing and retries are highest.
    const { service, redis } = makeService();
    await service.record({
      provider: 'GPT',
      model: 'gpt-4o',
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect([...redis.store.values()][0]).toBeCloseTo(2.5, 6);
  });

  it('never throws when Redis is down — a metering failure is not a request failure', async () => {
    const redis = makeRedis();
    redis.incrByFloat.mockRejectedValue(new Error('redis down'));
    const { service } = makeService({}, redis);

    await expect(
      service.record({ provider: 'CLAUDE', model: 'claude-sonnet-4-5', usage: { inputTokens: 10, outputTokens: 10 } }),
    ).resolves.toBeGreaterThan(0);
  });

  it('skips zero-cost calls', async () => {
    const { service, redis } = makeService();
    await service.record({ provider: 'CLAUDE', model: 'claude-sonnet-4-5', usage: { inputTokens: 0, outputTokens: 0 } });
    expect(redis.incrByFloat).not.toHaveBeenCalled();
  });

  it('warns ONCE at 80% of a cap, not on every subsequent call', async () => {
    const { service } = makeService({ AI_DAILY_SPEND_LIMIT_USD: 10, AI_MONTHLY_SPEND_LIMIT_USD: 10_000 });
    const spend = () =>
      service.record({
        provider: 'CLAUDE',
        model: 'claude-sonnet-4-5',
        usage: { inputTokens: 1_000_000, outputTokens: 0 }, // $3
      });
    await spend(); // 3
    await spend(); // 6
    expect(Sentry.captureMessage).not.toHaveBeenCalledWith('ai.spend.threshold_80', expect.anything());
    await spend(); // 9 → 90%
    await spend(); // 12 → over, but the 80% marker already fired
    const warns = (Sentry.captureMessage as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'ai.spend.threshold_80',
    );
    expect(warns).toHaveLength(1);
  });
});

describe('S2 — the breaker', () => {
  const overspent = async (limitUsd: number, spentUsd: number) => {
    const redis = makeRedis();
    const { service } = makeService(
      { AI_DAILY_SPEND_LIMIT_USD: limitUsd, AI_MONTHLY_SPEND_LIMIT_USD: 100_000 },
      redis,
    );
    redis.store.set(`ai:spend:day:${service.dayKey()}`, spentUsd);
    return service;
  };

  it('allows calls below the cap', async () => {
    const service = await overspent(50, 49.99);
    await expect(service.assertUnderCap()).resolves.toBeUndefined();
  });

  it('throws a typed 503 at the daily cap', async () => {
    const service = await overspent(50, 50);
    await expect(service.assertUnderCap()).rejects.toBeInstanceOf(ServiceUnavailableException);
    try {
      await service.assertUnderCap();
    } catch (err) {
      // The code is what clients branch on, and what the refund path keys off.
      expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
        code: AI_SPEND_CAP_CODE,
      });
    }
  });

  it('throws at the MONTHLY cap even when the day is quiet', async () => {
    const redis = makeRedis();
    const { service } = makeService(
      { AI_DAILY_SPEND_LIMIT_USD: 50, AI_MONTHLY_SPEND_LIMIT_USD: 400 },
      redis,
    );
    redis.store.set(`ai:spend:month:${service.monthKey()}`, 400);
    await expect(service.assertUnderCap()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is disabled by AI_SPEND_BREAKER_ENABLED=0 — the documented rollback', async () => {
    const redis = makeRedis();
    const { service } = makeService(
      { AI_SPEND_BREAKER_ENABLED: '0', AI_DAILY_SPEND_LIMIT_USD: 1 },
      redis,
    );
    redis.store.set(`ai:spend:day:${service.dayKey()}`, 9999);
    await expect(service.assertUnderCap()).resolves.toBeUndefined();
  });

  it('is ENABLED by default — the flag must be opt-OUT', async () => {
    // If this inverts, the ceiling silently stops existing.
    const service = await overspent(50, 50);
    await expect(service.assertUnderCap()).rejects.toThrow();
  });

  it('fails OPEN when Redis is unreachable', async () => {
    // A monitoring outage must not become a full outage; the external account
    // limit is the backstop for this window.
    const redis = makeRedis();
    redis.get.mockRejectedValue(new Error('redis down'));
    const { service } = makeService({}, redis);
    await expect(service.assertUnderCap('reading')).resolves.toBeUndefined();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'ai.spend.breaker_unavailable',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('alerts when the cap trips', async () => {
    const service = await overspent(50, 51);
    await expect(service.assertUnderCap()).rejects.toThrow();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'ai.spend.cap_tripped',
      expect.objectContaining({ level: 'error' }),
    );
  });
});

describe('S2 — limit configuration', () => {
  it('uses the documented defaults', () => {
    const { service } = makeService();
    expect(service.dailyLimitUsd).toBe(50);
    expect(service.monthlyLimitUsd).toBe(400);
  });

  it('falls back to the default for a malformed limit rather than Infinity or 0', async () => {
    // "" would parse to NaN, "0" would block everything, "abc" to NaN. Each of
    // those silently turns the breaker into either a no-op or an outage.
    for (const bad of ['', 'abc', '0', '-5']) {
      const { service } = makeService({ AI_DAILY_SPEND_LIMIT_USD: bad });
      expect(service.dailyLimitUsd).toBe(50);
    }
  });

  it('honours a valid override', () => {
    const { service } = makeService({ AI_DAILY_SPEND_LIMIT_USD: '12.5' });
    expect(service.dailyLimitUsd).toBe(12.5);
  });
});
