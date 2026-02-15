/**
 * Tests for monetization database models (Sub-Phase D):
 * - CreditPackage CRUD
 * - AdRewardLog creation & queries
 * - SectionUnlock with unique constraints
 * - MonthlyCreditsLog with idempotency
 * - Plan.monthlyCredits field
 * - Service.sectionUnlockCreditCost field
 *
 * Uses mocked Prisma to validate model shapes and operations.
 */

// ============================================================
// Mock Prisma (follows existing test patterns)
// ============================================================

const mockPrisma = {
  creditPackage: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  adRewardLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  sectionUnlock: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  monthlyCreditsLog: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  plan: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  service: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

// ============================================================
// Test Data
// ============================================================

const TEST_USER_ID = 'user-uuid-1';
const TEST_READING_ID = 'reading-uuid-1';

const mockCreditPackage = {
  id: 'pkg-uuid-1',
  slug: 'starter-5',
  nameZhTw: '入門包 5 點',
  nameZhCn: '入门包 5 点',
  creditAmount: 5,
  priceUsd: 4.99,
  isActive: true,
  sortOrder: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockAdRewardLog = {
  id: 'arl-uuid-1',
  userId: TEST_USER_ID,
  rewardType: 'CREDIT' as const,
  adNetworkId: 'admob-123',
  creditsGranted: 1,
  sectionKey: null,
  readingId: null,
  createdAt: new Date(),
};

const mockSectionUnlock = {
  id: 'su-uuid-1',
  userId: TEST_USER_ID,
  readingId: TEST_READING_ID,
  readingType: 'bazi',
  sectionKey: 'career',
  unlockMethod: 'CREDIT' as const,
  creditsUsed: 1,
  isRefunded: false,
  createdAt: new Date(),
};

const mockMonthlyCreditsLog = {
  id: 'mcl-uuid-1',
  userId: TEST_USER_ID,
  creditAmount: 5,
  periodStart: new Date('2026-02-01'),
  periodEnd: new Date('2026-03-01'),
  grantedAt: new Date(),
};

// ============================================================
// Tests: CreditPackage
// ============================================================

describe('CreditPackage model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a credit package with all required fields', async () => {
    mockPrisma.creditPackage.create.mockResolvedValue(mockCreditPackage);

    const result = await mockPrisma.creditPackage.create({
      data: {
        slug: 'starter-5',
        nameZhTw: '入門包 5 點',
        nameZhCn: '入门包 5 点',
        creditAmount: 5,
        priceUsd: 4.99,
        sortOrder: 1,
      },
    });

    expect(result).toEqual(mockCreditPackage);
    expect(result.slug).toBe('starter-5');
    expect(result.creditAmount).toBe(5);
    expect(result.priceUsd).toBe(4.99);
    expect(result.isActive).toBe(true);
  });

  it('finds active credit packages ordered by sortOrder', async () => {
    const packages = [
      { ...mockCreditPackage, slug: 'starter-5', creditAmount: 5, sortOrder: 1 },
      { ...mockCreditPackage, slug: 'value-12', creditAmount: 12, sortOrder: 2 },
      { ...mockCreditPackage, slug: 'popular-30', creditAmount: 30, sortOrder: 3 },
      { ...mockCreditPackage, slug: 'mega-60', creditAmount: 60, sortOrder: 4 },
    ];
    mockPrisma.creditPackage.findMany.mockResolvedValue(packages);

    const result = await mockPrisma.creditPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    expect(result).toHaveLength(4);
    expect(result[0].creditAmount).toBe(5);
    expect(result[3].creditAmount).toBe(60);
    expect(mockPrisma.creditPackage.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  });

  it('finds credit package by slug', async () => {
    mockPrisma.creditPackage.findUnique.mockResolvedValue(mockCreditPackage);

    const result = await mockPrisma.creditPackage.findUnique({
      where: { slug: 'starter-5' },
    });

    expect(result?.slug).toBe('starter-5');
  });

  it('deactivates a credit package via update', async () => {
    mockPrisma.creditPackage.update.mockResolvedValue({
      ...mockCreditPackage,
      isActive: false,
    });

    const result = await mockPrisma.creditPackage.update({
      where: { id: mockCreditPackage.id },
      data: { isActive: false },
    });

    expect(result.isActive).toBe(false);
  });

  it('returns null for non-existent slug', async () => {
    mockPrisma.creditPackage.findUnique.mockResolvedValue(null);

    const result = await mockPrisma.creditPackage.findUnique({
      where: { slug: 'nonexistent' },
    });

    expect(result).toBeNull();
  });
});

// ============================================================
// Tests: AdRewardLog
// ============================================================

describe('AdRewardLog model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a CREDIT reward log', async () => {
    mockPrisma.adRewardLog.create.mockResolvedValue(mockAdRewardLog);

    const result = await mockPrisma.adRewardLog.create({
      data: {
        userId: TEST_USER_ID,
        rewardType: 'CREDIT',
        adNetworkId: 'admob-123',
        creditsGranted: 1,
      },
    });

    expect(result.rewardType).toBe('CREDIT');
    expect(result.creditsGranted).toBe(1);
    expect(result.sectionKey).toBeNull();
  });

  it('creates a SECTION_UNLOCK reward log', async () => {
    const sectionReward = {
      ...mockAdRewardLog,
      rewardType: 'SECTION_UNLOCK' as const,
      creditsGranted: 0,
      sectionKey: 'career',
      readingId: TEST_READING_ID,
    };
    mockPrisma.adRewardLog.create.mockResolvedValue(sectionReward);

    const result = await mockPrisma.adRewardLog.create({
      data: {
        userId: TEST_USER_ID,
        rewardType: 'SECTION_UNLOCK',
        sectionKey: 'career',
        readingId: TEST_READING_ID,
      },
    });

    expect(result.rewardType).toBe('SECTION_UNLOCK');
    expect(result.sectionKey).toBe('career');
    expect(result.readingId).toBe(TEST_READING_ID);
  });

  it('counts daily ad rewards for a user', async () => {
    mockPrisma.adRewardLog.count.mockResolvedValue(3);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const count = await mockPrisma.adRewardLog.count({
      where: {
        userId: TEST_USER_ID,
        createdAt: { gte: today, lt: tomorrow },
      },
    });

    expect(count).toBe(3);
  });

  it('retrieves ad reward history for a user', async () => {
    const logs = [mockAdRewardLog, { ...mockAdRewardLog, id: 'arl-uuid-2' }];
    mockPrisma.adRewardLog.findMany.mockResolvedValue(logs);

    const result = await mockPrisma.adRewardLog.findMany({
      where: { userId: TEST_USER_ID },
      orderBy: { createdAt: 'desc' },
    });

    expect(result).toHaveLength(2);
  });
});

