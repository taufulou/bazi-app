import { BaziService } from './bazi.service';
import { AIService, AI_MAX_TOTAL_TIME_MS } from '../ai/ai.service';

/**
 * Anything held for the duration of an AI generation must be sized from the
 * generation's WALL-CLOCK BOUND, never from a per-call timeout.
 *
 * Three values got this wrong, all justified against `AI_STREAM_TIMEOUT_MS`:
 *
 *   • `stream:reading:{id}` lock          330s  — double Anthropic spend
 *   • `ai:generate:comparison:{id}` lock   60s  — same, on a 3-credit purchase
 *   • the first-generation in-flight window 360s — double USER credit charge
 *
 * The reasoning failed because `AI_MAX_TOTAL_TIME_MS` (900s) gates the START of
 * an attempt rather than aborting one in flight, so a generation admitted just
 * under the budget runs a further full per-call timeout on top of it — and a V2
 * generation makes two such calls, each with retries and a provider-fallback
 * loop. A per-call timeout is not an upper bound on anything.
 *
 * These tests assert the DERIVATION, not a magic number, so they keep holding
 * when the timeouts are retuned via env.
 */
describe('generation wall-clock bounds', () => {
  const cfg = (values: Record<string, string>) => ({
    get: (k: string) => values[k],
  });

  function ai(values: Record<string, string>, providerCount = 3): AIService {
    const svc = Object.create(AIService.prototype) as AIService;
    Object.assign(svc, {
      configService: cfg(values),
      providers: Array.from({ length: providerCount }, () => ({})),
    });
    return svc;
  }

  describe('AIService.getMaxStreamedGenerationMs', () => {
    it('is the total budget PLUS one call timeout, not either alone', () => {
      const svc = ai({ AI_STREAM_TIMEOUT_MS: '300000' });
      expect(svc.getMaxStreamedGenerationMs()).toBe(AI_MAX_TOTAL_TIME_MS + 300_000);
      // the two ways of getting this wrong
      expect(svc.getMaxStreamedGenerationMs()).toBeGreaterThan(300_000);
      expect(svc.getMaxStreamedGenerationMs()).toBeGreaterThan(AI_MAX_TOTAL_TIME_MS);
    });

    it('tracks the configured call timeout rather than hardcoding it', () => {
      expect(ai({ AI_STREAM_TIMEOUT_MS: '450000' }).getMaxStreamedGenerationMs())
        .toBe(AI_MAX_TOTAL_TIME_MS + 450_000);
    });

    it('falls back through AI_CALL_TIMEOUT_MS then the built-in default', () => {
      expect(ai({ AI_CALL_TIMEOUT_MS: '60000' }).getMaxStreamedGenerationMs())
        .toBe(AI_MAX_TOTAL_TIME_MS + 60_000);
      expect(ai({}).getMaxStreamedGenerationMs())
        .toBe(AI_MAX_TOTAL_TIME_MS + 180_000);
    });
  });

  describe('AIService.getMaxCompatGenerationMs', () => {
    // The 3 compat calls run in PARALLEL, so one timeout covers all three — but
    // the whole set is retried against each provider in a loop with no budget
    // check, which is what makes providers the multiplier.
    it('scales with provider count, not with the 3 parallel calls', () => {
      const values = { AI_COMPAT_V2_TIMEOUT_MS: '300000' };
      expect(ai(values, 1).getMaxCompatGenerationMs()).toBe(300_000);
      expect(ai(values, 3).getMaxCompatGenerationMs()).toBe(900_000);
    });

    it('never returns 0 when no provider is configured', () => {
      expect(ai({ AI_COMPAT_V2_TIMEOUT_MS: '300000' }, 0).getMaxCompatGenerationMs())
        .toBe(300_000);
    });
  });

  describe('BaziService lock TTLs', () => {
    const USER_ID = 'user-1';
    const MARGIN_S = 60;

    function build(aiSvc: AIService, acquired: boolean) {
      const acquireLock = jest.fn().mockResolvedValue(acquired);
      const service = Object.create(BaziService.prototype) as BaziService;
      Object.assign(service, {
        aiService: aiSvc,
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        prisma: {
          user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
          baziReading: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'reading-1', userId: USER_ID, creditsUsed: 3,
              aiInterpretation: null, refundedAt: null, isDegraded: false,
              readingType: 'LIFETIME', calculationData: {}, birthProfile: null,
            }),
          },
        },
        redis: {
          acquireLock,
          releaseLock: jest.fn().mockResolvedValue(undefined),
          incrementRateLimit: jest.fn().mockResolvedValue(1),
          getClient: () => ({ decr: jest.fn().mockResolvedValue(1) }),
        },
      });
      return { service, acquireLock };
    }

    // Returning false short-circuits with a 409 the moment the TTL has been
    // handed to Redis — the argument is captured without running a generation.
    async function ttlPassedToLock(aiSvc: AIService): Promise<number> {
      const { service, acquireLock } = build(aiSvc, false);
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any)._setupStream('clerk_1', 'reading-1', { next: jest.fn(), complete: jest.fn() }),
      ).rejects.toThrow(/already being generated/);
      return acquireLock.mock.calls.find(
        (c: unknown[]) => String(c[0]).startsWith('stream:reading:'),
      )![1] as number;
    }

    it('sizes the reading lock so it CANNOT expire under a live generation', async () => {
      const aiSvc = ai({ AI_STREAM_TIMEOUT_MS: '300000' });
      const ttl = await ttlPassedToLock(aiSvc);
      expect(ttl).toBe(Math.ceil(aiSvc.getMaxStreamedGenerationMs() / 1000) + MARGIN_S);
      expect(ttl * 1000).toBeGreaterThan(aiSvc.getMaxStreamedGenerationMs());
    });

    it('is no longer the hardcoded 330s that could expire mid-generation', async () => {
      const ttl = await ttlPassedToLock(ai({ AI_STREAM_TIMEOUT_MS: '300000' }));
      expect(ttl).not.toBe(330);
      expect(ttl).toBeGreaterThan(330);
    });

    it('follows the configured timeout rather than a constant', async () => {
      const a = await ttlPassedToLock(ai({ AI_STREAM_TIMEOUT_MS: '300000' }));
      const b = await ttlPassedToLock(ai({ AI_STREAM_TIMEOUT_MS: '600000' }));
      expect(b).toBeGreaterThan(a);
      expect(b - a).toBe(300);
    });
  });

  describe('BaziService compat reveal lock TTL', () => {
    // The bound itself is covered above; this covers the WIRING. Testing only
    // the helper is the "well-covered helper behind untested wiring" shape that
    // keeps producing bugs in this repo — the 60s literal lived here, not in
    // the helper, so nothing above would have caught it.
    const USER_ID = 'user-1';

    async function ttlPassedToCompatLock(aiSvc: AIService): Promise<number> {
      const acquireLock = jest.fn().mockResolvedValue(true);
      const comparison = {
        id: 'cmp-1', userId: USER_ID, aiInterpretation: null, paidAt: null,
        comparisonType: 'ROMANCE', calculationData: {},
        profileA: { gender: 'MALE', birthDate: new Date('1990-01-01'), birthTime: '08:00', birthCity: 'X' },
        profileB: { gender: 'FEMALE', birthDate: new Date('1991-02-02'), birthTime: '09:00', birthCity: 'Y' },
      };
      const service = Object.create(BaziService.prototype) as BaziService;
      Object.assign(service, {
        aiService: Object.assign(aiSvc, {
          generateComparisonHash: jest.fn().mockReturnValue('hash'),
          // no cache hit, so execution reaches the lock
          getCachedInterpretation: jest.fn().mockResolvedValue(null),
        }),
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        redis: { acquireLock, releaseLock: jest.fn().mockResolvedValue(undefined) },
        prisma: {
          user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
          baziComparison: {
            findFirst: jest.fn().mockResolvedValue(comparison),
            // freshCheck already has content -> early return, no AI work
            findUnique: jest.fn().mockResolvedValue({ aiInterpretation: { ok: true } }),
          },
        },
        _assertRomanceV2: jest.fn(),
        _chargeForReveal: jest.fn().mockResolvedValue(undefined),
        flattenComparisonResponse: jest.fn().mockReturnValue({}),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).generateComparisonAI('clerk_1', 'cmp-1');
      const call = acquireLock.mock.calls.find(
        (c: unknown[]) => String(c[0]).startsWith('ai:generate:comparison:'),
      );
      expect(call).toBeDefined();
      return call![1] as number;
    }

    it('sizes the compat lock so it CANNOT expire under a live reveal', async () => {
      const aiSvc = ai({ AI_COMPAT_V2_TIMEOUT_MS: '300000' }, 3);
      const expected = aiSvc.getMaxCompatGenerationMs();
      const ttl = await ttlPassedToCompatLock(aiSvc);
      expect(ttl * 1000).toBeGreaterThan(expected);
      expect(ttl).toBe(Math.ceil(expected / 1000) + 60);
    });

    it('is no longer the hardcoded 60s that expired on any slow reveal', async () => {
      const ttl = await ttlPassedToCompatLock(ai({ AI_COMPAT_V2_TIMEOUT_MS: '300000' }, 3));
      expect(ttl).not.toBe(60);
      expect(ttl).toBeGreaterThan(60);
    });
  });

  describe('BaziService.firstGenerationInFlightMs', () => {
    // Pairs with the reading lock: this stops the duplicate ROW and the second
    // CHARGE, the lock stops the duplicate GENERATION. Sized from the same
    // bound or the pair disagrees about whether a generation is still alive.
    function build(aiSvc: AIService) {
      const service = Object.create(BaziService.prototype) as BaziService;
      Object.assign(service, { aiService: aiSvc });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return () => (service as any).firstGenerationInFlightMs() as number;
    }

    it('covers the full generation bound, so a live generation is never read as abandoned', () => {
      const aiSvc = ai({ AI_STREAM_TIMEOUT_MS: '300000' });
      expect(build(aiSvc)()).toBeGreaterThan(aiSvc.getMaxStreamedGenerationMs());
    });

    it('is no longer the hardcoded 360_000 that charged twice mid-generation', () => {
      const aiSvc = ai({ AI_STREAM_TIMEOUT_MS: '300000' });
      expect(build(aiSvc)()).not.toBe(360_000);
      expect(build(aiSvc)()).toBeGreaterThan(360_000);
    });

    it('agrees with the reading lock — one mechanism, one bound', () => {
      const aiSvc = ai({ AI_STREAM_TIMEOUT_MS: '300000' });
      const lockTtlMs = (Math.ceil(aiSvc.getMaxStreamedGenerationMs() / 1000) + 60) * 1000;
      expect(build(aiSvc)()).toBe(lockTtlMs);
    });
  });
});
