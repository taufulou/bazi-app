/**
 * Tests for AdminService — CRUD operations, promo codes, user management,
 * dashboard stats, AI costs, revenue, and audit logging.
 * Uses mocked PrismaService and RedisService.
 */
import { AdminService } from '../src/admin/admin.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

// ============================================================
// Mock dependencies
// ============================================================

const mockPrisma = {
  service: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  plan: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  promoCode: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  promptTemplate: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  paymentGateway: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  user: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
  subscription: { groupBy: jest.fn() },
  baziReading: { count: jest.fn(), groupBy: jest.fn() },
  baziComparison: { count: jest.fn() },
  aIUsageLog: { aggregate: jest.fn(), count: jest.fn() },
  adminAuditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

const mockRedis = {
  del: jest.fn(),
};

// ============================================================
// Test Data
// ============================================================

const ADMIN_USER_ID = 'admin-user-1';

const MOCK_SERVICE = {
  id: 'svc-1',
  slug: 'lifetime',
  nameZhTw: '八字終身運',
  creditCost: 2,
  isActive: true,
  sortOrder: 1,
};

const MOCK_PLAN = {
  id: 'plan-1',
  slug: 'pro',
  nameZhTw: '進階版',
  priceMonthly: 9.99,
  isActive: true,
  sortOrder: 1,
};

const MOCK_PROMO = {
  id: 'promo-1',
  code: 'LAUNCH2026',
  discountType: 'PERCENTAGE',
  discountValue: 20,
  maxUses: 100,
  currentUses: 10,
  validFrom: new Date('2026-01-01'),
  validUntil: new Date('2026-12-31'),
  isActive: true,
  createdAt: new Date(),
};

const MOCK_USER = {
  id: 'user-1',
  clerkUserId: 'clerk_abc',
  name: 'Test User',
  credits: 5,
  subscriptionTier: 'FREE',
};

// ============================================================
// Tests
// ============================================================

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(mockPrisma as any, mockRedis as any);
  });

  // ============================================================
  // Services
  // ============================================================

  describe('listServices', () => {
    it('should call prisma.service.findMany with sortOrder ascending', async () => {
      mockPrisma.service.findMany.mockResolvedValue([MOCK_SERVICE]);

      const result = await service.listServices();

      expect(result).toEqual([MOCK_SERVICE]);
      expect(mockPrisma.service.findMany).toHaveBeenCalledWith({ orderBy: { sortOrder: 'asc' } });
    });
  });

  describe('updateService', () => {
    it('should update service, log audit, and invalidate cache', async () => {
      const updatedService = { ...MOCK_SERVICE, nameZhTw: '八字終身運 (更新)' };
      mockPrisma.service.findUnique.mockResolvedValue(MOCK_SERVICE);
      mockPrisma.service.update.mockResolvedValue(updatedService);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});
      mockRedis.del.mockResolvedValue(undefined);

      const result = await service.updateService('svc-1', { nameZhTw: '八字終身運 (更新)' }, ADMIN_USER_ID);

      expect(result).toEqual(updatedService);
      expect(mockPrisma.service.findUnique).toHaveBeenCalledWith({ where: { id: 'svc-1' } });
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { nameZhTw: '八字終身運 (更新)' },
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminUserId: ADMIN_USER_ID,
          action: 'update_service',
          entityType: 'service',
          entityId: 'svc-1',
        }),
      });
      expect(mockRedis.del).toHaveBeenCalledWith('services:active');
    });

    it('should throw NotFoundException when service does not exist', async () => {
      mockPrisma.service.findUnique.mockResolvedValue(null);

      await expect(
        service.updateService('nonexistent', { isActive: false }, ADMIN_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Plans
  // ============================================================

  describe('listPlans', () => {
    it('should call prisma.plan.findMany with sortOrder ascending', async () => {
      mockPrisma.plan.findMany.mockResolvedValue([MOCK_PLAN]);

      const result = await service.listPlans();

      expect(result).toEqual([MOCK_PLAN]);
      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({ orderBy: { sortOrder: 'asc' } });
    });
  });

  describe('updatePlan', () => {
    it('should update plan, log audit, and invalidate cache', async () => {
      const updatedPlan = { ...MOCK_PLAN, priceMonthly: 12.99 };
      mockPrisma.plan.findUnique.mockResolvedValue(MOCK_PLAN);
      mockPrisma.plan.update.mockResolvedValue(updatedPlan);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});
      mockRedis.del.mockResolvedValue(undefined);

      const result = await service.updatePlan('plan-1', { priceMonthly: 12.99 }, ADMIN_USER_ID);

      expect(result).toEqual(updatedPlan);
      expect(mockPrisma.plan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data: { priceMonthly: 12.99 },
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminUserId: ADMIN_USER_ID,
          action: 'update_plan',
          entityType: 'plan',
          entityId: 'plan-1',
        }),
      });
      expect(mockRedis.del).toHaveBeenCalledWith('plans:active');
    });

    it('should throw NotFoundException when plan does not exist', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePlan('nonexistent', { isActive: false }, ADMIN_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Promo Codes
  // ============================================================

  describe('createPromoCode', () => {
    it('should create promo code and log audit', async () => {
      const createdPromo = { ...MOCK_PROMO, id: 'promo-new' };
      mockPrisma.promoCode.create.mockResolvedValue(createdPromo);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const dto = {
        code: 'LAUNCH2026',
        discountType: 'PERCENTAGE' as const,
        discountValue: 20,
        maxUses: 100,
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2026-12-31T23:59:59Z',
      };

      const result = await service.createPromoCode(dto as any, ADMIN_USER_ID);

      expect(result).toEqual(createdPromo);
      expect(mockPrisma.promoCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'LAUNCH2026',
          discountType: 'PERCENTAGE',
          discountValue: 20,
          maxUses: 100,
          isActive: true,
        }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminUserId: ADMIN_USER_ID,
          action: 'create_promo_code',
          entityType: 'promo_code',
          entityId: 'promo-new',
        }),
      });
    });
  });

  describe('updatePromoCode', () => {
    it('should update only provided fields and log audit', async () => {
      const updatedPromo = { ...MOCK_PROMO, discountValue: 30 };
      mockPrisma.promoCode.findUnique.mockResolvedValue(MOCK_PROMO);
      mockPrisma.promoCode.update.mockResolvedValue(updatedPromo);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const dto = { discountValue: 30 };
      const result = await service.updatePromoCode('promo-1', dto as any, ADMIN_USER_ID);

      expect(result).toEqual(updatedPromo);
      expect(mockPrisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: { discountValue: 30 },
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'update_promo_code',
          entityType: 'promo_code',
          entityId: 'promo-1',
        }),
      });
    });

    it('should throw NotFoundException when promo code does not exist', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePromoCode('nonexistent', { isActive: false } as any, ADMIN_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('validatePromoCode', () => {
    it('should return valid for an active, non-expired promo with remaining uses', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(MOCK_PROMO);

      const result = await service.validatePromoCode('LAUNCH2026');

      expect(result.valid).toBe(true);
      expect(result.code).toBe('LAUNCH2026');
      expect(result.discountType).toBe('PERCENTAGE');
      expect(result.discountValue).toBe(20);
      expect(result).not.toHaveProperty('reason');
    });

    it('should return invalid for an expired promo code', async () => {
      const expiredPromo = {
        ...MOCK_PROMO,
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2024-12-31'),
      };
      mockPrisma.promoCode.findUnique.mockResolvedValue(expiredPromo);

      const result = await service.validatePromoCode('LAUNCH2026');

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should throw NotFoundException for unknown promo code', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(null);

      await expect(service.validatePromoCode('FAKECODE')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Users
  // ============================================================

  describe('listUsers', () => {
    it('should return paginated results with meta', async () => {
      const mockUsers = [MOCK_USER];
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers(1, 20);

      expect(result.data).toEqual(mockUsers);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should apply search filter when search is provided', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers(1, 20, 'test');

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: 'test', mode: 'insensitive' } },
              { clerkUserId: 'test' },
            ],
          },
        }),
      );
    });
  });

  describe('getUserDetail', () => {
    it('should return user with subscriptions, transactions, and counts', async () => {
      const detailedUser = {
        ...MOCK_USER,
        subscriptions: [],
        transactions: [],
        _count: { baziReadings: 3, baziComparisons: 1 },
      };
      mockPrisma.user.findUnique.mockResolvedValue(detailedUser);

      const result = await service.getUserDetail('user-1');

      expect(result).toEqual(detailedUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: expect.objectContaining({
          subscriptions: expect.any(Object),
          transactions: expect.any(Object),
          _count: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserDetail('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Adjust Credits
  // ============================================================

  describe('adjustUserCredits', () => {
    it('should update credits and create audit log in a transaction', async () => {
      const updatedUser = { ...MOCK_USER, credits: 10 };
      const auditLog = { id: 'audit-1' };
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.$transaction.mockResolvedValue([updatedUser, auditLog]);

      const result = await service.adjustUserCredits(
        'user-1',
        { amount: 5, reason: 'Admin grant' },
        ADMIN_USER_ID,
      );

      expect(result).toEqual(updatedUser);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // $transaction receives an array of two elements (user.update + auditLog.create results)
      const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(transactionArg)).toBe(true);
      expect(transactionArg).toHaveLength(2);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { credits: 10 },
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminUserId: ADMIN_USER_ID,
          action: 'adjust_credits',
          entityType: 'user',
          entityId: 'user-1',
          oldValue: { credits: 5 },
          newValue: { credits: 10, amount: 5, reason: 'Admin grant' },
        }),
      });
    });

    it('should throw BadRequestException when resulting credits would be negative', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);

      await expect(
        service.adjustUserCredits('user-1', { amount: -10, reason: 'Deduction' }, ADMIN_USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.adjustUserCredits('nonexistent', { amount: 5, reason: 'Test' }, ADMIN_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Dashboard Stats
  // ============================================================

  describe('getDashboardStats', () => {
    it('should aggregate counts from multiple models', async () => {
      mockPrisma.user.count.mockResolvedValue(100);
      mockPrisma.baziReading.count.mockResolvedValue(500);
      mockPrisma.baziComparison.count.mockResolvedValue(50);
      // recentUsers — the second call to user.count
      mockPrisma.user.count
        .mockResolvedValueOnce(100)  // totalUsers
        .mockResolvedValueOnce(15);  // recentUsers7d
      mockPrisma.baziReading.groupBy.mockResolvedValue([
        { readingType: 'LIFETIME', _count: { id: 200 } },
        { readingType: 'ANNUAL', _count: { id: 150 } },
      ]);

      const result = await service.getDashboardStats();

      expect(result.totalUsers).toBe(100);
      expect(result.totalReadings).toBe(500);
      expect(result.totalComparisons).toBe(50);
      expect(result.recentUsers7d).toBe(15);
      expect(result.readingsByType).toEqual([
        { type: 'LIFETIME', count: 200 },
        { type: 'ANNUAL', count: 150 },
      ]);
    });
  });

  // ============================================================
  // AI Costs
  // ============================================================

  describe('getAICosts', () => {
    it('should return fallback values on error', async () => {
      mockPrisma.aIUsageLog.aggregate.mockRejectedValue(new Error('DB connection failed'));

      const result = await service.getAICosts();

      expect(result.totalCost30d).toBe(0);
      expect(result.avgCostPerReading).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.totalRequests).toBe(0);
      expect(result.cacheHitRate).toBe(0);
      expect(result.costByProvider).toEqual([]);
      expect(result.dailyCosts).toEqual([]);
    });
  });

  // ============================================================
  // Revenue
  // ============================================================

  describe('getRevenue', () => {
    it('should return fallback values on error', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Query failed'));

      const result = await service.getRevenue();

      expect(result.totalRevenue30d).toBe(0);
      expect(result.monthlyRevenue).toEqual([]);
      expect(result.activeSubscriptions).toEqual([]);
    });
  });

  // ============================================================
  // Audit Log
  // ============================================================

  describe('getAuditLog', () => {
    it('should return paginated audit log results', async () => {
      const mockLogs = [
        { id: 'log-1', action: 'update_service', createdAt: new Date() },
        { id: 'log-2', action: 'adjust_credits', createdAt: new Date() },
      ];
      mockPrisma.adminAuditLog.findMany.mockResolvedValue(mockLogs);
      mockPrisma.adminAuditLog.count.mockResolvedValue(2);

      const result = await service.getAuditLog(1, 50);

      expect(result.data).toEqual(mockLogs);
      expect(result.meta).toEqual({
        page: 1,
        limit: 50,
        total: 2,
        totalPages: 1,
      });
      expect(mockPrisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 50,
        }),
      );
    });
  });
});