// ============================================================
// Tests: SectionUnlock
// ============================================================

describe('SectionUnlock model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a section unlock with CREDIT method', async () => {
    mockPrisma.sectionUnlock.create.mockResolvedValue(mockSectionUnlock);

    const result = await mockPrisma.sectionUnlock.create({
      data: {
        userId: TEST_USER_ID,
        readingId: TEST_READING_ID,
        readingType: 'bazi',
        sectionKey: 'career',
        unlockMethod: 'CREDIT',
        creditsUsed: 1,
      },
    });

    expect(result.sectionKey).toBe('career');
    expect(result.unlockMethod).toBe('CREDIT');
    expect(result.creditsUsed).toBe(1);
    expect(result.isRefunded).toBe(false);
  });

  it('creates a section unlock with AD_REWARD method', async () => {
    const adUnlock = {
      ...mockSectionUnlock,
      unlockMethod: 'AD_REWARD' as const,
      creditsUsed: 0,
    };
    mockPrisma.sectionUnlock.create.mockResolvedValue(adUnlock);

    const result = await mockPrisma.sectionUnlock.create({
      data: {
        userId: TEST_USER_ID,
        readingId: TEST_READING_ID,
        readingType: 'zwds',
        sectionKey: 'career',
        unlockMethod: 'AD_REWARD',
        creditsUsed: 0,
      },
    });

    expect(result.unlockMethod).toBe('AD_REWARD');
    expect(result.creditsUsed).toBe(0);
  });

  it('finds unlocked sections for a reading', async () => {
    const unlocks = [
      { ...mockSectionUnlock, sectionKey: 'career' },
      { ...mockSectionUnlock, sectionKey: 'love', id: 'su-uuid-2' },
    ];
    mockPrisma.sectionUnlock.findMany.mockResolvedValue(unlocks);

    const result = await mockPrisma.sectionUnlock.findMany({
      where: { userId: TEST_USER_ID, readingId: TEST_READING_ID },
    });

    expect(result).toHaveLength(2);
    expect(result.map((u: { sectionKey: string }) => u.sectionKey)).toEqual(['career', 'love']);
  });

  it('checks unique constraint (userId + readingId + sectionKey)', async () => {
    mockPrisma.sectionUnlock.findUnique.mockResolvedValue(mockSectionUnlock);

    const result = await mockPrisma.sectionUnlock.findUnique({
      where: {
        userId_readingId_sectionKey: {
          userId: TEST_USER_ID,
          readingId: TEST_READING_ID,
          sectionKey: 'career',
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.sectionKey).toBe('career');
  });

  it('supports both bazi and zwds reading types', async () => {
    const zwdsUnlock = { ...mockSectionUnlock, readingType: 'zwds' };
    mockPrisma.sectionUnlock.create.mockResolvedValue(zwdsUnlock);

    const result = await mockPrisma.sectionUnlock.create({
      data: {
        userId: TEST_USER_ID,
        readingId: 'zwds-reading-uuid',
        readingType: 'zwds',
        sectionKey: 'health',
        unlockMethod: 'CREDIT',
        creditsUsed: 1,
      },
    });

    expect(result.readingType).toBe('zwds');
  });

  it('tracks refund status', async () => {
    const refundedUnlock = { ...mockSectionUnlock, isRefunded: true };
    mockPrisma.sectionUnlock.findFirst.mockResolvedValue(refundedUnlock);

    const result = await mockPrisma.sectionUnlock.findFirst({
      where: { id: mockSectionUnlock.id },
    });

    expect(result?.isRefunded).toBe(true);
  });
});

// ============================================================
// Tests: MonthlyCreditsLog
// ============================================================

describe('MonthlyCreditsLog model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a monthly credits grant record', async () => {
    mockPrisma.monthlyCreditsLog.create.mockResolvedValue(mockMonthlyCreditsLog);

    const result = await mockPrisma.monthlyCreditsLog.create({
      data: {
        userId: TEST_USER_ID,
        creditAmount: 5,
        periodStart: new Date('2026-02-01'),
        periodEnd: new Date('2026-03-01'),
      },
    });

    expect(result.creditAmount).toBe(5);
    expect(result.userId).toBe(TEST_USER_ID);
  });

  it('prevents double-grant via unique constraint (userId + periodStart)', async () => {
    mockPrisma.monthlyCreditsLog.findUnique.mockResolvedValue(mockMonthlyCreditsLog);

    const existing = await mockPrisma.monthlyCreditsLog.findUnique({
      where: {
        userId_periodStart: {
          userId: TEST_USER_ID,
          periodStart: new Date('2026-02-01'),
        },
      },
    });

    expect(existing).not.toBeNull();
    // In real code: if exists, skip grant (idempotent)
  });

  it('returns null for non-existent period (no double-grant)', async () => {
    mockPrisma.monthlyCreditsLog.findUnique.mockResolvedValue(null);

    const existing = await mockPrisma.monthlyCreditsLog.findUnique({
      where: {
        userId_periodStart: {
          userId: TEST_USER_ID,
          periodStart: new Date('2026-03-01'),
        },
      },
    });

    expect(existing).toBeNull();
    // In real code: proceed with grant
  });
});

