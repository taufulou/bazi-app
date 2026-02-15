/**
 * Tests for Admin Monetization Analytics + Credit Package CRUD.
 * Covers:
 *   - getMonetizationAnalytics() — all query groups, error handling
 *   - listCreditPackages() — sorted by sortOrder
 *   - createCreditPackage() — validation, audit log, cache invalidation
 *   - updateCreditPackage() — partial updates, not found
 *   - Controller routing for new endpoints
 */
import { AdminService } from '../src/admin/admin.service';
import { AdminController } from '../src/admin/admin.controller';

// ============================================================
// Mock Services
// ============================================================

const mockPrisma = {
  creditPackage: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  adRewardLog: {
    groupBy: jest.fn(),
  },
  sectionUnlock: {
    groupBy: jest.fn(),
  },
  subscription: {
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  user: {
    count: jest.fn(),
  },
  adminAuditLog: {
    create: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

const mockRedis = {
  del: jest.fn(),
};

// ============================================================
// Test Data
// ============================================================

const AUTH_PAYLOAD = { userId: 'admin-user-abc', sessionId: 'sess_admin' };

const MOCK_CREDIT_PACKAGES = [
  {
    id: 'pkg-1',
    slug: 'starter-5',
    nameZhTw: '入門包',
    nameZhCn: '入门包',
    creditAmount: 5,
    priceUsd: 4.99,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 'pkg-2',
    slug: 'value-12',
    nameZhTw: '超值包',
    nameZhCn: '超值包',
    creditAmount: 12,
    priceUsd: 9.99,
    isActive: true,
    sortOrder: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 'pkg-3',
    slug: 'popular-30',
    nameZhTw: '熱門包',
    nameZhCn: '热门包',
    creditAmount: 30,
    priceUsd: 19.99,
    isActive: false,
    sortOrder: 2,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
];

// ============================================================
// Tests: AdminService — Credit Packages
// ============================================================

describe('AdminService — Credit Packages', () => {
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(mockPrisma as any, mockRedis as any);
  });

  describe('listCreditPackages', () => {
    it('should return all credit packages sorted by sortOrder', async () => {
      mockPrisma.creditPackage.findMany.mockResolvedValue(MOCK_CREDIT_PACKAGES);

      const result = await service.listCreditPackages();

      expect(result).toEqual(MOCK_CREDIT_PACKAGES);
      expect(result).toHaveLength(3);
      expect(mockPrisma.creditPackage.findMany).toHaveBeenCalledWith({
        orderBy: { sortOrder: 'asc' },
      });
    });

    it('should return empty array when no packages exist', async () => {
      mockPrisma.creditPackage.findMany.mockResolvedValue([]);

      const result = await service.listCreditPackages();
      expect(result).toEqual([]);
    });
  });

  describe('createCreditPackage', () => {
    const createData = {
      slug: 'mega-60',
      nameZhTw: '巨量包',
      nameZhCn: '巨量包',
      creditAmount: 60,
      priceUsd: 34.99,
    };

    it('should create a new credit package', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(null);
      const created = { id: 'pkg-new', ...createData, isActive: true, sortOrder: 0 };
      mockPrisma.creditPackage.create.mockResolvedValue(created);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await service.createCreditPackage(createData, AUTH_PAYLOAD.userId);

      expect(result).toEqual(created);
      expect(mockPrisma.creditPackage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          slug: 'mega-60',
          creditAmount: 60,
          priceUsd: 34.99,
          isActive: true,
          sortOrder: 0,
        }),
      });
      expect(mockRedis.del).toHaveBeenCalledWith('credit_packages:active');
    });

    it('should respect explicit isActive and sortOrder', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(null);
      mockPrisma.creditPackage.create.mockResolvedValue({ id: 'pkg-new', ...createData, isActive: false, sortOrder: 5 });
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      await service.createCreditPackage({ ...createData, isActive: false, sortOrder: 5 }, AUTH_PAYLOAD.userId);

      expect(mockPrisma.creditPackage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isActive: false, sortOrder: 5 }),
      });
    });

    it('should throw if slug already exists', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(MOCK_CREDIT_PACKAGES[0]);

      await expect(
        service.createCreditPackage({ ...createData, slug: 'starter-5' }, AUTH_PAYLOAD.userId),
      ).rejects.toThrow('Credit package with slug "starter-5" already exists');
    });

    it('should log audit entry on creation', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(null);
      const created = { id: 'pkg-audit', ...createData };
      mockPrisma.creditPackage.create.mockResolvedValue(created);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      await service.createCreditPackage(createData, AUTH_PAYLOAD.userId);

      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminUserId: AUTH_PAYLOAD.userId,
          action: 'create_credit_package',
          entityType: 'credit_package',
          entityId: 'pkg-audit',
        }),
      });
    });
  });

  describe('updateCreditPackage', () => {
    it('should update a credit package', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(MOCK_CREDIT_PACKAGES[0]);
      const updated = { ...MOCK_CREDIT_PACKAGES[0], priceUsd: 5.99 };
      mockPrisma.creditPackage.update.mockResolvedValue(updated);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await service.updateCreditPackage('pkg-1', { priceUsd: 5.99 }, AUTH_PAYLOAD.userId);

      expect(result.priceUsd).toBe(5.99);
      expect(mockPrisma.creditPackage.update).toHaveBeenCalledWith({
        where: { id: 'pkg-1' },
        data: { priceUsd: 5.99 },
      });
      expect(mockRedis.del).toHaveBeenCalledWith('credit_packages:active');
    });

    it('should throw when package not found', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCreditPackage('non-existent', { isActive: false }, AUTH_PAYLOAD.userId),
      ).rejects.toThrow('Credit package not found');
    });

    it('should toggle isActive', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(MOCK_CREDIT_PACKAGES[0]);
      const updated = { ...MOCK_CREDIT_PACKAGES[0], isActive: false };
      mockPrisma.creditPackage.update.mockResolvedValue(updated);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await service.updateCreditPackage('pkg-1', { isActive: false }, AUTH_PAYLOAD.userId);
      expect(result.isActive).toBe(false);
    });

    it('should log audit entry on update', async () => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(MOCK_CREDIT_PACKAGES[0]);
      mockPrisma.creditPackage.update.mockResolvedValue({ ...MOCK_CREDIT_PACKAGES[0], nameZhTw: '新名稱' });
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      await service.updateCreditPackage('pkg-1', { nameZhTw: '新名稱' }, AUTH_PAYLOAD.userId);

      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'update_credit_package',
          entityType: 'credit_package',
          entityId: 'pkg-1',
        }),
      });
    });
  });
});

