/**
 * Tests for Master tier bypass — Master users skip credit deduction entirely.
 * Validates that Master tier gets creditsUsed: 0 for all reading types.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BaziService } from '../src/bazi/bazi.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AIService } from '../src/ai/ai.service';
import { ReadingType } from '@prisma/client';
import {
  ConflictException,
} from '@nestjs/common';

// ============================================================
// Mock fetch (for Bazi engine calls)
// ============================================================

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ============================================================
// Test Data
// ============================================================

const mockMasterUser = {
  id: 'user-master',
  clerkUserId: 'clerk_master',
  name: 'Master User',
  avatarUrl: null,
  subscriptionTier: 'MASTER',
  credits: 0, // Master has 0 credits but should still work
  languagePref: 'ZH_TW',
  freeReadingUsed: true, // Already used free trial
  deviceFingerprint: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockFreeUser = {
  ...mockMasterUser,
  id: 'user-free',
  clerkUserId: 'clerk_free',
  name: 'Free User',
  subscriptionTier: 'FREE',
  credits: 0,
  freeReadingUsed: true,
};

const mockProfile = {
  id: 'profile-1',
  userId: 'user-master',
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

const mockAIResult = {
  interpretation: {
    sections: {
      personality: { preview: '概覽', full: '完整分析' },
    },
    summary: { preview: '摘要', full: '總結' },
  },
  provider: 'CLAUDE',
  model: 'claude-sonnet-4-20250514',
  tokenUsage: { inputTokens: 1000, outputTokens: 1500, totalTokens: 2500, estimatedCostUsd: 0.025 },
  latencyMs: 2000,
  isCacheHit: false,
};

const mockReading = {
  id: 'reading-1',
  userId: 'user-master',
  birthProfileId: 'profile-1',
  readingType: ReadingType.LIFETIME,
  calculationData: {},
  aiInterpretation: mockAIResult.interpretation,
  aiProvider: 'CLAUDE',
  aiModel: 'claude-sonnet-4-20250514',
  tokenUsage: mockAIResult.tokenUsage,
  creditsUsed: 0,
  targetYear: null,
  targetMonth: null,
  targetDay: null,
  questionText: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ============================================================
// Tests
// ============================================================

describe('Master Tier Bypass — BaziService', () => {
  let service: BaziService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn(), updateMany: jest.fn() },
      birthProfile: { findFirst: jest.fn() },
      service: { findFirst: jest.fn() },
      baziReading: { create: jest.fn(), findFirst: jest.fn() },
      baziComparison: { create: jest.fn() },
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
      generateBirthDataHash: jest.fn().mockReturnValue('hash-master'),
      getCachedInterpretation: jest.fn().mockResolvedValue(null),
      generateInterpretation: jest.fn().mockResolvedValue(mockAIResult),
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
    redis = module.get(RedisService);

    // Mock fetch for Bazi engine
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', data: { pillars: {} } }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should allow Master user to create reading with 0 credits (no deduction)', async () => {
    prisma.user.findUnique.mockResolvedValue(mockMasterUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);
    prisma.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        baziReading: { create: jest.fn().mockResolvedValue(mockReading) },
      });
    });

    const result = await service.createReading('clerk_master', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.LIFETIME,
    });

    expect(result).toBeDefined();
    expect(result.creditsUsed).toBe(0);
    // Master should NOT trigger credit deduction
    // The transaction callback should NOT call updateMany for credits
  });

  it('should NOT deduct credits for Master even when service costs 2 credits', async () => {
    prisma.user.findUnique.mockResolvedValue(mockMasterUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    let transactionUser: any;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      transactionUser = { updateMany: jest.fn() };
      return fn({
        user: transactionUser,
        baziReading: { create: jest.fn().mockResolvedValue({ ...mockReading, creditsUsed: 0 }) },
      });
    });

    const result = await service.createReading('clerk_master', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.LIFETIME,
    });

    // Master tier: user.updateMany should NOT be called for credit deduction
    expect(transactionUser.updateMany).not.toHaveBeenCalled();
    expect(result.creditsUsed).toBe(0);
  });

  it('should reject FREE user with 0 credits and no free trial', async () => {
    prisma.user.findUnique.mockResolvedValue(mockFreeUser);
    prisma.birthProfile.findFirst.mockResolvedValue({ ...mockProfile, userId: 'user-free' });
    prisma.service.findFirst.mockResolvedValue(mockService);

    await expect(
      service.createReading('clerk_free', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.LIFETIME,
      }),
    ).rejects.toThrow('Insufficient credits');
  });

  it('should acquire and release distributed lock during reading creation', async () => {
    prisma.user.findUnique.mockResolvedValue(mockMasterUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);
    prisma.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        user: { updateMany: jest.fn() },
        baziReading: { create: jest.fn().mockResolvedValue(mockReading) },
      });
    });

    await service.createReading('clerk_master', {
      birthProfileId: 'profile-1',
      readingType: ReadingType.LIFETIME,
    });

    expect(redis.acquireLock).toHaveBeenCalledWith('reading:create:user-master', 30);
    expect(redis.releaseLock).toHaveBeenCalledWith('reading:create:user-master');
  });

  it('should throw ConflictException when lock cannot be acquired', async () => {
    redis.acquireLock.mockResolvedValue(false);
    prisma.user.findUnique.mockResolvedValue(mockMasterUser);
    prisma.birthProfile.findFirst.mockResolvedValue(mockProfile);
    prisma.service.findFirst.mockResolvedValue(mockService);

    await expect(
      service.createReading('clerk_master', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.LIFETIME,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
