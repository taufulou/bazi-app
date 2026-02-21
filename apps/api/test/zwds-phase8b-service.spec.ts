import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ZwdsService } from '../src/zwds/zwds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AIService } from '../src/ai/ai.service';
import { ReadingType } from '@prisma/client';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';

describe('Phase 8B — ZwdsService', () => {
  let service: ZwdsService;
  let prisma: PrismaService;
  let aiService: AIService;

  const mockUser = {
    id: 'user-1',
    clerkUserId: 'clerk_user_1',
    name: 'Test User',
    avatarUrl: null,
    subscriptionTier: 'FREE',
    credits: 10,
    languagePref: 'ZH_TW',
    freeReadingUsed: false,
    deviceFingerprint: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMasterUser = {
    ...mockUser,
    id: 'user-master',
    clerkUserId: 'clerk_master',
    subscriptionTier: 'MASTER',
    credits: 20,
    freeReadingUsed: true,
  };

  const mockProfile = {
    id: 'profile-1',
    userId: 'user-1',
    name: '張三',
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

  const mockMonthlyService = {
    id: 'svc-monthly',
    slug: 'zwds-monthly',
    nameZhTw: '紫微流月運',
    nameZhCn: '紫微流月运',
    descriptionZhTw: '',
    descriptionZhCn: '',
    type: ReadingType.ZWDS_MONTHLY,
    creditCost: 1,
    isActive: true,
    sortOrder: 13,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDailyService = {
    id: 'svc-daily',
    slug: 'zwds-daily',
    nameZhTw: '紫微每日運勢',
    nameZhCn: '紫微每日运势',
    descriptionZhTw: '',
    descriptionZhCn: '',
    type: ReadingType.ZWDS_DAILY,
    creditCost: 0,
    isActive: true,
    sortOrder: 14,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMajorPeriodService = {
    id: 'svc-major-period',
    slug: 'zwds-major-period',
    nameZhTw: '紫微大限分析',
    nameZhCn: '紫微大限分析',
    descriptionZhTw: '',
    descriptionZhCn: '',
    type: ReadingType.ZWDS_MAJOR_PERIOD,
    creditCost: 2,
    isActive: true,
    sortOrder: 15,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQaService = {
    id: 'svc-qa',
    slug: 'zwds-qa',
    nameZhTw: '紫微問事',
    nameZhCn: '紫微问事',
    descriptionZhTw: '',
    descriptionZhCn: '',
    type: ReadingType.ZWDS_QA,
    creditCost: 1,
    isActive: true,
    sortOrder: 16,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAIResult = {
    interpretation: {
      sections: {
        monthly_overview: { preview: '本月概覽…', full: '完整月度分析…' },
      },
      summary: { preview: '概要', full: '總結' },
    },
    provider: 'CLAUDE',
    model: 'claude-sonnet-4-20250514',
    tokenUsage: { inputTokens: 1000, outputTokens: 1500, totalTokens: 2500, estimatedCostUsd: 0.025 },
    latencyMs: 2500,
    isCacheHit: false,
  };

  beforeEach(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn() },
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
      generateBirthDataHash: jest.fn().mockReturnValue('hash_phase8b'),
      getCachedInterpretation: jest.fn().mockResolvedValue(null),
      generateInterpretation: jest.fn().mockResolvedValue(mockAIResult),
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfig = {
      get: jest.fn().mockReturnValue('http://localhost:5001'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZwdsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: AIService, useValue: mockAI },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ZwdsService>(ZwdsService);
    prisma = module.get(PrismaService);
    aiService = module.get(AIService);
  });

  // ============================================================
  // Helper: setup standard mocks for createReading flow
  // ============================================================

  function setupStandardMocks(user: any, profile: any, svcMock: any) {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(profile);
    (prisma.service.findFirst as jest.Mock).mockResolvedValue(svcMock);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
      const tx = {
        user: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        baziReading: {
          create: jest.fn().mockResolvedValue({
            id: 'reading-new',
            readingType: svcMock.type,
            creditsUsed: svcMock.creditCost,
          }),
        },
      };
      return fn(tx);
    });
  }

  // ============================================================
  // ZWDS_MONTHLY validation
  // ============================================================

  describe('createReading — ZWDS_MONTHLY', () => {
    it('should reject monthly reading without targetYear', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_MONTHLY,
          targetMonth: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject monthly reading without targetMonth', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_MONTHLY,
          targetYear: 2026,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept monthly reading with valid targetYear + targetMonth', async () => {
      setupStandardMocks(mockUser, mockProfile, mockMonthlyService);

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_MONTHLY,
        targetYear: 2026,
        targetMonth: 6,
      });

      expect(result).toBeDefined();
      expect(result.readingType).toBe(ReadingType.ZWDS_MONTHLY);
    });
  });

  // ============================================================
  // ZWDS_DAILY validation
  // ============================================================

  describe('createReading — ZWDS_DAILY', () => {
    it('should reject daily reading without targetDay', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_DAILY,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept daily reading with valid targetDay', async () => {
      setupStandardMocks(mockUser, mockProfile, mockDailyService);

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_DAILY,
        targetDay: '2026-2-10',
      });

      expect(result).toBeDefined();
      expect(result.readingType).toBe(ReadingType.ZWDS_DAILY);
    });
  });

  // ============================================================
  // ZWDS_MAJOR_PERIOD validation
  // ============================================================

  describe('createReading — ZWDS_MAJOR_PERIOD', () => {
    it('should accept major period reading without extra params', async () => {
      setupStandardMocks(mockUser, mockProfile, mockMajorPeriodService);

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_MAJOR_PERIOD,
      });

      expect(result).toBeDefined();
      expect(result.readingType).toBe(ReadingType.ZWDS_MAJOR_PERIOD);
    });
  });

  // ============================================================
  // ZWDS_QA validation
  // ============================================================

  describe('createReading — ZWDS_QA', () => {
    it('should reject Q&A reading without questionText', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_QA,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept Q&A reading with valid questionText', async () => {
      setupStandardMocks(mockUser, mockProfile, mockQaService);

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_QA,
        questionText: '今年適合換工作嗎？',
      });

      expect(result).toBeDefined();
      expect(result.readingType).toBe(ReadingType.ZWDS_QA);
    });
  });

  // ============================================================
  // Invalid reading type
  // ============================================================

  describe('createReading — invalid type', () => {
    it('should reject non-ZWDS reading types (e.g. LIFETIME)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.LIFETIME,
        }),
      ).rejects.toThrow('Invalid ZWDS reading type');
    });
  });

  // ============================================================
  // User not found
  // ============================================================

  describe('createReading — user not found', () => {
    it('should throw NotFoundException for unknown clerkUserId', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createReading('unknown_clerk', {
          birthProfileId: 'p1',
          readingType: ReadingType.ZWDS_MONTHLY,
          targetYear: 2026,
          targetMonth: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Credit edge cases — race condition (updateMany count=0)
  // ============================================================

  describe('createReading — credit race condition', () => {
    it('should throw BadRequestException when credits depleted concurrently', async () => {
      const paidUser = { ...mockUser, freeReadingUsed: true, credits: 1 };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(paidUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockMonthlyService);

      // Simulate race: transaction updateMany returns count 0
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          baziReading: {
            create: jest.fn(),
          },
        };
        return fn(tx);
      });

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_MONTHLY,
          targetYear: 2026,
          targetMonth: 6,
        }),
      ).rejects.toThrow(/Insufficient credits/);
    });
  });

  // ============================================================
  // Free trial path
  // ============================================================

  describe('createReading — free trial', () => {
    it('should use free trial if freeReadingUsed is false', async () => {
      const freeUser = { ...mockUser, freeReadingUsed: false, credits: 0 };
      setupStandardMocks(freeUser, mockProfile, mockMonthlyService);

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_MONTHLY,
        targetYear: 2026,
        targetMonth: 3,
      });

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // Cross-System Reading
  // ============================================================

  describe('createCrossSystemReading', () => {
    it('should throw NotFoundException for unknown user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createCrossSystemReading('unknown', { birthProfileId: 'p1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for non-Master user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser); // FREE tier
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      await expect(
        service.createCrossSystemReading('clerk_user_1', { birthProfileId: 'profile-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException for missing profile (Master user)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockMasterUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createCrossSystemReading('clerk_master', { birthProfileId: 'bad-profile' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should succeed for Master user (credits bypassed)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockMasterUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue({
        ...mockProfile,
        userId: 'user-master',
      });

      // Mock fetch for Bazi engine
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { fourPillars: {} } }),
      }) as any;

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          baziReading: {
            create: jest.fn().mockResolvedValue({
              id: 'cs-reading-1',
              readingType: ReadingType.ZWDS_LIFETIME,
              creditsUsed: 0,
            }),
          },
        };
        return fn(tx);
      });

      const result = await service.createCrossSystemReading('clerk_master', {
        birthProfileId: 'profile-1',
      });

      expect(result).toBeDefined();
      expect(result.creditsUsed).toBe(0);

      global.fetch = originalFetch;
    });

    it('should call AI with promptVariant "cross-system"', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockMasterUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue({
        ...mockProfile,
        userId: 'user-master',
      });

      // Mock fetch for Bazi engine
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { fourPillars: {} } }),
      }) as any;

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          baziReading: {
            create: jest.fn().mockResolvedValue({
              id: 'cs-reading-2',
              readingType: ReadingType.ZWDS_LIFETIME,
              creditsUsed: 0,
            }),
          },
        };
        return fn(tx);
      });

      await service.createCrossSystemReading('clerk_master', {
        birthProfileId: 'profile-1',
      });

      // Verify AI was called with 'cross-system' variant
      expect(aiService.generateInterpretation as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'cross-system' }),
        ReadingType.ZWDS_LIFETIME,
        'user-master',
        undefined, // readingId
        'cross-system', // promptVariant
      );

      global.fetch = originalFetch;
    });

    it('should throw InternalServerErrorException when Bazi engine returns error', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockMasterUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue({
        ...mockProfile,
        userId: 'user-master',
      });

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as any;

      await expect(
        service.createCrossSystemReading('clerk_master', { birthProfileId: 'profile-1' }),
      ).rejects.toThrow(InternalServerErrorException);

      global.fetch = originalFetch;
    });
  });

  // ============================================================
  // Deep Star Analysis
  // ============================================================

  describe('createDeepStarReading', () => {
    it('should throw NotFoundException for unknown user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createDeepStarReading('unknown', { birthProfileId: 'p1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject FREE subscription tier', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, subscriptionTier: 'FREE' });

      await expect(
        service.createDeepStarReading('clerk_user_1', { birthProfileId: 'p1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject BASIC subscription tier', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, subscriptionTier: 'BASIC' });

      await expect(
        service.createDeepStarReading('clerk_user_1', { birthProfileId: 'p1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject PRO subscription tier', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, subscriptionTier: 'PRO' });

      await expect(
        service.createDeepStarReading('clerk_user_1', { birthProfileId: 'p1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow MASTER user regardless of credit balance (bypass)', async () => {
      const brokeMaster = { ...mockMasterUser, credits: 0 }; // Master bypasses credits
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(brokeMaster);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue({
        ...mockProfile,
        userId: 'user-master',
      });

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          baziReading: {
            create: jest.fn().mockResolvedValue({
              id: 'ds-reading-bypass',
              readingType: ReadingType.ZWDS_LIFETIME,
              creditsUsed: 0,
            }),
          },
        };
        return fn(tx);
      });

      const result = await service.createDeepStarReading('clerk_master', {
        birthProfileId: 'profile-1',
      });

      expect(result).toBeDefined();
      expect(result.creditsUsed).toBe(0);
    });

    it('should throw NotFoundException for missing profile', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockMasterUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createDeepStarReading('clerk_master', { birthProfileId: 'bad' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should succeed for MASTER user with enough credits', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockMasterUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue({
        ...mockProfile,
        userId: 'user-master',
      });

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          baziReading: {
            create: jest.fn().mockResolvedValue({
              id: 'ds-reading-1',
              readingType: ReadingType.ZWDS_LIFETIME,
              creditsUsed: 2,
            }),
          },
        };
        return fn(tx);
      });

      const result = await service.createDeepStarReading('clerk_master', {
        birthProfileId: 'profile-1',
      });

      expect(result).toBeDefined();
      expect(result.creditsUsed).toBe(2);
    });

    it('should call AI with promptVariant "deep-stars"', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockMasterUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue({
        ...mockProfile,
        userId: 'user-master',
      });

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          baziReading: {
            create: jest.fn().mockResolvedValue({
              id: 'ds-reading-2',
              readingType: ReadingType.ZWDS_LIFETIME,
              creditsUsed: 2,
            }),
          },
        };
        return fn(tx);
      });

      await service.createDeepStarReading('clerk_master', {
        birthProfileId: 'profile-1',
      });

      expect(aiService.generateInterpretation as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'zwds' }),
        ReadingType.ZWDS_LIFETIME,
        'user-master',
        undefined, // readingId
        'deep-stars', // promptVariant
      );
    });
  });
});
