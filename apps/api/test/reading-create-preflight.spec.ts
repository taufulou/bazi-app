/**
 * #21a — `createReading` must refuse BEFORE it charges.
 *
 * The create-path `assertUnderCap` lives inside the `else if
 * (!isStreamingRequest)` branch, so a STREAMING request — which is what web and
 * mobile send for every V2 type — reached the credit deduction with nothing
 * checked. The three self-refusals are all raised later, in `_setupStream`.
 *
 * Measured in production 2026-09-02: the spend-cap drill's own refusal took 3
 * credits and delivered nothing. This is the cheap half of the fix; the refund
 * backstop in `_setupStream` covers the races this cannot.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { BaziService } from '../src/bazi/bazi.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AIService } from '../src/ai/ai.service';
import { CreditsService } from '../src/credits/credits.service';
import { QuotaService, QUOTA_EXCEEDED_CODE } from '../src/ai/quota.service';
import { AiSpendService, AI_SPEND_CAP_CODE } from '../src/ai/ai-spend.service';
import { ReadingType } from '@prisma/client';
import { ShutdownService } from '../src/common/shutdown.service';

const mockFetch = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).fetch = mockFetch;

const mockUser = { id: 'user-1', clerkUserId: 'clerk_user_1', credits: 10, subscriptionTier: 'BASIC' };
const mockProfile = {
  id: 'profile-1', userId: 'user-1', name: 'Test',
  birthDate: new Date('1990-05-15'), birthTime: '14:30', birthCity: 'Taipei',
  birthTimezone: 'Asia/Taipei', gender: 'MALE' as const, hourKnown: true,
};
const mockService = { id: 'svc-1', type: ReadingType.LIFETIME, creditCost: 3, isActive: true };

describe('createReading — self-refusal pre-flight runs before the charge', () => {
  let service: BaziService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any, credits: any, quota: any, aiSpend: any, ai: any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(mockUser) },
      birthProfile: { findFirst: jest.fn().mockResolvedValue(mockProfile) },
      service: { findFirst: jest.fn().mockResolvedValue(mockService) },
      baziReading: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (fn: (tx: any) => unknown) =>
          fn({
            user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            baziReading: {
              create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => ({
                id: 'r1',
                ...args.data,
              })),
            },
          }),
      ),
    };
    credits = { deductCredits: jest.fn(), refundReadingCredit: jest.fn(), refundComparisonCredit: jest.fn() };
    quota = { consume: jest.fn(), check: jest.fn(), peek: jest.fn() };
    aiSpend = { assertUnderCap: jest.fn(), record: jest.fn(), recordFailure: jest.fn() };
    ai = {
      generateBirthDataHash: jest.fn().mockReturnValue('hash-test'),
      getCachedInterpretation: jest.fn().mockResolvedValue(null),
      // ⚠️ must resolve: the source chains .catch() on this call.
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
      generateInterpretation: jest.fn(),
      generateLifetimeV2Interpretation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaziService,
        ShutdownService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: { getOrSet: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), del: jest.fn(), acquireLock: jest.fn().mockResolvedValue(true), releaseLock: jest.fn() } },
        { provide: AIService, useValue: ai },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:5001') } },
        { provide: CreditsService, useValue: credits },
        { provide: QuotaService, useValue: quota },
        { provide: AiSpendService, useValue: aiSpend },
      ],
    }).compile();
    service = module.get(BaziService);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', data: { pillars: { year: {}, month: {}, day: {}, hour: {} } } }),
    });
  });

  afterEach(() => jest.clearAllMocks());

  const create = (stream = true) =>
    service.createReading('clerk_user_1', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.LIFETIME,
      stream,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

  it('SPEND CAP: refuses and never opens the charging transaction', async () => {
    aiSpend.assertUnderCap.mockRejectedValue(
      new HttpException({ code: AI_SPEND_CAP_CODE, message: 'over budget' }, HttpStatus.SERVICE_UNAVAILABLE),
    );
    await expect(create()).rejects.toMatchObject({
      response: expect.objectContaining({ code: AI_SPEND_CAP_CODE }),
    });
    // The row and the deduction share one transaction — neither may happen.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('QUOTA: refuses and never opens the charging transaction', async () => {
    quota.check.mockRejectedValue(
      new HttpException({ code: QUOTA_EXCEEDED_CODE, message: 'over quota' }, HttpStatus.TOO_MANY_REQUESTS),
    );
    await expect(create()).rejects.toMatchObject({
      response: expect.objectContaining({ code: QUOTA_EXCEEDED_CODE }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('uses the NON-CONSUMING quota check — `consume` here would burn two units', async () => {
    // `_setupStream` still calls `consume` exactly once. If the pre-flight
    // consumed as well, every reading would cost the user two units of a
    // limit measured in single digits.
    await create();
    expect(quota.check).toHaveBeenCalledWith('reading', 'user-1');
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('checks the CAP before the QUOTA — a refusal we issue must not spend the user allowance', async () => {
    const order: string[] = [];
    aiSpend.assertUnderCap.mockImplementation(async () => { order.push('cap'); });
    quota.check.mockImplementation(async () => { order.push('quota'); });
    await create();
    expect(order).toEqual(['cap', 'quota']);
  });

  it('does NOT block a CACHE HIT — it costs us nothing, so a budget event must not refuse it', async () => {
    // `chargeable` is false for a cache hit, and the pre-flight is gated on
    // `chargeable` precisely so a paid-for interpretation stays servable while
    // the platform is over budget.
    ai.getCachedInterpretation.mockResolvedValue({ sections: { personality: { preview: 'p', full: 'f' } } });
    aiSpend.assertUnderCap.mockRejectedValue(
      new HttpException({ code: AI_SPEND_CAP_CODE, message: 'over budget' }, HttpStatus.SERVICE_UNAVAILABLE),
    );
    await expect(create()).resolves.toBeDefined();
    expect(aiSpend.assertUnderCap).not.toHaveBeenCalled();
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('charges normally when nothing refuses', async () => {
    await expect(create()).resolves.toMatchObject({ streamReady: true });
    expect(credits.deductCredits).toHaveBeenCalledWith(
      'user-1', 3, expect.stringContaining('reading-create'), expect.anything(),
    );
  });

  it('does NOT run for a NON-streaming request — the inline branch already consumed', async () => {
    // ⚠️ Regression guard for a defect this fix introduced and an audit caught.
    //
    // The inline branch runs `assertUnderCap` + `quota.consume` itself. `consume`
    // increments then refuses at `used > limit`, so the LAST allowed reading of
    // the day leaves `used === limit` — and a second, post-increment `check`
    // (`used >= limit`) would refuse it. By then the AI has already run, so the
    // user loses their final quota unit and a real Anthropic call, and gets an
    // error instead of the reading.
    //
    // Gating on `chargeable` reintroduces exactly that. Gating on
    // `isStreamingRequest` is what makes it impossible.
    ai.generateInterpretation.mockResolvedValue({
      interpretation: { summary: 's' }, provider: 'CLAUDE', model: 'm', tokenUsage: {},
    });
    await service.createReading('clerk_user_1', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.HEALTH,
      stream: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // The inline branch owns this path end to end; the pre-flight must stay out.
    expect(quota.check).not.toHaveBeenCalled();
  });
});
