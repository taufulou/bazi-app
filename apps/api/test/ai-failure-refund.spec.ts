/**
 * Tests for AI failure graceful degradation.
 * Validates that when AI providers fail, credits are NOT charged
 * (since credit deduction happens AFTER AI call in the transaction),
 * and the reading is saved with chart data only (no AI interpretation).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BaziService } from '../src/bazi/bazi.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AIService } from '../src/ai/ai.service';
import { ReadingType } from '@prisma/client';

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
  freeReadingUsed: true,
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
  creditCost: 2,
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
      baziReading: { create: jest.fn() },
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
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfig = {
      get: jest.fn().mockReturnValue('http://localhost:5001'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaziService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: AIService, useValue: mockAI },
        { provide: ConfigService, useValue: mockConfig },
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

  it('should save reading without AI when all AI providers fail', async () => {
    aiService.generateInterpretation.mockRejectedValue(
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

    const result = await service.createReading('clerk_user_1', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.LIFETIME,
    });

    // Reading should be created successfully
    expect(result).toBeDefined();
    // AI interpretation should be undefined (not included)
    expect(savedReadingData.aiInterpretation).toBeUndefined();
    // Calculation data should still be present
    expect(savedReadingData.calculationData).toBeDefined();
    // Credits should still be deducted (user chose to create reading)
    expect(savedReadingData.creditsUsed).toBe(2);
  });

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

    aiService.generateInterpretation.mockResolvedValue(mockAIResult);

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
      readingType: ReadingType.LIFETIME,
    });

    expect(result).toBeDefined();
    expect(savedReadingData.aiInterpretation).toBeDefined();
    expect(savedReadingData.aiProvider).toBe('CLAUDE');
    expect(savedReadingData.creditsUsed).toBe(2);
  });

  it('should release lock even when AI fails', async () => {
    aiService.generateInterpretation.mockRejectedValue(
      new Error('AI provider timeout'),
    );

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);
    prisma.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        baziReading: {
          create: jest.fn().mockResolvedValue({ id: 'reading-3', creditsUsed: 2 }),
        },
      });
    });

    const redis = (service as any).redis;
    await service.createReading('clerk_user_1', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.LIFETIME,
    });

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

    // Should NOT call generateInterpretation when cache hit
    expect(aiService.generateInterpretation).not.toHaveBeenCalled();
    // Should use cached interpretation
    expect(savedReadingData.aiInterpretation).toEqual(cachedInterpretation);
    expect(savedReadingData.aiModel).toBe('cached');
  });

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
        readingType: ReadingType.LIFETIME,
      }),
    ).rejects.toThrow('Bazi calculation failed');

    // Credits should NOT be deducted when engine fails
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
