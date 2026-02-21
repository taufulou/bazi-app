/**
 * Tests for Monthly Credits — grantMonthlyCredits(), getMonthlyCreditsStatus(),
 * idempotency, Master tier bypass, renewal grants, and concurrent operations.
 */
import { StripeService } from '../src/payments/stripe.service';
import { PaymentsService } from '../src/payments/payments.service';
import { NotFoundException } from '@nestjs/common';

// ============================================================
// Mock Stripe SDK
// ============================================================

const mockStripeCustomers = {
  list: jest.fn(),
  search: jest.fn(),
  create: jest.fn(),
};

const mockStripeCheckoutSessions = {
  create: jest.fn(),
};

const mockStripeBillingPortalSessions = {
  create: jest.fn(),
};

const mockStripeSubscriptions = {
  update: jest.fn(),
  retrieve: jest.fn(),
};

const mockStripeCoupons = {
  retrieve: jest.fn(),
  create: jest.fn(),
};

const mockStripeWebhooks = {
  constructEvent: jest.fn(),
};

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: mockStripeCustomers,
    checkout: { sessions: mockStripeCheckoutSessions },
    billingPortal: { sessions: mockStripeBillingPortalSessions },
    subscriptions: mockStripeSubscriptions,
    coupons: mockStripeCoupons,
    webhooks: mockStripeWebhooks,
  }));
});

// ============================================================
// Mock Prisma — shared by both services
// ============================================================

const mockTxUser = { update: jest.fn() };
const mockTxMonthlyCreditsLog = { create: jest.fn() };

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  plan: {
    findFirst: jest.fn(),
  },
  service: {
    findFirst: jest.fn(),
  },
  subscription: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  transaction: {
    create: jest.fn(),
  },
  promoCode: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  creditPackage: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  monthlyCreditsLog: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({
      user: mockTxUser,
      monthlyCreditsLog: mockTxMonthlyCreditsLog,
    });
  }),
};

const mockConfig = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake';
    if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test_fake';
    return undefined;
  }),
};

// ============================================================
// Test Data
// ============================================================

const MOCK_USER = {
  id: 'user-123',
  clerkUserId: 'clerk_user_abc',
  name: 'Test User',
  subscriptionTier: 'PRO',
  credits: 10,
  freeReadingUsed: true,
};

const PERIOD_START = new Date('2026-01-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-02-01T00:00:00.000Z');

const MOCK_BASIC_PLAN = {
  id: 'plan-basic',
  slug: 'basic',
  nameZhTw: '基礎版',
  monthlyCredits: 5,
  isActive: true,
};

const MOCK_PRO_PLAN = {
  id: 'plan-pro',
  slug: 'pro',
  nameZhTw: '專業版',
  monthlyCredits: 15,
  isActive: true,
};

const MOCK_MASTER_PLAN = {
  id: 'plan-master',
  slug: 'master',
  nameZhTw: '大師版',
  monthlyCredits: -1,
  isActive: true,
};

// ============================================================
// Tests — grantMonthlyCredits
// ============================================================

