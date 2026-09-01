/**
 * AI failure behaviour on the reading-create path.
 *
 * ⚠️ This file previously claimed credits were NOT charged on AI failure while
 * ASSERTING that they were (`creditsUsed` toBe(3), commented "user chose to
 * create reading"). The assertion described the truth; the docblock did not.
 * Production confirmed it: 3 credits taken for a row with no interpretation,
 * `isDegraded: false`, `failedReason: null`, so no refund ever fired.
 *
 * That behaviour is now REVERSED — a deliberate reversal of a recorded product
 * decision, not a slip. An AI failure throws and nothing is charged.
 *
 * ⚠️ V2 types (LIFETIME/CAREER/ANNUAL/LOVE) can no longer reach the inline AI
 * branch at all — they are refused at admission with STREAM_REQUIRED, because
 * a V2 generation needs ~180s against a 60s inline budget. So a test that wants
 * to exercise the inline AI-failure path must use a V1 type (HEALTH), or it
 * will pass against the WRONG error while covering nothing.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BaziService } from '../src/bazi/bazi.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AIService } from '../src/ai/ai.service';
import { CreditsService } from '../src/credits/credits.service';
import { QuotaService } from '../src/ai/quota.service';
import { AiSpendService } from '../src/ai/ai-spend.service';
import { ReadingType } from '@prisma/client';
import { ShutdownService } from '../src/common/shutdown.service';

// ============================================================
// Mock fetch
// ============================================================

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ============================================================
// Test Data
// ============================================================

const mockUser = {
  id: 'user-1',
  clerkUserId: 'clerk_user_1',
  name: 'Test User',
  avatarUrl: null,
  subscriptionTier: 'BASIC',
  credits: 10,
  languagePref: 'ZH_TW',
  deviceFingerprint: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockProfile = {
  id: 'profile-1',
  userId: 'user-1',
  name: 'Test',
  birthDate: new Date('1990-05-15'),
  birthTime: '14:30',
  birthCity: 'Taipei',
  birthTimezone: 'Asia/Taipei',
  birthLongitude: 121.5654,
  birthLatitude: 25.0330,
  gender: 'MALE' as const,
  relationshipTag: 'SELF' as const,
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockService = {
  id: 'svc-1',
  slug: 'bazi-lifetime',
  nameZhTw: '八字終身運',
  nameZhCn: '八字终身运',
  descriptionZhTw: '',
  descriptionZhCn: '',
  type: ReadingType.LIFETIME,
  creditCost: 3,
  isActive: true,
  sortOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ============================================================
// Tests
// ============================================================

describe('AI Failure Graceful Degradation', () => {
  let service: BaziService;
  let prisma: any;
  let aiService: any;

  beforeEach(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn() },
      birthProfile: { findFirst: jest.fn() },
      service: { findFirst: jest.fn() },
      // findFirst added for the Bundle B dedupe lookup (createReading now
      // checks for a reusable prior reading before creating). Defaults to null
      // = "no prior reading", which is what every test here assumes.
      baziReading: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };

    const mockRedis = {
      getOrSet: jest.fn(),
      getJson: jest.fn(),
      setJson: jest.fn(),
      del: jest.fn(),
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };

    const mockAI = {
      generateBirthDataHash: jest.fn().mockReturnValue('hash-test'),
      getCachedInterpretation: jest.fn().mockResolvedValue(null),
      generateInterpretation: jest.fn(),
      generateLifetimeV2Interpretation: jest.fn(),
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfig = {
      get: jest.fn().mockReturnValue('http://localhost:5001'),
    };

    const mockCredits = {
      // Mirror CreditsService.deductCredits behavior using existing mocks
      deductCredits: jest.fn().mockImplementation(async (userId, amount, _reason, opts) => {
        const tx = opts?.tx ?? mockPrisma;
        const updated = await tx.user.updateMany({
          where: { id: userId, credits: { gte: amount } },
          data: { credits: { decrement: amount } },
        });
        if (updated.count === 0) {
          throw new (require('@nestjs/common').BadRequestException)(
            `Insufficient credits (need ${amount})`,
          );
        }
      }),
      refundReadingCredit: jest.fn().mockResolvedValue({ refunded: false, amount: 0 }),
      refundComparisonCredit: jest.fn().mockResolvedValue({ refunded: false, amount: 0 }),
      getBalance: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaziService,
        ShutdownService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: AIService, useValue: mockAI },
        { provide: ConfigService, useValue: mockConfig },
        { provide: CreditsService, useValue: mockCredits },
        // S4 — quota gates reading creation before the credit deduction.
        { provide: QuotaService, useValue: { consume: jest.fn(), peek: jest.fn() } },
        // S2 — the cap pre-check that now runs before every quota consume.
        { provide: AiSpendService, useValue: { assertUnderCap: jest.fn(), record: jest.fn(), recordFailure: jest.fn() } },
      ],
    }).compile();

    service = module.get<BaziService>(BaziService);
    prisma = module.get(PrismaService);
    aiService = module.get(AIService);

    // Mock fetch for Bazi engine (always succeeds)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', data: { pillars: { year: {}, month: {}, day: {}, hour: {} } } }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws AI_CALL_FAILED and charges nothing when all AI providers fail', async () => {
    aiService.generateInterpretation.mockRejectedValue(
      new Error('All AI providers failed'),
    );
    aiService.generateLifetimeV2Interpretation.mockRejectedValue(
      new Error('All AI providers failed'),
    );

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    let savedReadingData: any = null;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const result = await fn({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        baziReading: {
          create: jest.fn().mockImplementation((args: any) => {
            savedReadingData = args.data;
            return { id: 'reading-1', ...args.data };
          }),
        },
      });
      return result;
    });

    // HEALTH, not LIFETIME: a V2 type is refused at admission and would never
    // reach the AI, so this test would pass against STREAM_REQUIRED while
    // proving nothing about the AI-failure path.
    await expect(
      service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.HEALTH,
      }),
    ).rejects.toMatchObject({
      // Assert the CODE, never a bare toThrow — the whole point is that this
      // is the AI failure and not some other rejection.
      response: expect.objectContaining({ code: 'AI_CALL_FAILED' }),
    });

    // No row, and therefore no charge: the AI call precedes the transaction.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(savedReadingData).toBeNull();
  });

  // ⚠️ THE STRUCTURAL BACKSTOP. After the throw above and the STREAM_REQUIRED
  // refusal, no PUBLIC path persists a row without an interpretation — so
  // `chargeable`'s false branch is unreachable in production and every
  // mutation of it passed until this test existed. It is reachable by a
  // generator that RESOLVES with a falsy interpretation, which is exactly the
  // future edit the backstop guards against: charge only for content, never
  // for a resolved-but-empty result.
  it('charges nothing when a generator resolves without an interpretation', async () => {
    aiService.generateInterpretation.mockResolvedValue({
      interpretation: null, provider: 'CLAUDE', model: 'm', tokenUsage: {},
    });

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    // Typed rather than `any`: this file is on the eslint suppressions ratchet,
    // which may only go DOWN. New `any` uses would fail the build.
    let savedReadingData: Record<string, unknown> | null = null;
    const deduct = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { creditsService: { deductCredits: jest.Mock } })
      .creditsService.deductCredits = deduct;
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: {
            create: jest.fn().mockImplementation(
              (args: { data: Record<string, unknown> }) => {
                savedReadingData = args.data;
                return { id: 'reading-empty', ...args.data };
              },
            ),
          },
        }),
    );

    await service.createReading('clerk_user_1', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.HEALTH,
    });

    // Both halves of `chargeable` — the persisted column AND the ledger — must
    // agree, or sum(CreditLedger.amount) == User.credits breaks.
    expect(savedReadingData).not.toBeNull();
    expect((savedReadingData as unknown as { creditsUsed: number }).creditsUsed).toBe(0);
    expect(deduct).not.toHaveBeenCalled();
  });

  it('refuses a V2 reading requested without stream, before calling the engine', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    await expect(
      service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.LIFETIME,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STREAM_REQUIRED' }),
    });

    // Nothing charged, and — THE PLACEMENT GUARANTEE — the Bazi engine was
    // never called, so the caller does not wait ~30s to be told to use
    // streaming. `mockFetch` IS the engine; asserting on the AI generator
    // instead would leave the guard free to drift below the engine call while
    // the test stayed green.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(aiService.generateLifetimeV2Interpretation).not.toHaveBeenCalled();
  });

  // HEALTH (V1) — the only type that still generates INLINE. A V2 type here
  // would be refused at admission and this test would prove nothing.
  it('should include AI interpretation when AI succeeds', async () => {
    const mockAIResult = {
      interpretation: {
        sections: {
          personality: { preview: '概覽', full: '完整分析' },
        },
      },
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-20250514',
      tokenUsage: { inputTokens: 1000, outputTokens: 1500 },
    };

    // HEALTH is V1, so it routes to generateInterpretation — mocking only the
    // V2 generator would leave the V1 one returning undefined and the test
    // would fail against AI_CALL_FAILED rather than exercising success.
    aiService.generateInterpretation.mockResolvedValue(mockAIResult);
    aiService.generateLifetimeV2Interpretation.mockResolvedValue(mockAIResult);

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    let savedReadingData: any = null;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const result = await fn({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        baziReading: {
          create: jest.fn().mockImplementation((args: any) => {
            savedReadingData = args.data;
            return { id: 'reading-2', ...args.data };
          }),
        },
      });
      return result;
    });

    const result = await service.createReading('clerk_user_1', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.HEALTH,
    });

    expect(result).toBeDefined();
    expect(savedReadingData.aiInterpretation).toBeDefined();
    expect(savedReadingData.aiProvider).toBe('CLAUDE');
    // Charged, because an interpretation was produced — the other half of
    // `chargeable`. Guards against a fix that stops charging altogether.
    expect(savedReadingData.creditsUsed).toBe(3);
  });

  it('should release lock even when AI fails', async () => {
    aiService.generateInterpretation.mockRejectedValue(
      new Error('AI provider timeout'),
    );
    aiService.generateLifetimeV2Interpretation.mockRejectedValue(
      new Error('AI provider timeout'),
    );

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);
    prisma.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        baziReading: {
          create: jest.fn().mockResolvedValue({ id: 'reading-3', creditsUsed: 3 }),
        },
      });
    });

    const redis = (service as any).redis;
    // HEALTH so the AI is actually reached; and it now THROWS, so an
    // unawaited-rejection here would fail the suite.
    await expect(
      service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.HEALTH,
      }),
    ).rejects.toThrow();

    // Lock should be released regardless of AI failure
    expect(redis.releaseLock).toHaveBeenCalledWith('reading:create:user-1');
  });

  it('should use cached interpretation when available (no AI call)', async () => {
    const cachedInterpretation = {
      sections: { personality: { preview: 'cached', full: 'cached full' } },
    };

    aiService.getCachedInterpretation.mockResolvedValue(cachedInterpretation);

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    let savedReadingData: any = null;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        baziReading: {
          create: jest.fn().mockImplementation((args: any) => {
            savedReadingData = args.data;
            return { id: 'reading-4', ...args.data };
          }),
        },
      });
    });

    await service.createReading('clerk_user_1', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.LIFETIME,
    });

    // ⚠️ LIFETIME here ON PURPOSE. A V2 type without `stream` is normally
    // refused, but the refusal excludes cache hits — so this doubles as the
    // boundary regression proving STREAM_REQUIRED does not break a cached
    // V2 re-read.
    // Should NOT call generateInterpretation or V2 when cache hit
    expect(aiService.generateInterpretation).not.toHaveBeenCalled();
    expect(aiService.generateLifetimeV2Interpretation).not.toHaveBeenCalled();
    // Should use cached interpretation
    expect(savedReadingData.aiInterpretation).toEqual(cachedInterpretation);
    expect(savedReadingData.aiModel).toBe('cached');
  });

  // HEALTH: a V2 type is now refused BEFORE the engine call, so this would
  // assert against STREAM_REQUIRED instead of the engine failure it exists for.
  it('should handle Bazi engine failure with InternalServerError', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Engine error' }),
    });

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    await expect(
      service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.HEALTH,
      }),
    ).rejects.toThrow('Bazi calculation failed');

    // Credits should NOT be deducted when engine fails
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
