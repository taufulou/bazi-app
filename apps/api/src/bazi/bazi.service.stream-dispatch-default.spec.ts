import { BaziService } from './bazi.service';

/**
 * todo #3 — the `default:` of `_setupStream`'s streamer switch THROWS.
 *
 * With the step-2b allowlist in place no ordinary test can reach `default:` —
 * a HEALTH row is refused before the switch, so "restore
 * `default: streamLifetimeV2`" leaves every test in
 * `bazi.service.self-refusal-refund.spec.ts` green. A guard nothing can reach
 * is decoration (CLAUDE.md § Mutation-test every guard). So this file LOOSENS
 * the allowlist on purpose: it mocks the DTO module so HEALTH is "streamable",
 * which the switch has no `case` for, and asserts what the `default:` does.
 *
 * `jest.mock` is file-scoped, which is why this cannot live in the sibling spec.
 * ⚠️ The harness below is a twin of `buildWith`/`buildDispatch` there — change
 * both together.
 */
jest.mock('./dto/create-reading.dto', () => {
  const actual = jest.requireActual('./dto/create-reading.dto');
  // No out-of-scope bindings inside a mock factory: obtain the enum via requireActual.
  const { ReadingType } = jest.requireActual('@prisma/client');
  return {
    ...actual,
    STREAMABLE_READING_TYPES: [...actual.STREAMABLE_READING_TYPES, ReadingType.HEALTH],
  };
});

describe('BaziService._setupStream — the dispatcher default: throws (simulated loosened allowlist)', () => {
  const USER_ID = 'user-1';

  function build() {
    const observable = () => ({ subscribe: jest.fn() });
    const streamers = {
      streamLifetimeV2: jest.fn().mockReturnValue(observable()),
      streamCareerV2: jest.fn().mockReturnValue(observable()),
      streamAnnualV2: jest.fn().mockReturnValue(observable()),
      streamLoveV2: jest.fn().mockReturnValue(observable()),
    };
    const redis = {
      incrementRateLimit: jest.fn().mockResolvedValue(1),
      getClient: jest.fn().mockReturnValue({ decr: jest.fn().mockResolvedValue(0) }),
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const quota = { consume: jest.fn().mockResolvedValue(undefined) };
    const refundReadingCredit = jest.fn().mockResolvedValue({ refunded: true, amount: 2 });
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const reading = {
      id: 'reading-h', userId: USER_ID, creditsUsed: 2,
      aiInterpretation: null, refundedAt: null, isDegraded: false,
      readingType: 'HEALTH', targetYear: null, calculationData: {},
      birthProfile: { gender: 'MALE', birthDate: new Date('1987-09-06'), birthCity: 'x', hourKnown: true },
    };
    const service = Object.create(BaziService.prototype) as BaziService;
    Object.assign(service, {
      prisma: {
        user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
        baziReading: { findFirst: jest.fn().mockResolvedValue(reading) },
      },
      logger,
      redis,
      aiService: { getMaxStreamedGenerationMs: jest.fn().mockReturnValue(1_260_000), ...streamers },
      aiSpend: { assertUnderCap: jest.fn().mockResolvedValue(undefined) },
      quota,
      creditsService: { refundReadingCredit },
      emitStaticSections: jest.fn(),
    });
    return { service, streamers, redis, quota, refundReadingCredit, logger };
  }

  const run = (svc: BaziService) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any)._setupStream('clerk_1', 'reading-h', { next: jest.fn(), complete: jest.fn() });

  it('the loosened list really lets HEALTH past step 2b (the premise of this file)', async () => {
    const { service, redis } = build();
    await expect(run(service)).rejects.toBeDefined();
    // If the allowlist had refused, no slot would have been taken.
    expect(redis.incrementRateLimit).toHaveBeenCalledTimes(1);
  });

  it('THROWS "Unreachable" instead of narrating LIFETIME over a HEALTH row', async () => {
    const { service, streamers } = build();
    await expect(run(service)).rejects.toThrow(/Unreachable: no streamer for HEALTH/);
    for (const mock of Object.values(streamers)) expect(mock).not.toHaveBeenCalled();
  });

  it('releases the slot and the lock — a throw must not wedge the reading for the lock TTL', async () => {
    const { service, redis } = build();
    await expect(run(service)).rejects.toBeDefined();
    expect(redis.releaseLock).toHaveBeenCalled();
    expect(redis.getClient().decr).toHaveBeenCalled();
  });

  it('does NOT refund — a plain Error is not a self-refusal', async () => {
    const { service, refundReadingCredit } = build();
    await expect(run(service)).rejects.toBeDefined();
    expect(refundReadingCredit).not.toHaveBeenCalled();
  });

  it('has ALREADY consumed a quota unit by the time it fires — documented, and pinned here', async () => {
    // The switch sits below S2/S4. If someone reorders the switch above the
    // quota check (or the reverse), this is where they find out.
    const { service, quota } = build();
    await expect(run(service)).rejects.toBeDefined();
    expect(quota.consume).toHaveBeenCalledTimes(1);
  });

  it('logs at ERROR — on an @Sse route this line is the only operator signal', async () => {
    const { service, logger } = build();
    await expect(run(service)).rejects.toBeDefined();
    const errs = logger.error.mock.calls.flat().join(' ');
    expect(errs).toContain('UNREACHABLE');
    expect(errs).toContain('HEALTH');
    expect(errs).toContain('reading-h');
  });
});
