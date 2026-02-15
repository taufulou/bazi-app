/**
 * Tests for AdsService — rewarded video ad backend infrastructure.
 *
 * Covers:
 * - getAdConfig() — returns static config
 * - getRemainingViews() — daily limit via Redis counter
 * - claimReward() — CREDIT, SECTION_UNLOCK, DAILY_HOROSCOPE
 * - Daily limit enforcement (5 views max, atomic INCR)
 * - Validation (invalid reward type, missing readingId for SECTION_UNLOCK)
 * - Error handling (user not found, daily limit exceeded)
 * - Transaction atomicity for CREDIT rewards
 */
import { AdsService } from '../src/ads/ads.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

// ============================================================
// Mocks
// ============================================================

const mockTxUser = { update: jest.fn() };
const mockTxAdRewardLog = { create: jest.fn() };

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  adRewardLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
    return callback({
      user: mockTxUser,
      adRewardLog: mockTxAdRewardLog,
    });
  }),
};

const mockRedis = {
  getRateLimit: jest.fn(),
  incrementRateLimit: jest.fn(),
};

// ============================================================
// Test Data
// ============================================================

const MOCK_USER = {
  id: 'user-uuid-1',
  clerkUserId: 'clerk_user_1',
  credits: 5,
  subscriptionTier: 'FREE',
};

const MOCK_USER_PRO = {
  id: 'user-uuid-2',
  clerkUserId: 'clerk_user_2',
  credits: 15,
  subscriptionTier: 'PRO',
};

// ============================================================
// Tests
// ============================================================