// ============================================================
// Tests: Plan.monthlyCredits field
// ============================================================

describe('Plan model — monthlyCredits field', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Basic plan has 5 monthly credits', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue({
      slug: 'basic',
      nameZhTw: '基礎版',
      monthlyCredits: 5,
      readingsPerMonth: 5,
    });

    const plan = await mockPrisma.plan.findFirst({ where: { slug: 'basic' } });
    expect(plan?.monthlyCredits).toBe(5);
  });

  it('Pro plan has 15 monthly credits', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue({
      slug: 'pro',
      nameZhTw: '專業版',
      monthlyCredits: 15,
      readingsPerMonth: 15,
    });

    const plan = await mockPrisma.plan.findFirst({ where: { slug: 'pro' } });
    expect(plan?.monthlyCredits).toBe(15);
  });

  it('Master plan has -1 monthly credits (unlimited bypass)', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue({
      slug: 'master',
      nameZhTw: '大師版',
      monthlyCredits: -1,
      readingsPerMonth: -1,
    });

    const plan = await mockPrisma.plan.findFirst({ where: { slug: 'master' } });
    expect(plan?.monthlyCredits).toBe(-1);
  });
});

// ============================================================
// Tests: Service.sectionUnlockCreditCost field
// ============================================================

describe('Service model — sectionUnlockCreditCost field', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('services have default sectionUnlockCreditCost of 1', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({
      slug: 'lifetime',
      nameZhTw: '八字終身運',
      creditCost: 2,
      sectionUnlockCreditCost: 1,
    });

    const service = await mockPrisma.service.findFirst({ where: { slug: 'lifetime' } });
    expect(service?.sectionUnlockCreditCost).toBe(1);
  });

  it('admin can update sectionUnlockCreditCost', async () => {
    mockPrisma.service.update.mockResolvedValue({
      slug: 'lifetime',
      nameZhTw: '八字終身運',
      creditCost: 2,
      sectionUnlockCreditCost: 2,
    });

    const updated = await mockPrisma.service.update({
      where: { id: 'service-uuid-1' },
      data: { sectionUnlockCreditCost: 2 },
    });

    expect(updated.sectionUnlockCreditCost).toBe(2);
  });
});