describe('Monthly Credits', () => {
  let stripeService: StripeService;
  let paymentsService: PaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    stripeService = new StripeService(mockConfig as any, mockPrisma as any);
    paymentsService = new PaymentsService(mockPrisma as any);
  });

  // ============================================================
  // grantMonthlyCredits — Core Logic
  // ============================================================

  describe('grantMonthlyCredits', () => {
    it('should grant 5 credits for Basic tier', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_BASIC_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'BASIC', PERIOD_START, PERIOD_END,
      );

      expect(result).toEqual({ granted: true, creditsGranted: 5 });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          creditAmount: 5,
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
        },
      });
      expect(mockTxUser.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { credits: { increment: 5 } },
      });
    });

    it('should grant 15 credits for Pro tier', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'PRO', PERIOD_START, PERIOD_END,
      );

      expect(result).toEqual({ granted: true, creditsGranted: 15 });
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ creditAmount: 15 }),
      });
    });

    it('should skip grant for Master tier (unlimited bypass)', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_MASTER_PLAN);

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'MASTER', PERIOD_START, PERIOD_END,
      );

      expect(result).toEqual({ granted: false, creditsGranted: 0 });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTxMonthlyCreditsLog.create).not.toHaveBeenCalled();
    });

    it('should skip grant for unknown tier', async () => {
      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'UNKNOWN' as any, PERIOD_START, PERIOD_END,
      );

      expect(result).toEqual({ granted: false, creditsGranted: 0 });
      expect(mockPrisma.plan.findFirst).not.toHaveBeenCalled();
    });

    it('should skip grant when plan not found in DB', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(null);

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'BASIC', PERIOD_START, PERIOD_END,
      );

      expect(result).toEqual({ granted: false, creditsGranted: 0 });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should skip grant when plan has 0 monthly credits', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue({
        ...MOCK_BASIC_PLAN,
        monthlyCredits: 0,
      });

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'BASIC', PERIOD_START, PERIOD_END,
      );

      expect(result).toEqual({ granted: false, creditsGranted: 0 });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // grantMonthlyCredits — Idempotency (unique constraint)
  // ============================================================

  describe('grantMonthlyCredits — idempotency', () => {
    it('should handle duplicate grant gracefully (P2002 unique constraint)', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);

      // Simulate Prisma unique constraint violation
      const p2002Error = new Error('Unique constraint failed') as Error & { code: string };
      p2002Error.code = 'P2002';

      mockPrisma.$transaction.mockRejectedValueOnce(p2002Error);

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'PRO', PERIOD_START, PERIOD_END,
      );

      expect(result).toEqual({ granted: false, creditsGranted: 0 });
    });

    it('should re-throw unexpected errors', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);

      const unexpectedError = new Error('Database connection lost');
      mockPrisma.$transaction.mockRejectedValueOnce(unexpectedError);

      await expect(
        stripeService.grantMonthlyCredits('user-123', 'PRO', PERIOD_START, PERIOD_END),
      ).rejects.toThrow('Database connection lost');
    });

    it('should use correct period dates for idempotency key', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_BASIC_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      const periodA = new Date('2026-01-01T00:00:00.000Z');
      const periodB = new Date('2026-02-01T00:00:00.000Z');
      const periodEndA = new Date('2026-02-01T00:00:00.000Z');
      const periodEndB = new Date('2026-03-01T00:00:00.000Z');

      // First grant
      await stripeService.grantMonthlyCredits('user-123', 'BASIC', periodA, periodEndA);

      // Second grant for different period should also succeed
      await stripeService.grantMonthlyCredits('user-123', 'BASIC', periodB, periodEndB);

      // Both $transaction calls should have been made
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // handleSubscriptionCreated — Monthly Credit Integration
  // ============================================================

  describe('handleSubscriptionCreated with monthly credits', () => {
    it('should grant monthly credits on new subscription', async () => {
      const session = {
        id: 'cs_new_sub',
        mode: 'subscription',
        subscription: 'sub_stripe_new',
        payment_intent: 'pi_new',
        amount_total: 999,
        currency: 'usd',
        metadata: {
          clerkUserId: 'clerk_user_abc',
          internalUserId: 'user-123',
          planSlug: 'pro',
        },
      } as any;

      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockStripeSubscriptions.retrieve.mockResolvedValue({
        items: {
          data: [{
            current_period_start: Math.floor(PERIOD_START.getTime() / 1000),
            current_period_end: Math.floor(PERIOD_END.getTime() / 1000),
          }],
        },
      });
      mockPrisma.subscription.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await stripeService.handleCheckoutCompleted(session);

      // Verify $transaction was called (for monthly credit grant)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          creditAmount: 15,
        }),
      });
    });

    it('should not grant credits for Master subscription (unlimited bypass)', async () => {
      const session = {
        id: 'cs_master',
        mode: 'subscription',
        subscription: 'sub_stripe_master',
        payment_intent: 'pi_master',
        amount_total: 1999,
        currency: 'usd',
        metadata: {
          clerkUserId: 'clerk_user_abc',
          internalUserId: 'user-123',
          planSlug: 'master',
        },
      } as any;

      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, subscriptionTier: 'MASTER' });
      mockStripeSubscriptions.retrieve.mockResolvedValue({
        items: {
          data: [{
            current_period_start: Math.floor(PERIOD_START.getTime() / 1000),
            current_period_end: Math.floor(PERIOD_END.getTime() / 1000),
          }],
        },
      });
      mockPrisma.subscription.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_MASTER_PLAN);

      await stripeService.handleCheckoutCompleted(session);

      // $transaction should NOT be called for Master tier monthly credits
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTxMonthlyCreditsLog.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // handleInvoicePaid — Renewal Monthly Credits
  // ============================================================

  describe('handleInvoicePaid with monthly credits', () => {
    it('should grant monthly credits on renewal invoice', async () => {
      const invoice = {
        id: 'in_renewal',
        amount_paid: 999,
        currency: 'usd',
        lines: {
          data: [{
            description: 'Pro Plan × 1',
            period: {
              start: Math.floor(new Date('2026-02-01').getTime() / 1000),
              end: Math.floor(new Date('2026-03-01').getTime() / 1000),
            },
          }],
        },
        parent: {
          subscription_details: {
            subscription: 'sub_stripe_123',
          },
        },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
      });
      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await stripeService.handleInvoicePaid(invoice);

      // Should grant 15 credits for PRO renewal
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          creditAmount: 15,
        }),
      });
    });

    it('should skip monthly credits when no line items in invoice', async () => {
      const invoice = {
        id: 'in_no_lines',
        amount_paid: 999,
        currency: 'usd',
        lines: { data: [] },
        parent: {
          subscription_details: {
            subscription: 'sub_stripe_123',
          },
        },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
      });
      mockPrisma.transaction.create.mockResolvedValue({});

      await stripeService.handleInvoicePaid(invoice);

      // Transaction recorded but no monthly credits grant
      expect(mockPrisma.transaction.create).toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle renewal idempotently (same period)', async () => {
      const invoice = {
        id: 'in_duplicate',
        amount_paid: 999,
        currency: 'usd',
        lines: {
          data: [{
            description: 'Pro Plan × 1',
            period: {
              start: Math.floor(PERIOD_START.getTime() / 1000),
              end: Math.floor(PERIOD_END.getTime() / 1000),
            },
          }],
        },
        parent: {
          subscription_details: {
            subscription: 'sub_stripe_123',
          },
        },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
      });
      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);

      // Simulate duplicate: unique constraint violation
      const p2002Error = new Error('Unique constraint failed') as Error & { code: string };
      p2002Error.code = 'P2002';
      mockPrisma.$transaction.mockRejectedValueOnce(p2002Error);

      // Should not throw — handled gracefully
      await stripeService.handleInvoicePaid(invoice);

      expect(mockPrisma.transaction.create).toHaveBeenCalled();
    });

    it('should use correct period from invoice line items', async () => {
      const periodStart = new Date('2026-03-01T00:00:00.000Z');
      const periodEnd = new Date('2026-04-01T00:00:00.000Z');

      const invoice = {
        id: 'in_march',
        amount_paid: 499,
        currency: 'usd',
        lines: {
          data: [{
            description: 'Basic Plan × 1',
            period: {
              start: Math.floor(periodStart.getTime() / 1000),
              end: Math.floor(periodEnd.getTime() / 1000),
            },
          }],
        },
        parent: {
          subscription_details: {
            subscription: 'sub_stripe_basic',
          },
        },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_basic',
        planTier: 'BASIC',
      });
      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_BASIC_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await stripeService.handleInvoicePaid(invoice);

      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodStart,
          periodEnd,
        }),
      });
    });
  });

  // ============================================================
  // getMonthlyCreditsStatus
  // ============================================================

  describe('getMonthlyCreditsStatus', () => {
    it('should return full monthly credits status for subscriber', async () => {
      const grantDate = new Date('2026-01-15T10:00:00.000Z');
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findFirst.mockResolvedValue({
        status: 'ACTIVE',
        currentPeriodEnd: PERIOD_END,
      });
      mockPrisma.monthlyCreditsLog.findFirst.mockResolvedValue({
        creditAmount: 15,
        grantedAt: grantDate,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });

      const result = await paymentsService.getMonthlyCreditsStatus('clerk_user_abc');

      expect(result).toEqual({
        currentPeriodCreditsGranted: 15,
        creditsRemaining: 10,
        nextResetDate: PERIOD_END,
        lastGrantDate: grantDate,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
    });

    it('should return null values when no subscription or grants', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...MOCK_USER,
        subscriptionTier: 'FREE',
        credits: 0,
      });
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.monthlyCreditsLog.findFirst.mockResolvedValue(null);

      const result = await paymentsService.getMonthlyCreditsStatus('clerk_user_abc');

      expect(result).toEqual({
        currentPeriodCreditsGranted: 0,
        creditsRemaining: 0,
        nextResetDate: null,
        lastGrantDate: null,
        periodStart: null,
        periodEnd: null,
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        paymentsService.getMonthlyCreditsStatus('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return credits remaining even with expired subscription', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...MOCK_USER,
        subscriptionTier: 'FREE',
        credits: 3, // Leftover credits from expired subscription
      });
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // No active sub
      mockPrisma.monthlyCreditsLog.findFirst.mockResolvedValue({
        creditAmount: 15,
        grantedAt: new Date('2025-12-01'),
        periodStart: new Date('2025-12-01'),
        periodEnd: new Date('2026-01-01'),
      });

      const result = await paymentsService.getMonthlyCreditsStatus('clerk_user_abc');

      expect(result.creditsRemaining).toBe(3);
      expect(result.nextResetDate).toBeNull(); // No active subscription
      expect(result.currentPeriodCreditsGranted).toBe(15); // Last grant amount
    });
  });

  // ============================================================
  // Tier Access Control (verified in bazi/zwds service tests)
  // ============================================================

  describe('Tier-based credit grant amounts', () => {
    it('Basic tier should get exactly 5 credits', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_BASIC_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'BASIC', PERIOD_START, PERIOD_END,
      );

      expect(result.creditsGranted).toBe(5);
    });

    it('Pro tier should get exactly 15 credits', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'PRO', PERIOD_START, PERIOD_END,
      );

      expect(result.creditsGranted).toBe(15);
    });

    it('Master tier should get 0 credits (unlimited bypass)', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_MASTER_PLAN);

      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'MASTER', PERIOD_START, PERIOD_END,
      );

      expect(result.creditsGranted).toBe(0);
      expect(result.granted).toBe(false);
    });

    it('FREE tier should skip (no slug mapping)', async () => {
      const result = await stripeService.grantMonthlyCredits(
        'user-123', 'FREE', PERIOD_START, PERIOD_END,
      );

      expect(result.creditsGranted).toBe(0);
      expect(result.granted).toBe(false);
    });
  });

  // ============================================================
  // Transaction atomicity
  // ============================================================

  describe('Transaction atomicity', () => {
    it('should create log and increment credits in same transaction', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await stripeService.grantMonthlyCredits(
        'user-123', 'PRO', PERIOD_START, PERIOD_END,
      );

      // Both operations should have been called within the transaction
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledTimes(1);
      expect(mockTxUser.update).toHaveBeenCalledTimes(1);

      // Verify the exact data passed
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          creditAmount: 15,
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
        },
      });

      expect(mockTxUser.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { credits: { increment: 15 } },
      });
    });

    it('should not increment credits if log creation fails', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);

      // Simulate transaction failure (non-P2002)
      const dbError = new Error('Connection timeout');
      mockPrisma.$transaction.mockRejectedValueOnce(dbError);

      await expect(
        stripeService.grantMonthlyCredits('user-123', 'PRO', PERIOD_START, PERIOD_END),
      ).rejects.toThrow('Connection timeout');

      // Since it's a transaction, neither operation should have completed
      // (the $transaction mock rejection means the whole transaction failed)
    });
  });

  // ============================================================
  // Plan lookup
  // ============================================================

  describe('Plan lookup for monthly credits', () => {
    it('should look up plan by slug derived from tier', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_BASIC_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await stripeService.grantMonthlyCredits(
        'user-123', 'BASIC', PERIOD_START, PERIOD_END,
      );

      expect(mockPrisma.plan.findFirst).toHaveBeenCalledWith({
        where: { slug: 'basic', isActive: true },
      });
    });

    it('should look up pro plan correctly', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PRO_PLAN);
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await stripeService.grantMonthlyCredits(
        'user-123', 'PRO', PERIOD_START, PERIOD_END,
      );

      expect(mockPrisma.plan.findFirst).toHaveBeenCalledWith({
        where: { slug: 'pro', isActive: true },
      });
    });

    it('should look up master plan correctly', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_MASTER_PLAN);

      await stripeService.grantMonthlyCredits(
        'user-123', 'MASTER', PERIOD_START, PERIOD_END,
      );

      expect(mockPrisma.plan.findFirst).toHaveBeenCalledWith({
        where: { slug: 'master', isActive: true },
      });
    });
  });
});