// ============================================================
// Tests: AdminService — Monetization Analytics
// ============================================================

describe('AdminService — Monetization Analytics', () => {
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(mockPrisma as any, mockRedis as any);

    // Default mock returns for parallel queries
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.adRewardLog.groupBy.mockResolvedValue([]);
    mockPrisma.sectionUnlock.groupBy.mockResolvedValue([]);
    mockPrisma.subscription.groupBy.mockResolvedValue([]);
    mockPrisma.subscription.count.mockResolvedValue(0);
    mockPrisma.user.count.mockResolvedValue(0);
  });

  it('should return analytics with default 30 days', async () => {
    const result = await service.getMonetizationAnalytics();

    expect(result.days).toBe(30);
    expect(result).toHaveProperty('creditPackagePurchases');
    expect(result).toHaveProperty('adRewardClaims');
    expect(result).toHaveProperty('adRewardDailyTrend');
    expect(result).toHaveProperty('sectionUnlockStats');
    expect(result).toHaveProperty('activeSubscriptionsByTier');
    expect(result).toHaveProperty('newSubscriptions');
    expect(result).toHaveProperty('cancelledSubscriptions');
    expect(result).toHaveProperty('conversionFunnel');
    expect(result).toHaveProperty('revenueByType');
  });

  it('should clamp days to 1-365 range', async () => {
    const result1 = await service.getMonetizationAnalytics(0);
    expect(result1.days).toBe(1);

    const result2 = await service.getMonetizationAnalytics(999);
    expect(result2.days).toBe(365);
  });

  it('should return ad reward claims grouped by type', async () => {
    mockPrisma.adRewardLog.groupBy.mockResolvedValue([
      { rewardType: 'CREDIT', _count: { id: 25 }, _sum: { creditsGranted: 25 } },
      { rewardType: 'SECTION_UNLOCK', _count: { id: 10 }, _sum: { creditsGranted: 0 } },
    ]);

    const result = await service.getMonetizationAnalytics(30);

    expect(result.adRewardClaims).toHaveLength(2);
    expect(result.adRewardClaims[0]).toEqual({
      rewardType: 'CREDIT',
      count: 25,
      creditsGranted: 25,
    });
  });

  it('should return section unlock stats sorted by count', async () => {
    mockPrisma.sectionUnlock.groupBy.mockResolvedValue([
      { sectionKey: 'career', _count: { id: 15 } },
      { sectionKey: 'love', _count: { id: 30 } },
      { sectionKey: 'health', _count: { id: 5 } },
    ]);

    const result = await service.getMonetizationAnalytics(30);

    expect(result.sectionUnlockStats).toHaveLength(3);
    // Should be sorted descending by count
    expect(result.sectionUnlockStats[0].sectionKey).toBe('love');
    expect(result.sectionUnlockStats[0].count).toBe(30);
    expect(result.sectionUnlockStats[1].sectionKey).toBe('career');
    expect(result.sectionUnlockStats[2].sectionKey).toBe('health');
  });

  it('should return active subscriptions by tier', async () => {
    mockPrisma.subscription.groupBy.mockResolvedValue([
      { planTier: 'BASIC', _count: { id: 50 } },
      { planTier: 'PRO', _count: { id: 20 } },
      { planTier: 'MASTER', _count: { id: 5 } },
    ]);

    const result = await service.getMonetizationAnalytics(30);

    expect(result.activeSubscriptionsByTier).toHaveLength(3);
    expect(result.activeSubscriptionsByTier[0]).toEqual({ tier: 'BASIC', count: 50 });
  });

  it('should return conversion funnel metrics', async () => {
    mockPrisma.user.count.mockResolvedValue(1000);
    // $queryRaw returns are ordered by call sequence; need to handle multiple calls
    // The method calls $queryRaw multiple times for different queries
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([]) // creditPackagePurchases
      .mockResolvedValueOnce([]) // adRewardDaily
      .mockResolvedValueOnce([{ count: BigInt(250) }]) // usersWithReadings
      .mockResolvedValueOnce([]) // revenueByType
      .mockResolvedValueOnce([{ count: BigInt(50) }]); // creditPurchasers

    mockPrisma.subscription.count
      .mockResolvedValueOnce(10) // newSubscriptions
      .mockResolvedValueOnce(3) // cancelledSubscriptions
      .mockResolvedValueOnce(75); // subscriberCount

    const result = await service.getMonetizationAnalytics(30);

    expect(result.conversionFunnel).toEqual({
      totalUsers: 1000,
      usersWithReadings: 250,
      creditPurchasers: 50,
      subscribers: 75,
    });
  });

  it('should handle empty funnel data gracefully', async () => {
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([]) // creditPackagePurchases
      .mockResolvedValueOnce([]) // adRewardDaily
      .mockResolvedValueOnce([]) // usersWithReadings (empty)
      .mockResolvedValueOnce([]) // revenueByType
      .mockResolvedValueOnce([]); // creditPurchasers (empty)
    mockPrisma.subscription.count.mockResolvedValue(0);

    const result = await service.getMonetizationAnalytics(7);

    expect(result.conversionFunnel.totalUsers).toBe(0);
    expect(result.conversionFunnel.usersWithReadings).toBe(0);
    expect(result.conversionFunnel.creditPurchasers).toBe(0);
    expect(result.conversionFunnel.subscribers).toBe(0);
  });

  it('should return revenue breakdown by type', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([]) // creditPackagePurchases
      .mockResolvedValueOnce([]) // adRewardDaily
      .mockResolvedValueOnce([{ count: BigInt(0) }]) // usersWithReadings
      .mockResolvedValueOnce([ // revenueByType
        { type: 'SUBSCRIPTION', total: 500.0, count: BigInt(50) },
        { type: 'CREDIT_PURCHASE', total: 200.0, count: BigInt(40) },
      ])
      .mockResolvedValueOnce([{ count: BigInt(0) }]); // creditPurchasers

    const result = await service.getMonetizationAnalytics(30);

    expect(result.revenueByType).toHaveLength(2);
    expect(result.revenueByType[0]).toEqual({ type: 'SUBSCRIPTION', total: 500.0, count: 50 });
    expect(result.revenueByType[1]).toEqual({ type: 'CREDIT_PURCHASE', total: 200.0, count: 40 });
  });

  it('should return credit package purchase stats', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([ // creditPackagePurchases
        { description: 'starter-5', total_revenue: 49.90, count: BigInt(10), avg_amount: 4.99 },
        { description: 'value-12', total_revenue: 99.90, count: BigInt(10), avg_amount: 9.99 },
      ])
      .mockResolvedValueOnce([]) // adRewardDaily
      .mockResolvedValueOnce([{ count: BigInt(0) }]) // usersWithReadings
      .mockResolvedValueOnce([]) // revenueByType
      .mockResolvedValueOnce([{ count: BigInt(0) }]); // creditPurchasers

    const result = await service.getMonetizationAnalytics(30);

    expect(result.creditPackagePurchases).toHaveLength(2);
    expect(result.creditPackagePurchases[0]).toEqual({
      description: 'starter-5',
      totalRevenue: 49.90,
      count: 10,
      avgAmount: 4.99,
    });
  });

  it('should return ad reward daily trend', async () => {
    const day1 = new Date('2026-02-01');
    const day2 = new Date('2026-02-02');
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([]) // creditPackagePurchases
      .mockResolvedValueOnce([ // adRewardDaily
        { day: day1, count: BigInt(8) },
        { day: day2, count: BigInt(12) },
      ])
      .mockResolvedValueOnce([{ count: BigInt(0) }]) // usersWithReadings
      .mockResolvedValueOnce([]) // revenueByType
      .mockResolvedValueOnce([{ count: BigInt(0) }]); // creditPurchasers

    const result = await service.getMonetizationAnalytics(30);

    expect(result.adRewardDailyTrend).toHaveLength(2);
    expect(result.adRewardDailyTrend[0]).toEqual({ date: day1, count: 8 });
    expect(result.adRewardDailyTrend[1]).toEqual({ date: day2, count: 12 });
  });

  it('should return fallback response on database error', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await service.getMonetizationAnalytics(30);

    expect(result.days).toBe(30);
    expect(result.creditPackagePurchases).toEqual([]);
    expect(result.adRewardClaims).toEqual([]);
    expect(result.sectionUnlockStats).toEqual([]);
    expect(result.activeSubscriptionsByTier).toEqual([]);
    expect(result.conversionFunnel.totalUsers).toBe(0);
    expect(result.revenueByType).toEqual([]);
  });
});

