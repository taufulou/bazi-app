import { ConfigService } from '@nestjs/config';
import { BaziService } from './bazi.service';

/**
 * Bundle B — a re-run of the same reading returns the EXISTING row instead of
 * inserting a duplicate.
 *
 * Billing was already correct (`fromCache` charged 0), but a fresh
 * `bazi_readings` row was inserted every time, so 歷史分析記錄 filled with
 * identical entries and its counter became meaningless (one chart showing as
 * 「共84筆」).
 *
 * ⚠️ The dedupe is scoped to (userId, birthProfileId, readingType, targetYear),
 * NOT to the AI cache. The AI cache is GLOBAL — keying on it would hand back a
 * different user's row.
 */
describe('BaziService.createReading — dedupe', () => {
  const USER_ID = 'user-1';
  const PROFILE_ID = 'profile-1';

  let findFirstReading: jest.Mock;
  let createReading: jest.Mock;
  let deductCredits: jest.Mock;
  let getCachedInterpretation: jest.Mock;

  function build(existing: Record<string, unknown> | null) {
    findFirstReading = jest.fn().mockResolvedValue(existing);
    createReading = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'new-reading', ...data,
    }));
    deductCredits = jest.fn().mockResolvedValue(undefined);
    getCachedInterpretation = jest.fn().mockResolvedValue(null);

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, credits: 100, subscriptionTier: 'FREE' }) },
      birthProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROFILE_ID, birthDate: new Date('1987-09-06'), birthTime: '16:11',
          hourKnown: true, birthCity: '吉打', birthTimezone: 'Asia/Kuala_Lumpur',
          birthLongitude: null, birthLatitude: null, gender: 'MALE',
        }),
      },
      service: { findFirst: jest.fn().mockResolvedValue({ creditCost: 1, type: 'LIFETIME' }) },
      baziReading: { findFirst: findFirstReading, create: createReading },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (cb: any) => cb({ baziReading: { create: createReading } })),
    };
    const redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const ai = {
      generateBirthDataHash: jest.fn().mockReturnValue('hash-1'),
      getCachedInterpretation,
      generateLifetimeV2Interpretation: jest.fn().mockResolvedValue({
        interpretation: {}, provider: 'CLAUDE', model: 'm', tokenUsage: {},
      }),
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
    };

    const svc = new BaziService(
      prisma as never, redis as never,
      { get: () => 'http://engine.test' } as unknown as ConfigService,
      ai as never, { deductCredits } as never,
    );
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(svc as any, 'callBaziEngine')
      .mockResolvedValue({ lifetimeEnhancedInsights: { deterministic: { some_key: 1 } } });
    return svc;
  }

  const dto = { birthProfileId: PROFILE_ID, readingType: 'LIFETIME' } as never;
  const streamDto = { birthProfileId: PROFILE_ID, readingType: 'LIFETIME', stream: true } as never;

  const completeRow = (over: Record<string, unknown> = {}) => ({
    id: 'existing-1', userId: USER_ID, birthProfileId: PROFILE_ID,
    readingType: 'LIFETIME', targetYear: null,
    aiInterpretation: { sections: {} }, isDegraded: false, refundedAt: null,
    regenerationCount: 0, calculationData: {}, creditsUsed: 1,
    ...over,
  });

  it('returns the existing reading and creates NO second row', async () => {
    const svc = build(completeRow());

    const res = await svc.createReading('clerk-1', dto);

    expect(createReading).not.toHaveBeenCalled();
    expect((res as { id: string }).id).toBe('existing-1');
    expect(deductCredits).not.toHaveBeenCalled();
  });

  it('preserves the fromCache envelope contract', async () => {
    // web reading/[type]/page.tsx:728 and mobile reading/[type].tsx:321 drive
    // the 「已載入…未扣點」 CacheToast off this flag. Reusing a row without it
    // would charge nothing and say nothing.
    const svc = build(completeRow());

    const res = await svc.createReading('clerk-1', dto);

    expect((res as { fromCache: boolean }).fromCache).toBe(true);
  });

  it.each([
    ['degraded', { isDegraded: true }],
    ['refunded', { refundedAt: new Date() }],
    ['never finished (no AI, no regen)', { aiInterpretation: null, regenerationCount: 0 }],
  ])('does NOT reuse a %s row — it creates a fresh one', async (_label, over) => {
    const svc = build(completeRow(over));

    await svc.createReading('clerk-1', dto);

    // a broken row is what regenerate/retry exists to replace, not something to serve
    expect(createReading).toHaveBeenCalled();
  });

  it('treats a mid-regeneration row as IN FLIGHT and does not charge again', async () => {
    // `regenerateReading` nulls aiInterpretation so the SSE endpoint refills it.
    // A concurrent create in that window must not insert + charge a second time.
    const svc = build(completeRow({ aiInterpretation: null, regenerationCount: 1 }));

    const res = await svc.createReading('clerk-1', streamDto);

    expect(createReading).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
    // and it hands back streamReady, not an empty "cache hit" that would render blank
    expect((res as { streamReady: boolean }).streamReady).toBe(true);
    expect((res as { fromCache: boolean }).fromCache).toBe(false);
    expect((res as { id: string }).id).toBe('existing-1');
    // ⚠️ pinned on THIS branch too — it feeds web's other balance-decrement site
    // (reading/[type]/page.tsx:705), so dropping it reintroduces the phantom
    // credit drop on the regeneration path specifically.
    expect((res as { creditsUsed: number }).creditsUsed).toBe(0);
  });

  it('does NOT re-serve a REFUNDED mid-regeneration row for free', async () => {
    // Reachable: create+charge → stream degrades → regenerate (regenerationCount
    // 1, AI nulled) → the regen fails → refundReadingCredit sets refundedAt and
    // returns the credits. Treating that as "in flight" would hand back
    // streamReady with no charge, and /readings/:id/stream has no payment gate —
    // so the user would keep their refund AND get the full paid report.
    const svc = build(completeRow({
      aiInterpretation: null,
      regenerationCount: 1,
      refundedAt: new Date(),
    }));

    await svc.createReading('clerk-1', streamDto);

    expect(createReading).toHaveBeenCalled();
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });

  it('reports creditsUsed: 0 on reuse — the envelope means "charged by THIS call"', async () => {
    // The stored row keeps its original charge, but the web client decrements
    // the displayed balance by this field while the CacheToast says 「未扣點」.
    const svc = build(completeRow({ creditsUsed: 3 }));

    const res = await svc.createReading('clerk-1', dto);

    expect((res as { creditsUsed: number }).creditsUsed).toBe(0);
    expect((res as { fromCache: boolean }).fromCache).toBe(true);
  });

  it('does not promise a stream that was never requested', async () => {
    const svc = build(completeRow({ aiInterpretation: null, regenerationCount: 1 }));

    const res = await svc.createReading('clerk-1', dto); // no stream flag

    expect((res as { streamReady?: boolean }).streamReady).toBe(false);
  });

  it('scopes the lookup to the user — never keys on the GLOBAL ai cache', async () => {
    const svc = build(completeRow());

    await svc.createReading('clerk-1', dto);

    expect(findFirstReading).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          birthProfileId: PROFILE_ID,
          readingType: 'LIFETIME',
          // pinned: dropping this makes ANNUAL 2026 return the 2025 row
          targetYear: null,
        }),
      }),
    );
  });

  it('creates normally when the user has no prior reading', async () => {
    const svc = build(null);

    await svc.createReading('clerk-1', dto);

    expect(createReading).toHaveBeenCalled();
    expect(deductCredits).toHaveBeenCalledTimes(1);
  });
});
