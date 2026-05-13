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
  // Phase 1.10 — chat aggregate metrics
  chatSession: { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
  chatMessage: { count: jest.fn(), groupBy: jest.fn(), aggregate: jest.fn() },
  chatMonthlyUsage: { groupBy: jest.fn() },
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
  // Chat Aggregate (Phase 1.10)
  // ============================================================

  describe('getChatAggregate', () => {
    function mockChatAggregateData(overrides?: {
      totalSessions?: number;
      sessionsLast7Days?: number;
      sessionsLast24Hours?: number;
      sessionsAtHardCap?: number;
      messagesByRole?: Array<{ role: string; _count: { id: number } }>;
      refundedMessages?: number;
    }) {
      const opts = {
        totalSessions: 100,
        sessionsLast7Days: 25,
        sessionsLast24Hours: 5,
        sessionsAtHardCap: 8,
        messagesByRole: [
          { role: 'USER', _count: { id: 400 } },
          { role: 'ASSISTANT', _count: { id: 400 } },
          { role: 'SYSTEM', _count: { id: 0 } },
        ],
        refundedMessages: 12,
        ...overrides,
      };
      mockPrisma.chatSession.count
        .mockResolvedValueOnce(opts.totalSessions)
        .mockResolvedValueOnce(opts.sessionsLast7Days)
        .mockResolvedValueOnce(opts.sessionsLast24Hours)
        .mockResolvedValueOnce(opts.sessionsAtHardCap);
      mockPrisma.chatSession.aggregate
        // sessionsExtendedAgg
        .mockResolvedValueOnce({
          _sum: { creditExtensions: 12 },
          _count: { id: 8 },
        })
        // messageAggregates
        .mockResolvedValueOnce({
          _avg: { messageCount: 8 },
        });
      mockPrisma.chatMessage.groupBy
        // messagesByRole
        .mockResolvedValueOnce(opts.messagesByRole)
        // llmJudgeBreakdown
        .mockResolvedValueOnce([
          { llmJudgeVerdict: 'pass', _count: { id: 18 } },
          { llmJudgeVerdict: 'fail', _count: { id: 2 } },
        ]);
      mockPrisma.chatMessage.count.mockResolvedValueOnce(opts.refundedMessages);
      mockPrisma.chatMessage.aggregate
        // validatorAggregates
        .mockResolvedValueOnce({ _count: { id: 5 } })
        // tokenAggregates
        .mockResolvedValueOnce({
          _sum: {
            cacheReadTokens: 90000,
            cacheCreationTokens: 10000,
            tokensInput: 100000,
            tokensOutput: 5000,
          },
        });
      mockPrisma.chatMonthlyUsage.groupBy.mockResolvedValueOnce([
        { subscriptionTier: 'BASIC', _sum: { chatsUsed: 30 }, _count: { id: 3 } },
        { subscriptionTier: 'PRO', _sum: { chatsUsed: 60 }, _count: { id: 2 } },
      ]);
      // Phase 1.11 — sessions in last 7 days for cost-bucket computation.
      mockPrisma.chatSession.findMany.mockResolvedValueOnce([
        // Short session (1-10 bucket, 5 messages, low cost)
        {
          messageCount: 5,
          messages: [
            { cacheReadTokens: 8000, cacheCreationTokens: 0, tokensInput: 0, tokensOutput: 200 },
            { cacheReadTokens: 8000, cacheCreationTokens: 0, tokensInput: 0, tokensOutput: 200 },
            { cacheReadTokens: 8000, cacheCreationTokens: 0, tokensInput: 0, tokensOutput: 200 },
          ],
        },
        // Long session (21-30 bucket, 30 messages, more total cost)
        {
          messageCount: 30,
          messages: [
            // Cache write happened on first message
            { cacheReadTokens: 0, cacheCreationTokens: 10000, tokensInput: 0, tokensOutput: 500 },
            // Subsequent messages all cache reads
            { cacheReadTokens: 10000, cacheCreationTokens: 0, tokensInput: 0, tokensOutput: 500 },
            { cacheReadTokens: 10000, cacheCreationTokens: 0, tokensInput: 0, tokensOutput: 500 },
          ],
        },
      ]);
    }

    it('returns aggregate metrics with correct shape and computed rates', async () => {
      mockChatAggregateData();

      const result = await service.getChatAggregate();

      // Sessions
      expect(result.sessions.total).toBe(100);
      expect(result.sessions.last7Days).toBe(25);
      expect(result.sessions.last24Hours).toBe(5);
      expect(result.sessions.atHardCap).toBe(8);
      expect(result.sessions.extended).toBe(8);
      expect(result.sessions.avgMessagesPerSession).toBe(8);

      // Messages
      expect(result.messages.user).toBe(400);
      expect(result.messages.assistant).toBe(400);
      expect(result.messages.system).toBe(0);
      expect(result.messages.total).toBe(800);
      expect(result.messages.refunded).toBe(12);
      // refundRate = 12 / 400 = 0.03
      expect(result.messages.refundRate).toBeCloseTo(0.03, 4);

      // Cache hit rate = 90000 / (90000 + 10000) = 0.9
      expect(result.tokens.cacheHitRate).toBeCloseTo(0.9, 4);
      expect(result.tokens.totalCacheRead).toBe(90000);
      expect(result.tokens.totalCacheCreation).toBe(10000);

      // LLM judge fail rate = 2 / (18 + 2) = 0.1
      expect(result.validators.llmJudgeSampled).toBe(20);
      expect(result.validators.llmJudgeFail).toBe(2);
      expect(result.validators.llmJudgeFailRate).toBeCloseTo(0.1, 4);

      // Tier breakdown
      expect(result.monthly.byTier).toEqual([
        { tier: 'BASIC', activeUsers: 3, totalChatsUsed: 30 },
        { tier: 'PRO', activeUsers: 2, totalChatsUsed: 60 },
      ]);

      // Extensions
      expect(result.extensions.sessionsExtendedCount).toBe(8);
      expect(result.extensions.totalCreditsSpent).toBe(12);

      // Sanity: generatedAt is an ISO string
      expect(typeof result.generatedAt).toBe('string');
      expect(() => new Date(result.generatedAt)).not.toThrow();
    });

    it('returns 0 rates when divisors are 0 (no data yet)', async () => {
      mockChatAggregateData({
        totalSessions: 0,
        sessionsLast7Days: 0,
        sessionsLast24Hours: 0,
        sessionsAtHardCap: 0,
        messagesByRole: [],
        refundedMessages: 0,
      });
      // Override to remove llm-judge data + cache token data
      mockPrisma.chatMessage.groupBy.mockReset();
      mockPrisma.chatMessage.groupBy
        .mockResolvedValueOnce([]) // messagesByRole — empty
        .mockResolvedValueOnce([]); // llmJudgeBreakdown — empty
      mockPrisma.chatMessage.aggregate.mockReset();
      mockPrisma.chatMessage.aggregate
        .mockResolvedValueOnce({ _count: { id: 0 } })
        .mockResolvedValueOnce({
          _sum: {
            cacheReadTokens: null,
            cacheCreationTokens: null,
            tokensInput: null,
            tokensOutput: null,
          },
        });
      mockPrisma.chatMonthlyUsage.groupBy.mockReset();
      mockPrisma.chatMonthlyUsage.groupBy.mockResolvedValueOnce([]);
      mockPrisma.chatSession.aggregate.mockReset();
      mockPrisma.chatSession.aggregate
        .mockResolvedValueOnce({
          _sum: { creditExtensions: null },
          _count: { id: 0 },
        })
        .mockResolvedValueOnce({
          _avg: { messageCount: null },
        });
      // Phase 1.11 — empty cost-bucket data
      mockPrisma.chatSession.findMany.mockReset();
      mockPrisma.chatSession.findMany.mockResolvedValueOnce([]);

      const result = await service.getChatAggregate();

      expect(result.sessions.total).toBe(0);
      expect(result.messages.total).toBe(0);
      expect(result.messages.refundRate).toBe(0);
      expect(result.tokens.cacheHitRate).toBe(0);
      expect(result.validators.llmJudgeFailRate).toBe(0);
      expect(result.monthly.byTier).toEqual([]);
      expect(result.extensions.totalCreditsSpent).toBe(0);
      expect(result.sessions.avgMessagesPerSession).toBe(0);
    });

    it('does NOT expose any user-identifying or message-content data', async () => {
      mockChatAggregateData();

      const result = await service.getChatAggregate();
      const json = JSON.stringify(result);

      // PDPA Phase 1: no userId, sessionId, message contents, or anything
      // that could identify a specific user/conversation should leak.
      expect(json).not.toMatch(/userId/i);
      expect(json).not.toMatch(/sessionId/i);
      expect(json).not.toMatch(/clerk/i);
      expect(json).not.toMatch(/content/i);
      expect(json).not.toMatch(/email/i);
    });

    it('Phase 1.11: returns 7-day cost breakdown bucketed by session length', async () => {
      mockChatAggregateData();

      const result = await service.getChatAggregate();

      expect(result.costByBucket.windowDays).toBe(7);
      expect(result.costByBucket.buckets).toHaveLength(3);
      // Ranges in expected order
      expect(result.costByBucket.buckets.map((b) => b.range)).toEqual([
        '1-10', '11-20', '21-30',
      ]);

      // Short session (msgCount=5) → 1-10 bucket
      const shortBucket = result.costByBucket.buckets.find((b) => b.range === '1-10');
      expect(shortBucket?.sessionCount).toBe(1);
      // Cost per message in short session: cacheRead 8000 × $0.30/MTok + output 200 × $15/MTok
      // = (8000 × 0.3 + 200 × 15) / 1e6 = (2400 + 3000) / 1e6 = 0.0054
      // 3 messages × 0.0054 = 0.0162 USD per session
      expect(shortBucket?.avgCostUsd).toBeCloseTo(0.0162, 4);

      // Empty middle bucket
      const middleBucket = result.costByBucket.buckets.find((b) => b.range === '11-20');
      expect(middleBucket?.sessionCount).toBe(0);
      expect(middleBucket?.avgCostUsd).toBe(0);

      // Long session (msgCount=30) → 21-30 bucket
      const longBucket = result.costByBucket.buckets.find((b) => b.range === '21-30');
      expect(longBucket?.sessionCount).toBe(1);
      // First message: cacheCreation 10000 × $6/MTok + output 500 × $15/MTok
      //               = (60000 + 7500) / 1e6 = 0.0675
      // 2 subsequent messages: each = (10000 × 0.3 + 500 × 15) / 1e6 = 0.0105
      // Total = 0.0675 + 2 × 0.0105 = 0.0885 USD per session
      expect(longBucket?.avgCostUsd).toBeCloseTo(0.0885, 4);
    });

    it('Phase 1.11: cost buckets are 0/0 when no sessions in window', async () => {
      // Use the empty-data test setup
      mockChatAggregateData({
        totalSessions: 0,
        sessionsLast7Days: 0,
        sessionsLast24Hours: 0,
        sessionsAtHardCap: 0,
        messagesByRole: [],
        refundedMessages: 0,
      });
      mockPrisma.chatSession.findMany.mockReset();
      mockPrisma.chatSession.findMany.mockResolvedValueOnce([]);

      const result = await service.getChatAggregate();

      expect(result.costByBucket.buckets.every((b) => b.sessionCount === 0)).toBe(true);
      expect(result.costByBucket.buckets.every((b) => b.avgCostUsd === 0)).toBe(true);
    });

    it('Phase 1.11: skips sessions with messageCount=0 in cost bucketing', async () => {
      mockChatAggregateData();
      // Override the findMany to include a session with no messages
      mockPrisma.chatSession.findMany.mockReset();
      mockPrisma.chatSession.findMany.mockResolvedValueOnce([
        { messageCount: 0, messages: [] },  // empty session — should be skipped
        {
          messageCount: 8,
          messages: [
            { cacheReadTokens: 1000, cacheCreationTokens: 0, tokensInput: 0, tokensOutput: 100 },
          ],
        },
      ]);

      const result = await service.getChatAggregate();

      // Only the 8-message session is counted in 1-10 bucket
      const shortBucket = result.costByBucket.buckets.find((b) => b.range === '1-10');
      expect(shortBucket?.sessionCount).toBe(1);
    });
  });

  // ============================================================
  // AI Costs
  // ============================================================

  describe('getAICosts', () => {
    function setupAICostsMocks(overrides?: {
      costByProvider?: Array<{ ai_provider: string; total_cost: number; count: bigint; avg_cost: number; total_input_tokens: bigint; total_output_tokens: bigint }>;
      costByReadingType?: Array<{
        reading_type: string | null; total_cost: number; count: bigint; avg_cost: number;
        avg_input_tokens: number; avg_output_tokens: number; total_input_tokens: bigint;
        total_output_tokens: bigint; avg_latency_ms: number; cache_hit_count: bigint;
      }>;
    }) {
      mockPrisma.aIUsageLog.aggregate.mockResolvedValue({
        _sum: { inputTokens: 50000, outputTokens: 25000 },
        _count: { id: 100 },
      });
      mockPrisma.aIUsageLog.count.mockResolvedValue(20); // cache hits

      // $queryRaw is called 3 times: costByProvider, dailyCosts, costByReadingType
      const costByProvider = overrides?.costByProvider ?? [
        { ai_provider: 'CLAUDE', total_cost: 1.5, count: BigInt(60), avg_cost: 0.025, total_input_tokens: BigInt(30000), total_output_tokens: BigInt(15000) },
        { ai_provider: 'GPT', total_cost: 0.8, count: BigInt(40), avg_cost: 0.02, total_input_tokens: BigInt(20000), total_output_tokens: BigInt(10000) },
      ];
      const dailyCosts = [
        { day: new Date('2026-02-10'), total_cost: 0.5, count: BigInt(30) },
        { day: new Date('2026-02-11'), total_cost: 0.7, count: BigInt(40) },
      ];
      const costByReadingType = overrides?.costByReadingType ?? [
        { reading_type: 'LIFETIME', total_cost: 0.8, count: BigInt(20), avg_cost: 0.04, avg_input_tokens: 2000, avg_output_tokens: 1000, total_input_tokens: BigInt(40000), total_output_tokens: BigInt(20000), avg_latency_ms: 2500, cache_hit_count: BigInt(5) },
        { reading_type: 'ZWDS_DAILY', total_cost: 0.3, count: BigInt(30), avg_cost: 0.01, avg_input_tokens: 500, avg_output_tokens: 200, total_input_tokens: BigInt(15000), total_output_tokens: BigInt(6000), avg_latency_ms: 800, cache_hit_count: BigInt(10) },
        { reading_type: 'ANNUAL', total_cost: 0.5, count: BigInt(25), avg_cost: 0.02, avg_input_tokens: 1500, avg_output_tokens: 800, total_input_tokens: BigInt(37500), total_output_tokens: BigInt(20000), avg_latency_ms: 1800, cache_hit_count: BigInt(3) },
        { reading_type: 'ZWDS_QA', total_cost: 0.2, count: BigInt(15), avg_cost: 0.013, avg_input_tokens: 800, avg_output_tokens: 400, total_input_tokens: BigInt(12000), total_output_tokens: BigInt(6000), avg_latency_ms: 1200, cache_hit_count: BigInt(2) },
      ];

      mockPrisma.$queryRaw
        .mockResolvedValueOnce(costByProvider)   // costByProvider
        .mockResolvedValueOnce(dailyCosts)        // dailyCosts
        .mockResolvedValueOnce(costByReadingType); // costByReadingType
    }

    it('should return correct response structure', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result).toHaveProperty('days', 30);
      expect(result).toHaveProperty('totalCost');
      expect(result).toHaveProperty('avgCostPerReading');
      expect(result).toHaveProperty('totalTokens');
      expect(result).toHaveProperty('totalInputTokens');
      expect(result).toHaveProperty('totalOutputTokens');
      expect(result).toHaveProperty('totalRequests');
      expect(result).toHaveProperty('cacheHitRate');
      expect(result).toHaveProperty('costByProvider');
      expect(result).toHaveProperty('costByReadingType');
      expect(result).toHaveProperty('costByTier');
      expect(result).toHaveProperty('dailyCosts');
    });

    it('should compute totalCost from provider costs', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result.totalCost).toBeCloseTo(2.3); // 1.5 + 0.8
    });

    it('should compute avgCostPerReading', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result.avgCostPerReading).toBeCloseTo(2.3 / 100);
    });

    it('should compute token totals', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result.totalTokens).toBe(75000);
      expect(result.totalInputTokens).toBe(50000);
      expect(result.totalOutputTokens).toBe(25000);
    });

    it('should compute cacheHitRate', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result.cacheHitRate).toBeCloseTo(0.2); // 20/100
    });

    it('should include avgCost and token fields in costByProvider', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result.costByProvider[0]).toEqual({
        provider: 'CLAUDE',
        totalCost: 1.5,
        count: 60,
        avgCost: 0.025,
        totalInputTokens: 30000,
        totalOutputTokens: 15000,
      });
    });

    it('should include all fields in costByReadingType', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result.costByReadingType).toHaveLength(4);
      const lifetime = result.costByReadingType.find((r: any) => r.readingType === 'LIFETIME');
      expect(lifetime).toEqual({
        readingType: 'LIFETIME',
        totalCost: 0.8,
        count: 20,
        avgCost: 0.04,
        avgInputTokens: 2000,
        avgOutputTokens: 1000,
        totalInputTokens: 40000,
        totalOutputTokens: 20000,
        avgLatencyMs: 2500,
        cacheHitRate: 0.25, // 5/20
      });
    });

    it('should map NULL reading_type to UNCLASSIFIED', async () => {
      setupAICostsMocks({
        costByReadingType: [
          { reading_type: null, total_cost: 0.1, count: BigInt(5), avg_cost: 0.02, avg_input_tokens: 500, avg_output_tokens: 200, total_input_tokens: BigInt(2500), total_output_tokens: BigInt(1000), avg_latency_ms: 1000, cache_hit_count: BigInt(0) },
        ],
      });

      const result = await service.getAICosts();

      expect(result.costByReadingType[0].readingType).toBe('UNCLASSIFIED');
    });

    it('should aggregate tiers correctly', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      // LIFETIME → comprehensive, ANNUAL → periodic, ZWDS_DAILY → daily, ZWDS_QA → qa
      expect(result.costByTier).toHaveLength(4);

      const comprehensive = result.costByTier.find((t: any) => t.tier === 'comprehensive');
      expect(comprehensive).toEqual({
        tier: 'comprehensive',
        label: 'Comprehensive',
        readingTypes: ['LIFETIME'],
        totalCost: 0.8,
        count: 20,
        avgCost: 0.04,
      });

      const periodic = result.costByTier.find((t: any) => t.tier === 'periodic');
      expect(periodic).toEqual({
        tier: 'periodic',
        label: 'Periodic',
        readingTypes: ['ANNUAL'],
        totalCost: 0.5,
        count: 25,
        avgCost: 0.02,
      });

      const daily = result.costByTier.find((t: any) => t.tier === 'daily');
      expect(daily).toEqual({
        tier: 'daily',
        label: 'Daily',
        readingTypes: ['ZWDS_DAILY'],
        totalCost: 0.3,
        count: 30,
        avgCost: 0.01,
      });

      const qa = result.costByTier.find((t: any) => t.tier === 'qa');
      expect(qa).toEqual({
        tier: 'qa',
        label: 'Q&A',
        readingTypes: ['ZWDS_QA'],
        totalCost: 0.2,
        count: 15,
        avgCost: expect.closeTo(0.013, 2),
      });
    });

    it('should accept days parameter (7 days)', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts(7);

      expect(result.days).toBe(7);
    });

    it('should accept days parameter (90 days)', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts(90);

      expect(result.days).toBe(90);
    });

    it('should clamp days to 1 minimum', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts(0);

      expect(result.days).toBe(1);
    });

    it('should clamp days to 365 maximum', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts(999);

      expect(result.days).toBe(365);
    });

    it('should clamp negative days to 1', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts(-5);

      expect(result.days).toBe(1);
    });

    it('should return fallback values on error', async () => {
      mockPrisma.aIUsageLog.aggregate.mockRejectedValue(new Error('DB connection failed'));

      const result = await service.getAICosts();

      expect(result.totalCost).toBe(0);
      expect(result.avgCostPerReading).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.totalRequests).toBe(0);
      expect(result.cacheHitRate).toBe(0);
      expect(result.costByProvider).toEqual([]);
      expect(result.costByReadingType).toEqual([]);
      expect(result.costByTier).toEqual([]);
      expect(result.dailyCosts).toEqual([]);
    });

    it('should return empty arrays when no data', async () => {
      mockPrisma.aIUsageLog.aggregate.mockResolvedValue({
        _sum: { inputTokens: 0, outputTokens: 0 },
        _count: { id: 0 },
      });
      mockPrisma.aIUsageLog.count.mockResolvedValue(0);
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])  // costByProvider
        .mockResolvedValueOnce([])  // dailyCosts
        .mockResolvedValueOnce([]); // costByReadingType

      const result = await service.getAICosts();

      expect(result.totalCost).toBe(0);
      expect(result.totalRequests).toBe(0);
      expect(result.costByProvider).toEqual([]);
      expect(result.costByReadingType).toEqual([]);
      expect(result.costByTier).toEqual([]);
      expect(result.dailyCosts).toEqual([]);
    });

    it('should map dailyCosts correctly', async () => {
      setupAICostsMocks();

      const result = await service.getAICosts();

      expect(result.dailyCosts).toHaveLength(2);
      expect(result.dailyCosts[0]).toEqual({
        date: new Date('2026-02-10'),
        totalCost: 0.5,
        count: 30,
      });
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