// ============================================================
// Tests: AdminController — New Endpoints
// ============================================================

describe('AdminController — Monetization Endpoints', () => {
  let controller: AdminController;
  const mockService = {
    listCreditPackages: jest.fn(),
    createCreditPackage: jest.fn(),
    updateCreditPackage: jest.fn(),
    getMonetizationAnalytics: jest.fn(),
    // Existing methods (not tested here but needed for constructor)
    getDashboardStats: jest.fn(),
    listServices: jest.fn(),
    updateService: jest.fn(),
    listPlans: jest.fn(),
    updatePlan: jest.fn(),
    listPromoCodes: jest.fn(),
    createPromoCode: jest.fn(),
    updatePromoCode: jest.fn(),
    validatePromoCode: jest.fn(),
    listPromptTemplates: jest.fn(),
    updatePromptTemplate: jest.fn(),
    listGateways: jest.fn(),
    updateGateway: jest.fn(),
    listUsers: jest.fn(),
    getUserDetail: jest.fn(),
    adjustUserCredits: jest.fn(),
    getAICosts: jest.fn(),
    getRevenue: jest.fn(),
    getAuditLog: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AdminController(mockService as any);
  });

  describe('GET /api/admin/credit-packages', () => {
    it('should return all credit packages', async () => {
      mockService.listCreditPackages.mockResolvedValue(MOCK_CREDIT_PACKAGES);

      const result = await controller.listCreditPackages();
      expect(result).toEqual(MOCK_CREDIT_PACKAGES);
      expect(mockService.listCreditPackages).toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/credit-packages', () => {
    it('should create a credit package', async () => {
      const data = {
        slug: 'mega-60',
        nameZhTw: '巨量包',
        nameZhCn: '巨量包',
        creditAmount: 60,
        priceUsd: 34.99,
      };
      const created = { id: 'pkg-new', ...data };
      mockService.createCreditPackage.mockResolvedValue(created);

      const result = await controller.createCreditPackage(AUTH_PAYLOAD as any, data);
      expect(result).toEqual(created);
      expect(mockService.createCreditPackage).toHaveBeenCalledWith(data, AUTH_PAYLOAD.userId);
    });
  });

  describe('PATCH /api/admin/credit-packages/:id', () => {
    it('should update a credit package', async () => {
      const updated = { ...MOCK_CREDIT_PACKAGES[0], priceUsd: 5.99 };
      mockService.updateCreditPackage.mockResolvedValue(updated);

      const result = await controller.updateCreditPackage(
        AUTH_PAYLOAD as any,
        'pkg-1',
        { priceUsd: 5.99 },
      );
      expect(result).toEqual(updated);
      expect(mockService.updateCreditPackage).toHaveBeenCalledWith('pkg-1', { priceUsd: 5.99 }, AUTH_PAYLOAD.userId);
    });
  });

  describe('GET /api/admin/monetization-analytics', () => {
    it('should return monetization analytics with default 30 days', async () => {
      const analytics = {
        days: 30,
        creditPackagePurchases: [],
        adRewardClaims: [],
        adRewardDailyTrend: [],
        sectionUnlockStats: [],
        activeSubscriptionsByTier: [],
        newSubscriptions: 0,
        cancelledSubscriptions: 0,
        conversionFunnel: { totalUsers: 100, usersWithReadings: 50, creditPurchasers: 10, subscribers: 5 },
        revenueByType: [],
      };
      mockService.getMonetizationAnalytics.mockResolvedValue(analytics);

      const result = await controller.getMonetizationAnalytics(30);
      expect(result).toEqual(analytics);
      expect(mockService.getMonetizationAnalytics).toHaveBeenCalledWith(30);
    });

    it('should pass custom day range', async () => {
      mockService.getMonetizationAnalytics.mockResolvedValue({ days: 7 });

      await controller.getMonetizationAnalytics(7);
      expect(mockService.getMonetizationAnalytics).toHaveBeenCalledWith(7);
    });
  });
});