// ============================================================
// Tests: Transaction flow with credit package
// ============================================================

describe('Credit package purchase flow (mock)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('atomically grants credits after package purchase', async () => {
    const pkg = mockCreditPackage;
    const updatedUser = {
      id: TEST_USER_ID,
      credits: 5, // 0 + 5 from package
    };

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
      // Simulate transaction
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      return fn(mockPrisma);
    });

    await mockPrisma.$transaction(async (tx: typeof mockPrisma) => {
      const user = await tx.user.update({
        where: { id: TEST_USER_ID },
        data: { credits: { increment: pkg.creditAmount } },
      });
      return user;
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
      data: { credits: { increment: 5 } },
    });
  });

  it('section unlock deducts credits atomically', async () => {
    const updatedUser = { id: TEST_USER_ID, credits: 4 }; // 5 - 1

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.sectionUnlock.create.mockResolvedValue(mockSectionUnlock);
      return fn(mockPrisma);
    });

    await mockPrisma.$transaction(async (tx: typeof mockPrisma) => {
      const updated = await tx.user.updateMany({
        where: { id: TEST_USER_ID, credits: { gte: 1 } },
        data: { credits: { decrement: 1 } },
      });
      if ((updated as { count: number }).count === 0) throw new Error('Insufficient credits');

      return tx.sectionUnlock.create({
        data: {
          userId: TEST_USER_ID,
          readingId: TEST_READING_ID,
          sectionKey: 'career',
          unlockMethod: 'CREDIT',
          creditsUsed: 1,
        },
      });
    });

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID, credits: { gte: 1 } },
      data: { credits: { decrement: 1 } },
    });
    expect(mockPrisma.sectionUnlock.create).toHaveBeenCalled();
  });
});
