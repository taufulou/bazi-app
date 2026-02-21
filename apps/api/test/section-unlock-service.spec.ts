/**
 * Tests for SectionUnlockService — per-section unlock for AI reading sections.
 *
 * Covers:
 * - getUnlockedSections() — list unlocked sections, subscriber detection
 * - unlockSection() — full validation chain, credit deduction, ad_reward, idempotency
 * - getReadingWithSectionAccess() — subscriber bypass, non-subscriber partial access
 * - Error cases: invalid reading type, invalid section key, reading not found,
 *   ownership mismatch, no AI interpretation, section not in data, insufficient credits
 */
import { SectionUnlockService } from '../src/payments/section-unlock.service';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

// ============================================================
// Mock Prisma
// ============================================================

const mockTxUser = { updateMany: jest.fn() };
const mockTxSectionUnlock = { create: jest.fn() };

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  baziReading: {
    findUnique: jest.fn(),
  },
  sectionUnlock: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  service: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
    return callback({
      user: mockTxUser,
      sectionUnlock: mockTxSectionUnlock,
    });
  }),
};

// ============================================================
// Test Data
// ============================================================

const MOCK_USER_FREE = {
  id: 'user-uuid-1',
  clerkUserId: 'clerk_user_1',
  subscriptionTier: 'FREE',
  credits: 10,
};

const MOCK_USER_PRO = {
  id: 'user-uuid-2',
  clerkUserId: 'clerk_user_2',
  subscriptionTier: 'PRO',
  credits: 15,
};

const MOCK_USER_NO_CREDITS = {
  id: 'user-uuid-3',
  clerkUserId: 'clerk_user_3',
  subscriptionTier: 'FREE',
  credits: 0,
};

const MOCK_READING_WITH_AI = {
  id: 'reading-1',
  userId: 'user-uuid-1',
  readingType: 'LIFETIME',
  aiInterpretation: {
    sections: {
      personality: { preview: 'preview text', full: 'full text' },
      career: { preview: 'career preview', full: 'career full' },
      love: { preview: 'love preview', full: 'love full' },
      finance: { preview: 'finance preview', full: 'finance full' },
      health: { preview: 'health preview', full: 'health full' },
    },
  },
};

const MOCK_READING_NO_AI = {
  id: 'reading-2',
  userId: 'user-uuid-1',
  readingType: 'LIFETIME',
  aiInterpretation: null,
};

const MOCK_READING_OTHER_USER = {
  id: 'reading-3',
  userId: 'user-uuid-999', // different user
  readingType: 'LIFETIME',
  aiInterpretation: {
    sections: {
      personality: { preview: 'p', full: 'f' },
    },
  },
};

const MOCK_SERVICE = {
  sectionUnlockCreditCost: 1,
};

const MOCK_SERVICE_EXPENSIVE = {
  sectionUnlockCreditCost: 3,
};

// ============================================================
// Tests
// ============================================================

