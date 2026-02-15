/**
 * Tests for StripeService — payment operations, subscription management, webhooks.
 * Uses mocked Stripe SDK and PrismaService.
 */
import { StripeService } from '../src/payments/stripe.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

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

// Mock the Stripe constructor
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
// Mock Prisma
// ============================================================

const mockMonthlyCreditsLog = {
  create: jest.fn(),
  findFirst: jest.fn(),
};

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
  monthlyCreditsLog: mockMonthlyCreditsLog,
  $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    // Execute the transaction callback with mock tx objects
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
  subscriptionTier: 'FREE',
  credits: 0,
  freeReadingUsed: false,
};

const MOCK_PLAN = {
  id: 'plan-1',
  slug: 'pro',
  nameZhTw: '進階版',
  nameZhCn: '进阶版',
  priceMonthly: 9.99,
  priceAnnual: 79.99,
  currency: 'USD',
  featuresJson: {},
  readingsPerMonth: 15,
  isActive: true,
};

const MOCK_SERVICE = {
  id: 'svc-1',
  slug: 'lifetime',
  nameZhTw: '八字終身運',
  nameZhCn: '八字终身运',
  creditCost: 199, // in cents
  isActive: true,
};

// ============================================================
// Tests
// ============================================================

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StripeService(mockConfig as any, mockPrisma as any);
  });

  // ============================================================
  // Subscription Checkout
  // ============================================================

  describe('createSubscriptionCheckout', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PLAN);
      mockStripeCustomers.search.mockResolvedValue({ data: [{ id: 'cus_123' }] });
      mockStripeCheckoutSessions.create.mockResolvedValue({
        id: 'cs_123',
        url: 'https://checkout.stripe.com/test',
      });
    });

    it('should create a monthly subscription checkout session', async () => {
      const result = await service.createSubscriptionCheckout({
        clerkUserId: 'clerk_user_abc',
        planSlug: 'pro',
        billingCycle: 'monthly',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result.sessionId).toBe('cs_123');
      expect(result.url).toBe('https://checkout.stripe.com/test');
      expect(mockStripeCheckoutSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          customer: 'cus_123',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
        }),
      );
    });

    it('should create an annual subscription checkout with correct pricing', async () => {
      await service.createSubscriptionCheckout({
        clerkUserId: 'clerk_user_abc',
        planSlug: 'pro',
        billingCycle: 'annual',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      const createCall = mockStripeCheckoutSessions.create.mock.calls[0][0];
      expect(createCall.line_items[0].price_data.unit_amount).toBe(7999); // $79.99 in cents
      expect(createCall.line_items[0].price_data.recurring.interval).toBe('year');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createSubscriptionCheckout({
          clerkUserId: 'nonexistent',
          planSlug: 'pro',
          billingCycle: 'monthly',
          successUrl: 'url',
          cancelUrl: 'url',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when plan not found', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(null);

      await expect(
        service.createSubscriptionCheckout({
          clerkUserId: 'clerk_user_abc',
          planSlug: 'nonexistent',
          billingCycle: 'monthly',
          successUrl: 'url',
          cancelUrl: 'url',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should include metadata in session', async () => {
      await service.createSubscriptionCheckout({
        clerkUserId: 'clerk_user_abc',
        planSlug: 'pro',
        billingCycle: 'monthly',
        successUrl: 'url',
        cancelUrl: 'url',
      });

      const createCall = mockStripeCheckoutSessions.create.mock.calls[0][0];
      expect(createCall.metadata).toEqual(
        expect.objectContaining({
          clerkUserId: 'clerk_user_abc',
          planSlug: 'pro',
          billingCycle: 'monthly',
          internalUserId: 'user-123',
        }),
      );
    });
  });

  // ============================================================
  // One-Time Checkout
  // ============================================================

  describe('createOneTimeCheckout', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.service.findFirst.mockResolvedValue(MOCK_SERVICE);
      mockStripeCustomers.search.mockResolvedValue({ data: [{ id: 'cus_123' }] });
      mockStripeCheckoutSessions.create.mockResolvedValue({
        id: 'cs_456',
        url: 'https://checkout.stripe.com/one-time',
      });
    });

    it('should create a one-time checkout session', async () => {
      const result = await service.createOneTimeCheckout({
        clerkUserId: 'clerk_user_abc',
        serviceSlug: 'lifetime',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result.sessionId).toBe('cs_456');
      expect(result.url).toBe('https://checkout.stripe.com/one-time');
      expect(mockStripeCheckoutSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'payment' }),
      );
    });

    it('should throw NotFoundException when service not found', async () => {
      mockPrisma.service.findFirst.mockResolvedValue(null);

      await expect(
        service.createOneTimeCheckout({
          clerkUserId: 'clerk_user_abc',
          serviceSlug: 'nonexistent',
          successUrl: 'url',
          cancelUrl: 'url',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Portal Session
  // ============================================================

  describe('createPortalSession', () => {
    it('should create a customer portal session', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockStripeCustomers.search.mockResolvedValue({ data: [{ id: 'cus_123' }] });
      mockStripeBillingPortalSessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/portal',
      });

      const result = await service.createPortalSession('clerk_user_abc', 'https://example.com/dashboard');

      expect(result.url).toBe('https://billing.stripe.com/portal');
      expect(mockStripeBillingPortalSessions.create).toHaveBeenCalledWith({
        customer: 'cus_123',
        return_url: 'https://example.com/dashboard',
      });
    });

    it('should throw BadRequestException when no Stripe customer found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockStripeCustomers.search.mockResolvedValue({ data: [] });

      await expect(
        service.createPortalSession('clerk_user_abc', 'url'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================================
  // Subscription Management
  // ============================================================

  describe('cancelSubscription', () => {
    it('should cancel subscription at period end', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-db-1',
        stripeSubscriptionId: 'sub_stripe_123',
        status: 'ACTIVE',
      });
      mockStripeSubscriptions.update.mockResolvedValue({
        items: {
          data: [{ current_period_end: Math.floor(Date.now() / 1000) + 2592000 }],
        },
      });
      mockPrisma.subscription.update.mockResolvedValue({});

      const result = await service.cancelSubscription('clerk_user_abc');

      expect(result.success).toBe(true);
      expect(result.endsAt).toBeDefined();
      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_123',
        { cancel_at_period_end: true },
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-db-1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('should throw NotFoundException when no active subscription', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelSubscription('clerk_user_abc'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reactivateSubscription', () => {
    it('should reactivate a cancelled subscription', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-db-1',
        stripeSubscriptionId: 'sub_stripe_123',
        status: 'CANCELLED',
      });
      mockStripeSubscriptions.update.mockResolvedValue({});
      mockPrisma.subscription.update.mockResolvedValue({});

      const result = await service.reactivateSubscription('clerk_user_abc');

      expect(result.success).toBe(true);
      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_123',
        { cancel_at_period_end: false },
      );
    });

    it('should throw NotFoundException when no cancelled subscription', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(
        service.reactivateSubscription('clerk_user_abc'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Free Reading
  // ============================================================

  describe('canUseFreeReading', () => {
    it('should return true when free reading not used', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, freeReadingUsed: false });

      const result = await service.canUseFreeReading('clerk_user_abc');
      expect(result).toBe(true);
    });

    it('should return false when free reading already used', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, freeReadingUsed: true });

      const result = await service.canUseFreeReading('clerk_user_abc');
      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.canUseFreeReading('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('markFreeReadingUsed', () => {
    it('should set freeReadingUsed to true', async () => {
      mockPrisma.user.update.mockResolvedValue({});

      await service.markFreeReadingUsed('clerk_user_abc');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { clerkUserId: 'clerk_user_abc' },
        data: { freeReadingUsed: true },
      });
    });
  });

  // ============================================================
  // Webhook — Signature Verification
  // ============================================================

  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', () => {
      const mockEvent = { type: 'checkout.session.completed', id: 'evt_123' };
      mockStripeWebhooks.constructEvent.mockReturnValue(mockEvent);

      const result = service.verifyWebhookSignature(Buffer.from('body'), 'sig_123');

      expect(result).toEqual(mockEvent);
      expect(mockStripeWebhooks.constructEvent).toHaveBeenCalledWith(
        Buffer.from('body'),
        'sig_123',
        'whsec_test_fake',
      );
    });

    it('should throw when webhook secret not configured', () => {
      const serviceNoSecret = new StripeService(
        { get: jest.fn().mockReturnValue(undefined) } as any,
        mockPrisma as any,
      );

      expect(() =>
        serviceNoSecret.verifyWebhookSignature(Buffer.from('body'), 'sig'),
      ).toThrow(BadRequestException);
    });
  });

  // ============================================================
  // Webhook — Checkout Completed
  // ============================================================

  describe('handleCheckoutCompleted', () => {
    it('should handle subscription checkout completion', async () => {
      const session = {
        id: 'cs_123',
        mode: 'subscription',
        subscription: 'sub_stripe_456',
        payment_intent: 'pi_789',
        amount_total: 999,
        currency: 'usd',
        metadata: {
          clerkUserId: 'clerk_user_abc',
          internalUserId: 'user-123',
          planSlug: 'pro',
        },
      } as any;

      mockStripeSubscriptions.retrieve.mockResolvedValue({
        items: {
          data: [{
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          }],
        },
      });
      mockPrisma.subscription.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      // Mock plan lookup for grantMonthlyCredits
      mockPrisma.plan.findFirst.mockResolvedValue({ ...MOCK_PLAN, slug: 'pro', monthlyCredits: 15 });
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await service.handleCheckoutCompleted(session);

      expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            stripeSubscriptionId: 'sub_stripe_456',
            planTier: 'PRO',
            status: 'ACTIVE',
            platform: 'STRIPE',
          }),
        }),
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: { subscriptionTier: 'PRO' },
        }),
      );
    });

    it('should handle one-time payment checkout completion', async () => {
      const session = {
        id: 'cs_456',
        mode: 'payment',
        payment_intent: 'pi_one_time',
        amount_total: 199,
        currency: 'usd',
        metadata: {
          clerkUserId: 'clerk_user_abc',
          internalUserId: 'user-123',
          serviceSlug: 'lifetime',
          type: 'one_time',
        },
      } as any;

      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleCheckoutCompleted(session);

      expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            type: 'ONE_TIME',
            amount: 1.99,
          }),
        }),
      );

      // Should add credits
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { credits: { increment: 1 } },
        }),
      );
    });

    it('should skip when metadata is missing', async () => {
      const session = { id: 'cs_no_meta', mode: 'subscription', metadata: {} } as any;

      await service.handleCheckoutCompleted(session);

      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Webhook — Subscription Updated
  // ============================================================

  describe('handleSubscriptionUpdated', () => {
    it('should update existing subscription status and tier', async () => {
      const sub = {
        id: 'sub_stripe_123',
        status: 'active',
        cancel_at: null,
        items: {
          data: [{
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          }],
        },
        metadata: {
          internalUserId: 'user-123',
          planSlug: 'master',
        },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1' });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(sub);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-db-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            planTier: 'MASTER',
          }),
        }),
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { subscriptionTier: 'MASTER' },
        }),
      );
    });

    it('should downgrade user to FREE when subscription cancelled', async () => {
      const sub = {
        id: 'sub_stripe_123',
        status: 'canceled',
        cancel_at: null,
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
        metadata: { internalUserId: 'user-123', planSlug: 'pro' },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1' });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(sub);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { subscriptionTier: 'FREE' },
        }),
      );
    });

    it('should skip when metadata is missing', async () => {
      const sub = { id: 'sub_no_meta', status: 'active', metadata: {} } as any;

      await service.handleSubscriptionUpdated(sub);

      expect(mockPrisma.subscription.findFirst).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Webhook — Subscription Deleted
  // ============================================================

  describe('handleSubscriptionDeleted', () => {
    it('should expire subscription and downgrade user', async () => {
      const sub = {
        id: 'sub_stripe_123',
        metadata: { internalUserId: 'user-123' },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1', userId: 'user-123' });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionDeleted(sub);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'EXPIRED' },
        }),
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { subscriptionTier: 'FREE' },
        }),
      );
    });

    it('should skip when metadata missing', async () => {
      await service.handleSubscriptionDeleted({ id: 'sub_x', metadata: {} } as any);
      expect(mockPrisma.subscription.findFirst).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Webhook — Invoice Paid
  // ============================================================

  describe('handleInvoicePaid', () => {
    it('should record transaction for subscription invoice', async () => {
      const invoice = {
        id: 'in_123',
        amount_paid: 999,
        currency: 'usd',
        lines: { data: [{ description: 'Pro Plan × 1', period: { start: 1700000000, end: 1702592000 } }] },
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
      // Mock for grantMonthlyCredits
      mockPrisma.plan.findFirst.mockResolvedValue({ ...MOCK_PLAN, slug: 'pro', monthlyCredits: 15 });
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await service.handleInvoicePaid(invoice);

      expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            stripePaymentId: 'in_123',
            amount: 9.99,
            currency: 'USD',
            type: 'SUBSCRIPTION',
          }),
        }),
      );
    });

    it('should skip when no subscription in invoice', async () => {
      const invoice = { id: 'in_no_sub', parent: null } as any;
      await service.handleInvoicePaid(invoice);
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Webhook — Invoice Failed
  // ============================================================

  describe('handleInvoiceFailed', () => {
    it('should mark subscription as PAST_DUE and downgrade user', async () => {
      const invoice = {
        id: 'in_fail',
        parent: {
          subscription_details: {
            subscription: 'sub_stripe_123',
          },
        },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-db-1',
        userId: 'user-123',
      });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleInvoiceFailed(invoice);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PAST_DUE' },
        }),
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { subscriptionTier: 'FREE' },
        }),
      );
    });
  });

  // ============================================================
  // Customer Management
  // ============================================================

  describe('getOrCreateStripeCustomer (via checkout)', () => {
    it('should return existing customer ID if found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PLAN);
      mockStripeCustomers.search.mockResolvedValue({ data: [{ id: 'cus_existing' }] });
      mockStripeCheckoutSessions.create.mockResolvedValue({ id: 'cs_x', url: 'url' });

      await service.createSubscriptionCheckout({
        clerkUserId: 'clerk_user_abc',
        planSlug: 'pro',
        billingCycle: 'monthly',
        successUrl: 'url',
        cancelUrl: 'url',
      });

      expect(mockStripeCustomers.create).not.toHaveBeenCalled();
      expect(mockStripeCheckoutSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing' }),
      );
    });

    it('should create new customer if not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.plan.findFirst.mockResolvedValue(MOCK_PLAN);
      mockStripeCustomers.search.mockResolvedValue({ data: [] });
      mockStripeCustomers.create.mockResolvedValue({ id: 'cus_new' });
      mockStripeCheckoutSessions.create.mockResolvedValue({ id: 'cs_x', url: 'url' });

      await service.createSubscriptionCheckout({
        clerkUserId: 'clerk_user_abc',
        planSlug: 'pro',
        billingCycle: 'monthly',
        successUrl: 'url',
        cancelUrl: 'url',
      });

      expect(mockStripeCustomers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            clerkUserId: 'clerk_user_abc',
          }),
        }),
      );
    });
  });

  // ============================================================
  // Plan Slug to Tier Mapping
  // ============================================================

  describe('planSlugToTier (tested via webhook)', () => {
    it('should map basic to BASIC', async () => {
      const sub = {
        id: 'sub_1',
        status: 'active',
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
        metadata: { internalUserId: 'user-123', planSlug: 'basic' },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1' });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(sub);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planTier: 'BASIC' }),
        }),
      );
    });

    it('should default unknown slugs to FREE', async () => {
      const sub = {
        id: 'sub_1',
        status: 'active',
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
        metadata: { internalUserId: 'user-123', planSlug: 'unknown' },
      } as any;

      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1' });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(sub);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planTier: 'FREE' }),
        }),
      );
    });
  });
});