describe('AdsService', () => {
  let service: AdsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdsService(mockPrisma as any, mockRedis as any);

    // Default mocks
    mockTxUser.update.mockResolvedValue({});
    mockTxAdRewardLog.create.mockResolvedValue({});
  });

  // ============================================================
  // getAdConfig
  // ============================================================

  describe('getAdConfig', () => {
    it('should return ad configuration', () => {
      const config = service.getAdConfig();

      expect(config.maxDailyViews).toBe(5);
      expect(config.creditsPerAdView).toBe(1);
      expect(config.rewardTypes).toEqual(['CREDIT', 'SECTION_UNLOCK', 'DAILY_HOROSCOPE']);
      expect(config.adUnitIds.rewarded).toBeDefined();
    });

    it('should return consistent config on multiple calls', () => {
      const config1 = service.getAdConfig();
      const config2 = service.getAdConfig();
      expect(config1).toEqual(config2);
    });
  });

  // ============================================================
  // getRemainingViews
  // ============================================================

  describe('getRemainingViews', () => {
    it('should return full daily allowance when no views used', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.getRateLimit.mockResolvedValue(0);

      const result = await service.getRemainingViews('clerk_user_1');

      expect(result.remainingDailyViews).toBe(5);
      expect(result.maxDailyViews).toBe(5);
      expect(result.viewsUsedToday).toBe(0);
    });

    it('should return reduced views when some used', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.getRateLimit.mockResolvedValue(3);

      const result = await service.getRemainingViews('clerk_user_1');

      expect(result.remainingDailyViews).toBe(2);
      expect(result.viewsUsedToday).toBe(3);
    });

    it('should return 0 remaining when daily limit reached', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.getRateLimit.mockResolvedValue(5);

      const result = await service.getRemainingViews('clerk_user_1');

      expect(result.remainingDailyViews).toBe(0);
      expect(result.viewsUsedToday).toBe(5);
    });

    it('should not return negative remaining views', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.getRateLimit.mockResolvedValue(7); // Over limit

      const result = await service.getRemainingViews('clerk_user_1');

      expect(result.remainingDailyViews).toBe(0);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getRemainingViews('unknown_clerk'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should use correct Redis key format with UTC date', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.getRateLimit.mockResolvedValue(0);

      await service.getRemainingViews('clerk_user_1');

      const expectedKeyPrefix = `ad:daily:${MOCK_USER.id}:`;
      expect(mockRedis.getRateLimit).toHaveBeenCalledWith(
        expect.stringContaining(expectedKeyPrefix),
      );
    });
  });

  // ============================================================
  // claimReward — CREDIT type
  // ============================================================

  describe('claimReward — CREDIT type', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('should grant 1 credit and create ad reward log', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1); // First view of day

      const result = await service.claimReward('clerk_user_1', 'CREDIT', 'ad-placement-123');

      expect(result.success).toBe(true);
      expect(result.creditsGranted).toBe(1);
      expect(result.remainingDailyViews).toBe(4);
    });

    it('should use $transaction for atomic credit increment + log creation', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      await service.claimReward('clerk_user_1', 'CREDIT');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTxUser.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { credits: { increment: 1 } },
      });
      expect(mockTxAdRewardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-uuid-1',
          rewardType: 'CREDIT',
          creditsGranted: 1,
        }),
      });
    });

    it('should pass adPlacementId to log', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      await service.claimReward('clerk_user_1', 'CREDIT', 'ad-unit-xyz');

      expect(mockTxAdRewardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adNetworkId: 'ad-unit-xyz',
        }),
      });
    });

    it('should handle null adPlacementId', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      await service.claimReward('clerk_user_1', 'CREDIT');

      expect(mockTxAdRewardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adNetworkId: null,
        }),
      });
    });

    it('should calculate remaining views correctly after claim', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(3);

      const result = await service.claimReward('clerk_user_1', 'CREDIT');

      expect(result.remainingDailyViews).toBe(2); // 5 - 3 = 2
    });

    it('should return 0 remaining on last allowed view', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(5);

      const result = await service.claimReward('clerk_user_1', 'CREDIT');

      expect(result.remainingDailyViews).toBe(0);
    });
  });

  // ============================================================
  // claimReward — SECTION_UNLOCK type
  // ============================================================

  describe('claimReward — SECTION_UNLOCK type', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('should create ad reward log with section info', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      const result = await service.claimReward(
        'clerk_user_1', 'SECTION_UNLOCK', 'ad-placement', 'reading-123', 'career',
      );

      expect(result.success).toBe(true);
      expect(result.creditsGranted).toBe(0);
      expect(mockPrisma.adRewardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-uuid-1',
          rewardType: 'SECTION_UNLOCK',
          sectionKey: 'career',
          readingId: 'reading-123',
          creditsGranted: 0,
        }),
      });
    });

    it('should not use $transaction (no credit change)', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      await service.claimReward(
        'clerk_user_1', 'SECTION_UNLOCK', 'ad-placement', 'reading-123', 'career',
      );

      // $transaction should not be called (non-credit reward)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      // Direct adRewardLog.create should be called
      expect(mockPrisma.adRewardLog.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException when readingId is missing', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      await expect(
        service.claimReward('clerk_user_1', 'SECTION_UNLOCK', 'ad', undefined, 'career'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.claimReward('clerk_user_1', 'SECTION_UNLOCK', 'ad', undefined, 'career'),
      ).rejects.toThrow('readingId is required');
    });

    it('should throw BadRequestException when sectionKey is missing', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      await expect(
        service.claimReward('clerk_user_1', 'SECTION_UNLOCK', 'ad', 'reading-123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.claimReward('clerk_user_1', 'SECTION_UNLOCK', 'ad', 'reading-123'),
      ).rejects.toThrow('sectionKey is required');
    });
  });

  // ============================================================
  // claimReward — DAILY_HOROSCOPE type
  // ============================================================

  describe('claimReward — DAILY_HOROSCOPE type', () => {
    it('should create ad reward log for horoscope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      const result = await service.claimReward('clerk_user_1', 'DAILY_HOROSCOPE', 'ad-placement');

      expect(result.success).toBe(true);
      expect(result.creditsGranted).toBe(0);
      expect(mockPrisma.adRewardLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-uuid-1',
          rewardType: 'DAILY_HOROSCOPE',
          creditsGranted: 0,
        }),
      });
    });

    it('should not require readingId or sectionKey', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      // Should not throw
      const result = await service.claimReward('clerk_user_1', 'DAILY_HOROSCOPE');
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // claimReward — Daily Limit Enforcement
  // ============================================================

  describe('claimReward — daily limit', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
    });

    it('should throw BadRequestException when daily limit exceeded', async () => {
      // INCR returns 6 (over the limit of 5)
      mockRedis.incrementRateLimit.mockResolvedValue(6);

      await expect(
        service.claimReward('clerk_user_1', 'CREDIT'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.claimReward('clerk_user_1', 'CREDIT'),
      ).rejects.toThrow('Daily ad limit reached');
    });

    it('should allow exactly 5 views per day', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(5); // 5th view

      const result = await service.claimReward('clerk_user_1', 'CREDIT');

      expect(result.success).toBe(true);
      expect(result.remainingDailyViews).toBe(0);
    });

    it('should reject 6th view', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(6); // 6th view

      await expect(
        service.claimReward('clerk_user_1', 'CREDIT'),
      ).rejects.toThrow('Daily ad limit reached');
    });

    it('should use 24h TTL for Redis counter', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(1);

      await service.claimReward('clerk_user_1', 'CREDIT');

      // incrementRateLimit is called with key and TTL of 86400 seconds (24h)
      expect(mockRedis.incrementRateLimit).toHaveBeenCalledWith(
        expect.any(String),
        86400,
      );
    });

    it('should not create reward log when limit exceeded', async () => {
      mockRedis.incrementRateLimit.mockResolvedValue(6);

      await service.claimReward('clerk_user_1', 'CREDIT').catch(() => {});

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.adRewardLog.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // claimReward — Validation
  // ============================================================

  describe('claimReward — validation', () => {
    it('should throw BadRequestException for invalid reward type', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);

      await expect(
        service.claimReward('clerk_user_1', 'INVALID_TYPE'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.claimReward('clerk_user_1', 'INVALID_TYPE'),
      ).rejects.toThrow('Invalid reward type');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.claimReward('unknown_clerk', 'CREDIT'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // claimReward — Error Handling
  // ============================================================

  describe('claimReward — error handling', () => {
    it('should propagate $transaction errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.incrementRateLimit.mockResolvedValue(1);
      mockPrisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.claimReward('clerk_user_1', 'CREDIT'),
      ).rejects.toThrow('DB connection lost');
    });

    it('should propagate Redis errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockRedis.incrementRateLimit.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        service.claimReward('clerk_user_1', 'CREDIT'),
      ).rejects.toThrow('Redis unavailable');
    });
  });

  // ============================================================
  // AdsController — endpoint routing
  // ============================================================

  describe('AdsController routing', () => {
    // Import controller for routing tests
    const { AdsController } = require('../src/ads/ads.controller');

    let controller: any;
    const mockAdsService = {
      getAdConfig: jest.fn(),
      getRemainingViews: jest.fn(),
      claimReward: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      controller = new AdsController(mockAdsService);
    });

    it('GET /api/ads/config should return ad config', () => {
      const config = { maxDailyViews: 5, rewardTypes: ['CREDIT'] };
      mockAdsService.getAdConfig.mockReturnValue(config);

      const result = controller.getAdConfig();
      expect(result).toEqual(config);
    });

    it('GET /api/ads/status should return remaining views', async () => {
      const status = { remainingDailyViews: 3, maxDailyViews: 5, viewsUsedToday: 2 };
      mockAdsService.getRemainingViews.mockResolvedValue(status);

      const auth = { userId: 'clerk_user_1', sessionId: 'sess_1' };
      const result = await controller.getAdStatus(auth);

      expect(result).toEqual(status);
      expect(mockAdsService.getRemainingViews).toHaveBeenCalledWith('clerk_user_1');
    });

    it('POST /api/ads/claim should claim CREDIT reward', async () => {
      const reward = { success: true, creditsGranted: 1, remainingDailyViews: 4 };
      mockAdsService.claimReward.mockResolvedValue(reward);

      const auth = { userId: 'clerk_user_1', sessionId: 'sess_1' };
      const dto = { rewardType: 'CREDIT', adPlacementId: 'ad-1' };
      const result = await controller.claimReward(auth, dto);

      expect(result).toEqual(reward);
      expect(mockAdsService.claimReward).toHaveBeenCalledWith(
        'clerk_user_1',
        'CREDIT',
        'ad-1',
        undefined,
        undefined,
      );
    });

    it('POST /api/ads/claim should claim SECTION_UNLOCK reward', async () => {
      const reward = { success: true, creditsGranted: 0, remainingDailyViews: 3 };
      mockAdsService.claimReward.mockResolvedValue(reward);

      const auth = { userId: 'clerk_user_1', sessionId: 'sess_1' };
      const dto = {
        rewardType: 'SECTION_UNLOCK',
        adPlacementId: 'ad-2',
        readingId: 'reading-123',
        sectionKey: 'career',
      };
      const result = await controller.claimReward(auth, dto);

      expect(result).toEqual(reward);
      expect(mockAdsService.claimReward).toHaveBeenCalledWith(
        'clerk_user_1',
        'SECTION_UNLOCK',
        'ad-2',
        'reading-123',
        'career',
      );
    });

    it('should propagate errors from service', async () => {
      mockAdsService.claimReward.mockRejectedValue(new Error('Daily limit reached'));

      const auth = { userId: 'clerk_user_1', sessionId: 'sess_1' };
      const dto = { rewardType: 'CREDIT' };

      await expect(controller.claimReward(auth, dto)).rejects.toThrow('Daily limit reached');
    });
  });
});