describe('SectionUnlockService', () => {
  let service: SectionUnlockService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SectionUnlockService(mockPrisma as any);

    // Default mocks
    mockTxUser.updateMany.mockResolvedValue({ count: 1 });
    mockTxSectionUnlock.create.mockResolvedValue({});
  });

  // ============================================================
  // getUnlockedSections
  // ============================================================

  describe('getUnlockedSections', () => {
    it('should return unlocked sections for free user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([
        { sectionKey: 'career' },
        { sectionKey: 'love' },
      ]);

      const result = await service.getUnlockedSections('clerk_user_1', 'reading-1');

      expect(result.sections).toEqual(['career', 'love']);
      expect(result.isSubscriber).toBe(false);
      expect(mockPrisma.sectionUnlock.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-1',
          readingId: 'reading-1',
          isRefunded: false,
        },
        select: { sectionKey: true },
      });
    });

    it('should detect subscriber status', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_PRO);
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([]);

      const result = await service.getUnlockedSections('clerk_user_2', 'reading-1');

      expect(result.isSubscriber).toBe(true);
      expect(result.sections).toEqual([]);
    });

    it('should return empty array when no sections unlocked', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([]);

      const result = await service.getUnlockedSections('clerk_user_1', 'reading-1');

      expect(result.sections).toEqual([]);
      expect(result.isSubscriber).toBe(false);
    });

    it('should exclude refunded unlocks', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      // findMany is called with isRefunded: false, so refunded ones are already filtered
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([
        { sectionKey: 'career' },
      ]);

      const result = await service.getUnlockedSections('clerk_user_1', 'reading-1');

      expect(result.sections).toEqual(['career']);
      expect(mockPrisma.sectionUnlock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isRefunded: false }),
        }),
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getUnlockedSections('unknown_clerk', 'reading-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // unlockSection — Validation
  // ============================================================

  describe('unlockSection — validation', () => {
    it('should throw on invalid reading type', async () => {
      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'invalid', 'career', 'credit'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'invalid', 'career', 'credit'),
      ).rejects.toThrow('Invalid reading type');
    });

    it('should throw on invalid section key', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);

      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'invalid_section', 'credit'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'invalid_section', 'credit'),
      ).rejects.toThrow('Invalid section key');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.unlockSection('unknown_clerk', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when reading not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(null);

      await expect(
        service.unlockSection('clerk_user_1', 'nonexistent', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.unlockSection('clerk_user_1', 'nonexistent', 'bazi', 'career', 'credit'),
      ).rejects.toThrow('not found');
    });

    it('should throw ForbiddenException when reading belongs to another user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_OTHER_USER);

      await expect(
        service.unlockSection('clerk_user_1', 'reading-3', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.unlockSection('clerk_user_1', 'reading-3', 'bazi', 'career', 'credit'),
      ).rejects.toThrow('do not have access');
    });

    it('should throw BadRequestException when reading has no AI interpretation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_NO_AI);

      await expect(
        service.unlockSection('clerk_user_1', 'reading-2', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.unlockSection('clerk_user_1', 'reading-2', 'bazi', 'career', 'credit'),
      ).rejects.toThrow('does not have AI interpretation');
    });

    it('should throw BadRequestException when section does not exist in interpretation', async () => {
      const readingMissingSections = {
        ...MOCK_READING_WITH_AI,
        aiInterpretation: {
          sections: {
            personality: { preview: 'p', full: 'f' },
            // career section missing
          },
        },
      };
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(readingMissingSections);

      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow('does not exist in this reading');
    });

    it('should accept all 5 valid section keys', async () => {
      const validKeys = ['personality', 'career', 'love', 'finance', 'health'];

      for (const key of validKeys) {
        jest.clearAllMocks();
        mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
        mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_WITH_AI);
        mockPrisma.sectionUnlock.findUnique.mockResolvedValue(null);
        mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
        mockTxUser.updateMany.mockResolvedValue({ count: 1 });
        mockTxSectionUnlock.create.mockResolvedValue({});

        const result = await service.unlockSection(
          'clerk_user_1', 'reading-1', 'bazi', key, 'credit',
        );
        expect(result.success).toBe(true);
        expect(result.sectionKey).toBe(key);
      }
    });

    it('should accept both bazi and zwds reading types', async () => {
      for (const type of ['bazi', 'zwds']) {
        jest.clearAllMocks();
        mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
        mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_WITH_AI);
        mockPrisma.sectionUnlock.findUnique.mockResolvedValue(null);
        mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
        mockTxUser.updateMany.mockResolvedValue({ count: 1 });
        mockTxSectionUnlock.create.mockResolvedValue({});

        const result = await service.unlockSection(
          'clerk_user_1', 'reading-1', type, 'career', 'credit',
        );
        expect(result.success).toBe(true);
      }
    });
  });

  // ============================================================
  // unlockSection — Idempotency
  // ============================================================

  describe('unlockSection — idempotency', () => {
    it('should return success without deducting credits when already unlocked', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_WITH_AI);
      mockPrisma.sectionUnlock.findUnique.mockResolvedValue({
        id: 'unlock-1',
        userId: 'user-uuid-1',
        readingId: 'reading-1',
        sectionKey: 'career',
        unlockMethod: 'CREDIT',
        creditsUsed: 1,
        isRefunded: false,
      });

      const result = await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'credit',
      );

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(0);
      expect(result.sectionKey).toBe('career');
      // Should NOT call $transaction since already unlocked
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should re-unlock when previous unlock was refunded', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_WITH_AI);
      mockPrisma.sectionUnlock.findUnique.mockResolvedValue({
        id: 'unlock-refunded',
        userId: 'user-uuid-1',
        readingId: 'reading-1',
        sectionKey: 'career',
        unlockMethod: 'CREDIT',
        creditsUsed: 1,
        isRefunded: true, // Was refunded
      });
      mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
      mockTxUser.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'credit',
      );

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(1);
      // Should call $transaction for re-unlock
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ============================================================
  // unlockSection — Credit Method
  // ============================================================

  describe('unlockSection — credit method', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_WITH_AI);
      mockPrisma.sectionUnlock.findUnique.mockResolvedValue(null);
    });

    it('should deduct credits and create unlock record in $transaction', async () => {
      mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
      mockTxUser.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'credit',
      );

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Verify credit deduction with WHERE credits >= cost
      expect(mockTxUser.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1', credits: { gte: 1 } },
        data: { credits: { decrement: 1 } },
      });

      // Verify unlock record creation
      expect(mockTxSectionUnlock.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid-1',
          readingId: 'reading-1',
          readingType: 'bazi',
          sectionKey: 'career',
          unlockMethod: 'CREDIT',
          creditsUsed: 1,
        },
      });
    });

    it('should use admin-configurable cost from Service model', async () => {
      mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE_EXPENSIVE);
      mockTxUser.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'credit',
      );

      expect(result.creditsUsed).toBe(3);
      expect(mockTxUser.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { credits: { decrement: 3 } },
        }),
      );
    });

    it('should default to 1 credit when no service found', async () => {
      mockPrisma.service.findFirst.mockResolvedValue(null);
      mockTxUser.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'credit',
      );

      expect(result.creditsUsed).toBe(1);
    });

    it('should throw BadRequestException when insufficient credits', async () => {
      const userNoCredits = { ...MOCK_USER_FREE, credits: 0 };
      mockPrisma.user.findUnique.mockResolvedValue(userNoCredits);
      mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
      // updateMany returns count: 0 when no rows match (insufficient credits)
      mockTxUser.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow('Insufficient credits');
    });

    it('should lookup service by reading type', async () => {
      mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
      mockTxUser.updateMany.mockResolvedValue({ count: 1 });

      await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'credit',
      );

      expect(mockPrisma.service.findFirst).toHaveBeenCalledWith({
        where: { type: 'LIFETIME', isActive: true },
        select: { sectionUnlockCreditCost: true },
      });
    });
  });

  // ============================================================
  // unlockSection — Ad Reward Method
  // ============================================================

  describe('unlockSection — ad_reward method', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_WITH_AI);
      mockPrisma.sectionUnlock.findUnique.mockResolvedValue(null);
    });

    it('should create unlock with 0 credits used', async () => {
      const result = await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'ad_reward',
      );

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(0);
      expect(result.sectionKey).toBe('career');
    });

    it('should create sectionUnlock record with AD_REWARD method', async () => {
      await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'love', 'ad_reward',
      );

      expect(mockPrisma.sectionUnlock.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid-1',
          readingId: 'reading-1',
          readingType: 'bazi',
          sectionKey: 'love',
          unlockMethod: 'AD_REWARD',
          creditsUsed: 0,
        },
      });
    });

    it('should not call $transaction for ad_reward', async () => {
      await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'ad_reward',
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should work even when user has 0 credits', async () => {
      const userNoCredits = { ...MOCK_USER_FREE, credits: 0 };
      mockPrisma.user.findUnique.mockResolvedValue(userNoCredits);

      const result = await service.unlockSection(
        'clerk_user_1', 'reading-1', 'bazi', 'career', 'ad_reward',
      );

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(0);
    });
  });

  // ============================================================
  // getReadingWithSectionAccess
  // ============================================================

  describe('getReadingWithSectionAccess', () => {
    it('should return all sections for subscriber', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_PRO);
      mockPrisma.baziReading.findUnique.mockResolvedValue({
        userId: 'user-uuid-2',
        aiInterpretation: MOCK_READING_WITH_AI.aiInterpretation,
      });

      const result = await service.getReadingWithSectionAccess('clerk_user_2', 'reading-1');

      expect(result.isSubscriber).toBe(true);
      expect(result.unlockedSections).toEqual(['personality', 'career', 'love', 'finance', 'health']);
      expect(result.allSections).toEqual(['personality', 'career', 'love', 'finance', 'health']);
      // Should not query sectionUnlock for subscribers
      expect(mockPrisma.sectionUnlock.findMany).not.toHaveBeenCalled();
    });

    it('should return only unlocked sections for non-subscriber', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue({
        userId: 'user-uuid-1',
        aiInterpretation: MOCK_READING_WITH_AI.aiInterpretation,
      });
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([
        { sectionKey: 'career' },
        { sectionKey: 'health' },
      ]);

      const result = await service.getReadingWithSectionAccess('clerk_user_1', 'reading-1');

      expect(result.isSubscriber).toBe(false);
      expect(result.unlockedSections).toEqual(['career', 'health']);
      expect(result.allSections).toEqual(['personality', 'career', 'love', 'finance', 'health']);
    });

    it('should return empty arrays when reading has no AI interpretation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue({
        userId: 'user-uuid-1',
        aiInterpretation: null,
      });
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([]);

      const result = await service.getReadingWithSectionAccess('clerk_user_1', 'reading-1');

      expect(result.allSections).toEqual([]);
      expect(result.unlockedSections).toEqual([]);
    });

    it('should throw NotFoundException when reading not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(null);

      await expect(
        service.getReadingWithSectionAccess('clerk_user_1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when reading belongs to another user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue({
        userId: 'user-uuid-999', // different user
        aiInterpretation: MOCK_READING_WITH_AI.aiInterpretation,
      });

      await expect(
        service.getReadingWithSectionAccess('clerk_user_1', 'reading-3'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should exclude refunded unlocks for non-subscriber', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue({
        userId: 'user-uuid-1',
        aiInterpretation: MOCK_READING_WITH_AI.aiInterpretation,
      });
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([
        { sectionKey: 'career' },
      ]);

      await service.getReadingWithSectionAccess('clerk_user_1', 'reading-1');

      expect(mockPrisma.sectionUnlock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isRefunded: false }),
        }),
      );
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('edge cases', () => {
    it('should handle reading with empty sections object', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue({
        ...MOCK_READING_WITH_AI,
        aiInterpretation: { sections: {} },
      });

      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow('does not exist in this reading');
    });

    it('should handle reading with no sections key in interpretation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue({
        ...MOCK_READING_WITH_AI,
        aiInterpretation: { someOtherKey: 'value' },
      });

      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle $transaction error propagation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER_FREE);
      mockPrisma.baziReading.findUnique.mockResolvedValue(MOCK_READING_WITH_AI);
      mockPrisma.sectionUnlock.findUnique.mockResolvedValue(null);
      mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
      mockPrisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.unlockSection('clerk_user_1', 'reading-1', 'bazi', 'career', 'credit'),
      ).rejects.toThrow('DB connection lost');
    });

    it('should handle BASIC subscriber as subscriber (not FREE)', async () => {
      const basicUser = { ...MOCK_USER_FREE, subscriptionTier: 'BASIC' };
      mockPrisma.user.findUnique.mockResolvedValue(basicUser);
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([]);

      const result = await service.getUnlockedSections('clerk_user_1', 'reading-1');
      expect(result.isSubscriber).toBe(true);
    });

    it('should handle MASTER subscriber as subscriber', async () => {
      const masterUser = { ...MOCK_USER_FREE, subscriptionTier: 'MASTER' };
      mockPrisma.user.findUnique.mockResolvedValue(masterUser);
      mockPrisma.sectionUnlock.findMany.mockResolvedValue([]);

      const result = await service.getUnlockedSections('clerk_user_1', 'reading-1');
      expect(result.isSubscriber).toBe(true);
    });
  });
});
