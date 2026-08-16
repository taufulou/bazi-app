import { ConfigService } from '@nestjs/config';
import { BaziService } from './bazi.service';

/**
 * Bundle A — `createComparison` is FREE and never delivers a report.
 *
 * ## What this file used to assert (Bundle A0), and why it changed
 *
 * A0 fixed a leak where a warm AI cache made a create return the full paid
 * interpretation for 0 credits. Its lock asserted "a `skipAI` create attaches no
 * AI **and charges the full cost**" — correct while the charge lived at create.
 *
 * Bundle A moved the charge to the reveal, so the second half of that assertion
 * inverts: a create now charges NOTHING. The invariant A0 actually protected —
 * *the paid report never leaves this endpoint for free* — is preserved and
 * strengthened: creation no longer produces an interpretation at all, under any
 * flag, so there is nothing to leak. The legacy `!dto.skipAI` generate/attach
 * branch was deleted outright (it had no caller, and once creation was free it
 * would have handed over a full report for 0 credits).
 *
 * `paidAt: null` is now the thing that makes a row unpaid, and it is what every
 * paywall, reveal guard and chat gate reads.
 */
describe('BaziService.createComparison — free, and never delivers a report', () => {
  const USER_ID = 'user-1';

  let service: BaziService;
  let deductCredits: jest.Mock;
  let createdRow: Record<string, unknown> | undefined;
  let ai: {
    generateCompatibilityRomanceV2: jest.Mock;
    generateInterpretation: jest.Mock;
    getCachedInterpretation: jest.Mock;
    [k: string]: unknown;
  };

  function buildService(opts: { existing?: Record<string, unknown> | null } = {}) {
    createdRow = undefined;
    deductCredits = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, credits: 100 }) },
      birthProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'profile-a', gender: 'MALE', birthDate: new Date('1987-09-06'),
            birthTime: '16:11', birthCity: '吉打', hourKnown: true,
          })
          .mockResolvedValueOnce({
            id: 'profile-b', gender: 'FEMALE', birthDate: new Date('1987-01-25'),
            birthTime: '12:00', birthCity: '台北', hourKnown: true,
          }),
      },
      service: { findFirst: jest.fn().mockResolvedValue({ creditCost: 3, type: 'COMPATIBILITY' }) },
      baziComparison: {
        // same-order lookup, then reversed-pair lookup
        findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createdRow = data;
          return { id: 'comparison-1', ...data, profileA: {}, profileB: {} };
        }),
      },
    };

    const redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };

    ai = {
      generateComparisonHash: jest.fn().mockReturnValue('hash-abc'),
      getCachedInterpretation: jest.fn().mockResolvedValue({ sections: { o: { preview: 'p', full: 'f' } } }),
      generateCompatibilityRomanceV2: jest.fn().mockResolvedValue({ interpretation: {}, provider: 'CLAUDE', model: 'm' }),
      generateInterpretation: jest.fn().mockResolvedValue({ interpretation: {}, provider: 'CLAUDE', model: 'm' }),
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
    };

    service = new BaziService(
      prisma as never, redis as never,
      { get: () => 'http://engine.test:5001' } as unknown as ConfigService,
      ai as never, { deductCredits } as never,
      { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never,
    );

    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, 'callBaziCompatibility')
      .mockResolvedValue({ chartA: {}, chartB: {}, romancePreAnalysis: {} });

    return service;
  }

  /**
   * `skipAI` is OMITTED from the wire when falsy — see the
   * `...(params.skipAI && { skipAI: true })` spread in
   * `readings-api.ts::createBaziCompatibility`. So the non-skip case must be
   * exercised key-absent — that is the shape a real client sends.
   */
  const dto = (skipAI?: boolean) =>
    ({
      profileAId: 'profile-a',
      profileBId: 'profile-b',
      comparisonType: 'ROMANCE',
      ...(skipAI !== undefined && { skipAI }),
    }) as never;

  it.each([
    ['skipAI: true', true],
    ['skipAI omitted (production shape)', undefined],
    ['skipAI: false (explicit)', false],
  ])('creates FREE and unpaid — %s', async (_label, skipAI) => {
    const svc = buildService();

    await svc.createComparison('clerk-1', dto(skipAI));

    // free
    expect(createdRow?.creditsUsed).toBe(0);
    expect(deductCredits).not.toHaveBeenCalled();
    // and explicitly UNPAID — this is what every paywall / reveal guard / chat
    // gate reads. `creditsUsed: 0` alone is not the predicate.
    expect(createdRow?.paidAt).toBeNull();
  });

  it.each([
    ['skipAI: true', true],
    ['skipAI omitted (production shape)', undefined],
    ['skipAI: false (explicit)', false],
  ])('never attaches an interpretation, even on a warm cache — %s', async (_label, skipAI) => {
    // `getCachedInterpretation` is mocked to ALWAYS hit. Before Bundle A this
    // was the leak; the branch that could consume it is now gone entirely.
    const svc = buildService();

    await svc.createComparison('clerk-1', dto(skipAI));

    expect(createdRow?.aiInterpretation).toBeUndefined();
    expect(ai.generateCompatibilityRomanceV2).not.toHaveBeenCalled();
    expect(ai.generateInterpretation).not.toHaveBeenCalled();
  });

  it('stores an ORDERED pairKey — a deliberate A/B swap is a different report', async () => {
    const svc = buildService();

    await svc.createComparison('clerk-1', dto(true));

    // ordered, not sorted: a paid report's prose cannot be re-oriented, so
    // (B,A) is a genuinely different report rather than a duplicate.
    expect(createdRow?.pairKey).toBe('profile-a|profile-b|ROMANCE');
  });

  describe('unpaid comparisons expose charts, not the paid analysis', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flatten = (svc: BaziService, row: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).flattenComparisonResponse(row);

    const rawRow = (paidAt: Date | null) => ({
      id: 'c1',
      paidAt,
      calculationData: {
        chartA: { dayMaster: '戊' },
        chartB: { dayMaster: '甲' },
        comparisonType: 'ROMANCE',
        compatibilityEnhanced: {
          adjustedScore: 85, label: '天生一對',
          dimensionScores: { spousePalace: { findings: ['x'] } },
        },
        romancePreAnalysis: {
          blendedScore: 85,
          blendedLabel: '天生一對',
          scoreBreakdown: { a: 1 },
          postMarriageQuality: { sweetness: { score: 9 } },
          lovePersonalityA: { hourUnknown: true, secret: 'paid' },
          lovePersonalityB: { hourUnknown: false, secret: 'paid' },
        },
      },
    });

    it('strips the scoring analysis while UNPAID', () => {
      const svc = buildService();
      const out = flatten(svc, rawRow(null));
      const calc = out.calculationData as Record<string, unknown>;

      // the paid numbers are gone
      expect(calc.adjustedScore).toBeUndefined();
      expect(calc.label).toBeUndefined();
      expect(calc.dimensionScores).toBeUndefined();
      const rpa = calc.romancePreAnalysis as Record<string, unknown>;
      expect(rpa.blendedScore).toBeUndefined();
      expect(rpa.blendedLabel).toBeUndefined();
      expect(rpa.scoreBreakdown).toBeUndefined();
      expect(rpa.postMarriageQuality).toBeUndefined();
      expect((rpa.lovePersonalityA as Record<string, unknown>).secret).toBeUndefined();
    });

    it('KEEPS the free 排盤 charts and the Romance-V2 routing marker', () => {
      // ⚠️ Both clients route on `romancePreAnalysis` PRESENCE — mobile
      // `compat.tsx` (`isRomance`) and web `reading/compatibility/page.tsx`
      // (`isV2Romance`, both the live and reload/history paths). Drop
      // it and mobile renders the generic gate instead of the 3-point unlock
      // CTA, and web strands the user on an empty view with no way to unlock.
      const svc = buildService();
      const calc = flatten(svc, rawRow(null)).calculationData as Record<string, unknown>;

      expect(calc.chartA).toEqual({ dayMaster: '戊' });
      expect(calc.chartB).toEqual({ dayMaster: '甲' });
      expect(calc.comparisonType).toBe('ROMANCE');
      expect(calc.romancePreAnalysis).toBeDefined();
      // and the pre-paywall 時辰未知 disclosure the CTA renders
      const rpa = calc.romancePreAnalysis as Record<string, unknown>;
      expect((rpa.lovePersonalityA as Record<string, unknown>).hourUnknown).toBe(true);
      expect((rpa.lovePersonalityB as Record<string, unknown>).hourUnknown).toBe(false);
    });

    it('hands over everything once PAID', () => {
      const svc = buildService();
      const calc = flatten(svc, rawRow(new Date())).calculationData as Record<string, unknown>;

      expect(calc.adjustedScore).toBe(85);
      expect(calc.label).toBe('天生一對');
      expect((calc.romancePreAnalysis as Record<string, unknown>).blendedScore).toBe(85);
    });
  });

  it('returns the existing row on a same-order resubmit (no second row)', async () => {
    const existing = {
      id: 'existing-1', userId: USER_ID, comparisonType: 'ROMANCE',
      pairKey: 'profile-a|profile-b|ROMANCE', paidAt: new Date(),
      calculationData: {}, profileA: {}, profileB: {},
    };
    const svc = buildService({ existing });

    const res = await svc.createComparison('clerk-1', dto(true));

    expect(createdRow).toBeUndefined(); // nothing new was created
    expect((res as { id: string }).id).toBe('existing-1');
    expect(deductCredits).not.toHaveBeenCalled();
  });
});
