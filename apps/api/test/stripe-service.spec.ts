/**
 * Tests for StripeService — payment operations, subscription management, webhooks.
 * Uses mocked Stripe SDK and PrismaService.
 */
import { StripeService } from '../src/payments/stripe.service';
import { EntitlementsService } from '../src/payments/entitlements.service';
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

// Mock Sentry so the unusable-metadata alert is observable + inert.
const mockCaptureMessage = jest.fn();
jest.mock('@sentry/nestjs', () => ({ captureMessage: (...args: unknown[]) => mockCaptureMessage(...args) }));

const mockTxUser = { update: jest.fn() };
const mockTxMonthlyCreditsLog = { create: jest.fn() };
// Distinct from the top-level mockPrisma.transaction / .user clients on purpose.
// The $transaction mock below merely invokes its callback with no rollback
// semantics, so it is behaviourally identical to two sequential non-transactional
// writes — meaning "did this land inside the transaction?" can only be asserted by
// checking WHICH client received the write. Without that, a later refactor that
// dropped the transaction entirely would keep every test green.
const mockTxTransaction = { create: jest.fn() };
const mockTxCreditLedger = { create: jest.fn() };

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
    findMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
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
      transaction: mockTxTransaction,
      creditLedger: mockTxCreditLedger,
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
    service = new StripeService(
      mockConfig as any,
      mockPrisma as any,
      // RedisService stub — pre-existing test gap (constructor takes redis;
      // tests didn't pass it before this fix)
      { get: jest.fn(), set: jest.fn() } as any,
      // M6: StripeService now consumes a provider-neutral EntitlementsService
      // (tier recompute from active subs + credit grants + chat resnapshot).
      // Construct a REAL one over the same mockPrisma so the handlers exercise
      // the real tier-recompute/grant path against mocks.
      new EntitlementsService(mockPrisma as any, {
        resnapshotChatQuotaOnTierChange: jest.fn(),
      } as any),
    );
    // M6 default: no active subs unless a test overrides. Webhook handlers read
    // active subs via syncUserTier / the governing-sub grant.
    mockPrisma.subscription.findMany.mockResolvedValue([]);
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
        { get: jest.fn(), set: jest.fn() } as any,
        { resnapshotChatQuotaOnTierChange: jest.fn() } as any,
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
      mockPrisma.subscription.upsert.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      // Mock plan lookup for grantMonthlyCredits
      mockPrisma.plan.findFirst.mockResolvedValue({ ...MOCK_PLAN, slug: 'pro', monthlyCredits: 15 });
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});
      // M6: PRO sub active → syncUserTier writes PRO; user starts FREE.
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', planTier: 'PRO', currentPeriodStart: new Date(1700000000 * 1000), currentPeriodEnd: new Date(1702592000 * 1000), status: 'ACTIVE' },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);

      await service.handleCheckoutCompleted(session);

      // UPSERT, not create — `customer.subscription.updated` may have written a
      // provisional row first, and a bare create would P2002 before the credit grant.
      expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeSubscriptionId: 'sub_stripe_456' },
          create: expect.objectContaining({
            userId: 'user-123',
            stripeSubscriptionId: 'sub_stripe_456',
            planTier: 'PRO',
            status: 'ACTIVE',
            platform: 'STRIPE',
          }),
        }),
      );

      // The update branch must NOT force status back to ACTIVE (resurrection vector
      // on Stripe's 3-day retry if the user cancelled in between).
      const upsertArg = mockPrisma.subscription.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(upsertArg.update).not.toHaveProperty('status');

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

      // Both writes now go through the tx client: they were split into two
      // independent top-level statements, which is what allowed a retry to
      // commit the Transaction row and never reach the increment. The amount
      // formatting assertion (199 cents -> 1.99) is the part this test uniquely
      // covers and is preserved.
      expect(mockTxTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            type: 'ONE_TIME',
            amount: 1.99,
          }),
        }),
      );

      // Should add credits
      expect(mockTxUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { credits: { increment: 1 } },
        }),
      );
    });

    it('should skip when metadata is missing', async () => {
      const session = { id: 'cs_no_meta', mode: 'subscription', metadata: {} } as any;

      await service.handleCheckoutCompleted(session);

      expect(mockPrisma.subscription.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------
    // Ordering integration — the regression this pair of fixes exists for.
    // `customer.subscription.updated` arrives FIRST and creates the row; the
    // later `checkout.session.completed` must still reach the Transaction write
    // and the credit grant. With a bare create it threw P2002 at the row write,
    // so the user paid and received ZERO credits (and Stripe retried for days).
    // ----------------------------------------------------------
    it('updated-then-checkout still records the transaction and grants credits', async () => {
      const updatedEvent = {
        id: 'sub_stripe_456',
        status: 'active',
        cancel_at: null,
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
        metadata: { internalUserId: 'user-123', planSlug: 'pro' },
      } as any;

      const session = {
        id: 'cs_race',
        mode: 'subscription',
        subscription: 'sub_stripe_456',
        payment_intent: 'pi_race',
        amount_total: 999,
        currency: 'usd',
        metadata: {
          clerkUserId: 'clerk_user_abc',
          internalUserId: 'user-123',
          planSlug: 'pro',
        },
      } as any;

      const activeRow = {
        id: 'sub-db-race',
        planTier: 'PRO',
        status: 'ACTIVE',
        createdAt: new Date(),
        currentPeriodStart: new Date(1700000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
      };

      // --- event 1: subscription.updated wins the race (no row yet) ---
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findMany.mockResolvedValue([activeRow]);
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(updatedEvent);
      expect(mockPrisma.subscription.create).toHaveBeenCalledTimes(1);

      // --- event 2: checkout.session.completed arrives for the SAME sub ---
      mockStripeSubscriptions.retrieve.mockResolvedValue({
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
      });
      // The row now exists → upsert takes its update branch (no P2002 escape).
      mockPrisma.subscription.upsert.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.plan.findFirst.mockResolvedValue({ ...MOCK_PLAN, slug: 'pro', monthlyCredits: 15 });
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});

      await expect(service.handleCheckoutCompleted(session)).resolves.not.toThrow();

      // Exactly ONE row created across both events (event 2 upserted, not created).
      expect(mockPrisma.subscription.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.subscription.upsert).toHaveBeenCalledTimes(1);
      // And the two statements AFTER the row write were reached:
      expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(1);
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledTimes(1);
    });

    // Making the subscription upsert retry-safe was not sufficient on its own:
    // Transaction.stripePaymentId is @unique and is written BETWEEN syncUserTier
    // and the initial credit grant. If a retry re-ran this handler after that row
    // already existed, an escaping P2002 made the controller 500 — so the Redis
    // idempotency key was never set, Stripe retried, and the grant below was never
    // reached again. The user stays ACTIVE and correctly tiered (invisible at a
    // glance) but never receives their initial credits.
    it('survives a redelivered checkout (P2002 on the Transaction) and still grants', async () => {
      const session = {
        id: 'cs_redelivered',
        mode: 'subscription',
        subscription: 'sub_stripe_789',
        payment_intent: 'pi_redelivered',
        amount_total: 999,
        currency: 'usd',
        metadata: { clerkUserId: 'clerk_user_abc', internalUserId: 'user-123', planSlug: 'pro' },
      } as any;

      mockStripeSubscriptions.retrieve.mockResolvedValue({
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
      });
      mockPrisma.subscription.upsert.mockResolvedValue({});
      // The row from the first (partially-successful) delivery.
      mockPrisma.transaction.create.mockRejectedValue({ code: 'P2002' });
      mockPrisma.plan.findFirst.mockResolvedValue({ ...MOCK_PLAN, slug: 'pro', monthlyCredits: 15 });
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          planTier: 'PRO',
          status: 'ACTIVE',
          createdAt: new Date(),
          currentPeriodStart: new Date(1700000000 * 1000),
          currentPeriodEnd: new Date(1702592000 * 1000),
        },
      ]);

      await expect(service.handleCheckoutCompleted(session)).resolves.not.toThrow();

      // The regression: execution must REACH the grant, not die on the conflict.
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledTimes(1);
    });

    it('rethrows a non-P2002 Transaction failure on checkout', async () => {
      const session = {
        id: 'cs_dberr',
        mode: 'subscription',
        subscription: 'sub_stripe_790',
        payment_intent: 'pi_dberr',
        amount_total: 999,
        currency: 'usd',
        metadata: { clerkUserId: 'clerk_user_abc', internalUserId: 'user-123', planSlug: 'pro' },
      } as any;

      mockStripeSubscriptions.retrieve.mockResolvedValue({
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
      });
      mockPrisma.subscription.upsert.mockResolvedValue({});
      mockPrisma.transaction.create.mockRejectedValue({ code: 'P1001' });
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findMany.mockResolvedValue([]);
      mockPrisma.user.update.mockResolvedValue({});

      await expect(service.handleCheckoutCompleted(session)).rejects.toEqual({ code: 'P1001' });
      expect(mockTxMonthlyCreditsLog.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Webhook — One-time payment (mode: 'payment')
  //
  // This handler had ZERO coverage. It previously wrote the Transaction row and
  // the credit increment as two independent statements, so a failure between
  // them left the row committed; Stripe then retried into an uncaught P2002 on
  // every attempt and the increment was never reached — paid, nothing received.
  // It also returned normally (=> HTTP 200) when the metadata could not produce a
  // grant, which set the Redis idempotency key and stopped Stripe retrying at all.
  //
  // The mocked $transaction merely invokes its callback, so it is behaviourally
  // identical to two sequential writes. Every test therefore asserts WHICH client
  // received each write; otherwise a refactor that dropped the transaction would
  // keep them all green.
  // ============================================================

  describe('handleOneTimePayment (via handleCheckoutCompleted)', () => {
    const PKG = { id: 'pkg-1', slug: 'value-12', creditAmount: 12, isActive: true };

    const packageSession = (overrides: Record<string, unknown> = {}) =>
      ({
        id: 'cs_pack',
        mode: 'payment',
        payment_intent: 'pi_pack',
        amount_total: 199,
        currency: 'usd',
        metadata: {
          clerkUserId: 'clerk_user_abc',
          internalUserId: 'user-123',
          type: 'credit_package',
          creditPackageId: 'pkg-1',
          creditAmount: '12',
          packageSlug: 'value-12',
        },
        ...overrides,
      }) as any;

    const legacySession = (overrides: Record<string, unknown> = {}) =>
      ({
        id: 'cs_legacy',
        mode: 'payment',
        payment_intent: 'pi_legacy',
        amount_total: 199,
        currency: 'usd',
        metadata: {
          clerkUserId: 'clerk_user_abc',
          internalUserId: 'user-123',
          serviceSlug: 'lifetime',
        },
        ...overrides,
      }) as any;

    beforeEach(() => {
      mockPrisma.creditPackage.findUnique.mockResolvedValue(PKG);
    });

    // ---- credit-package branch ----

    it('grants a credit pack atomically — one transaction, no top-level writes', async () => {
      await service.handleCheckoutCompleted(packageSession());

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Positive: the branch was actually entered (guards against a fixture that
      // silently skips the whole block and makes the negatives below vacuous).
      expect(mockTxTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'CREDIT_PURCHASE', stripePaymentId: 'pi_pack' }),
        }),
      );
      expect(mockTxUser.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { credits: { increment: 12 } },
      });
      // Ledger row — this path previously granted credits with no audit trail.
      expect(mockTxCreditLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-123', amount: 12 }) }),
      );
      // The write must NOT have gone through the non-transactional clients.
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('survives a redelivered pack purchase (P2002) without granting twice', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });

      await expect(service.handleCheckoutCompleted(packageSession())).resolves.not.toThrow();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTxUser.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rethrows a non-P2002 failure (e.g. P2028 timeout) leaving no partial state', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2028' });

      await expect(service.handleCheckoutCompleted(packageSession())).rejects.toEqual({ code: 'P2028' });

      // Rolled back: nothing on either client.
      expect(mockTxUser.update).not.toHaveBeenCalled();
      expect(mockTxCreditLedger.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });

    it('falls back to session.id when payment_intent is absent', async () => {
      // @unique on a NULLable column permits unlimited NULLs, which would
      // silently disable the idempotency guard entirely.
      await service.handleCheckoutCompleted(packageSession({ payment_intent: null }));

      expect(mockTxTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stripePaymentId: 'cs_pack' }) }),
      );
    });

    it('THROWS on unusable metadata instead of silently acking the charge', async () => {
      // Previously this returned normally -> 200 -> Redis idempotency key set ->
      // Stripe never retries -> the customer's payment vanishes with no row and
      // no error. Throwing keeps the event replayable.
      await expect(
        service.handleCheckoutCompleted(
          packageSession({
            metadata: {
              clerkUserId: 'clerk_user_abc',
              internalUserId: 'user-123',
              type: 'credit_package',
              creditPackageId: 'pkg-1',
              creditAmount: '0', // the case @Min(1) now blocks upstream
              packageSlug: 'value-12',
            },
          }),
        ),
      ).rejects.toThrow(/Unusable credit_package metadata/);

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'stripe.credit_package_metadata_unusable',
        expect.objectContaining({ level: 'error' }),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTxUser.update).not.toHaveBeenCalled();
    });

    // ---- legacy single-reading branch ----

    it('grants the legacy one-time credit atomically', async () => {
      await service.handleCheckoutCompleted(legacySession());

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTxTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ONE_TIME', stripePaymentId: 'pi_legacy' }),
        }),
      );
      expect(mockTxUser.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { credits: { increment: 1 } },
      });
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('survives a redelivered legacy purchase (P2002) without granting twice', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });

      await expect(service.handleCheckoutCompleted(legacySession())).resolves.not.toThrow();

      expect(mockTxUser.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rethrows a non-P2002 legacy failure', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P1001' });

      await expect(service.handleCheckoutCompleted(legacySession())).rejects.toEqual({ code: 'P1001' });
      expect(mockTxUser.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Status mapping — the fail-open default
  //
  // mapStripeStatus used `map[status] || 'ACTIVE'`: unknown => "assume paying".
  // Stripe documents 8 statuses; the table listed 5. The 3 missing ones
  // (trialing, incomplete, paused) all resolved to ACTIVE — trialing correct
  // only by accident, the other two granting unpaid access.
  // ============================================================

  describe('subscription status mapping', () => {
    const existingRow = { id: 'sub-db-1', userId: 'user-123' };

    const updatedEvent = (status: string) =>
      ({
        id: 'sub_status',
        status,
        cancel_at: null,
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
        metadata: { internalUserId: 'user-123', planSlug: 'pro' },
      }) as any;

    const statusWrittenBy = async (stripeStatus: string): Promise<string | undefined> => {
      mockPrisma.subscription.findFirst.mockResolvedValue(existingRow);
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(updatedEvent(stripeStatus));

      const arg = mockPrisma.subscription.update.mock.calls[0][0] as { data: { status?: string } };
      return arg.data.status;
    };

    it.each([
      ['active', 'ACTIVE'],
      ['trialing', 'ACTIVE'],
      ['past_due', 'PAST_DUE'],
      ['unpaid', 'PAST_DUE'],
      ['incomplete', 'PAST_DUE'],
      ['canceled', 'CANCELLED'],
      ['incomplete_expired', 'EXPIRED'],
      ['paused', 'EXPIRED'],
    ])('maps Stripe "%s" to %s', async (stripeStatus, expected) => {
      expect(await statusWrittenBy(stripeStatus)).toBe(expected);
    });

    it('keeps trial users entitled — the ordering constraint on removing the fallback', async () => {
      // `trialing` reached ACTIVE only via the old `|| 'ACTIVE'` fallback, so
      // removing that without listing it here would drop every trial user to FREE
      // mid-trial.
      expect(await statusWrittenBy('trialing')).toBe('ACTIVE');
    });

    it('drops entitlement for incomplete (payment not settled) instead of granting it', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(existingRow);
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.subscription.findMany.mockResolvedValue([]); // no ACTIVE rows after the flip
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, subscriptionTier: 'PRO' });
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(updatedEvent('incomplete'));

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { subscriptionTier: 'FREE' } }),
      );
    });

    it('flags "paused" loudly — it can only occur if someone enabled trials', async () => {
      await statusWrittenBy('paused');
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'stripe.paused_status_observed',
        expect.objectContaining({ level: 'error' }),
      );
    });

    it('preserves the stored status on an unknown value, and alerts', async () => {
      const written = await statusWrittenBy('some_future_status');

      // The key is omitted entirely — not guessed in either direction.
      expect(written).toBeUndefined();
      const arg = mockPrisma.subscription.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(arg.data).not.toHaveProperty('status');
      // ...but planTier/period still update.
      expect(arg.data).toHaveProperty('planTier', 'PRO');
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'stripe.unknown_subscription_status',
        expect.objectContaining({ level: 'error' }),
      );
    });

    it('DOCUMENTS THE RESIDUAL: an unknown status over a stored ACTIVE row keeps paid access', async () => {
      // This is not a solved problem. Preserving the stored value is strictly
      // better than guessing, but if Stripe ships a status meaning "not entitled"
      // and the row is ACTIVE, the user stays entitled until a human acts on the
      // Sentry alert. Asserted so nobody mistakes the fix for a closed hole.
      mockPrisma.subscription.findFirst.mockResolvedValue(existingRow);
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-db-1', planTier: 'PRO', status: 'ACTIVE', createdAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date() },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, subscriptionTier: 'PRO' });
      mockPrisma.user.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated(updatedEvent('some_future_status'));

      // Tier unchanged: still PRO, no downgrade written.
      expect(mockPrisma.user.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { subscriptionTier: 'FREE' } }),
      );
    });

    it('does NOT double-grant when an incomplete->PAST_DUE sub later pays a proration invoice', async () => {
      // incomplete -> PAST_DUE makes the dunning recovery branch reachable for the
      // FIRST time (it was previously written ACTIVE, so the PAST_DUE guard never
      // matched). A mid-cycle plan change is exactly when an existing sub goes
      // incomplete, and its proration invoice would then hit that branch. Safe
      // only because of MonthlyCreditsLog @@unique([userId, periodStart]) — pin it.
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-db-1',
        userId: 'user-123',
        stripeSubscriptionId: 'sub_status',
        planTier: 'PRO',
        status: 'PAST_DUE',
        currentPeriodStart: new Date(1700000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
      });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-db-1', planTier: 'PRO', status: 'ACTIVE', createdAt: new Date(), currentPeriodStart: new Date(1700000000 * 1000), currentPeriodEnd: new Date(1702592000 * 1000) },
      ]);
      mockPrisma.plan.findFirst.mockResolvedValue({ ...MOCK_PLAN, slug: 'pro', monthlyCredits: 15 });
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.transaction.create.mockResolvedValue({});
      // The period was already granted — the unique key rejects the second write.
      mockTxMonthlyCreditsLog.create.mockRejectedValueOnce({ code: 'P2002' });

      const invoice = {
        id: 'in_proration',
        amount_paid: 999,
        currency: 'usd',
        lines: { data: [{ period: { start: 1700000000, end: 1702592000 }, description: 'Proration' }] },
        // The subscription reference lives here, not at the top level.
        parent: { subscription_details: { subscription: 'sub_status' } },
      } as any;

      await expect(service.handleInvoicePaid(invoice)).resolves.not.toThrow();

      // Exactly one attempt, and it was rejected by the unique key — no double-grant.
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledTimes(1);
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
      // M6: after the row is set ACTIVE MASTER, syncUserTier recomputes MASTER.
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-db-1', planTier: 'MASTER', currentPeriodStart: new Date(1700000000 * 1000), currentPeriodEnd: new Date(1702592000 * 1000), status: 'ACTIVE' },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);

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
      // M6: user currently PRO → syncUserTier recomputes FREE (no active subs).
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, subscriptionTier: 'PRO' });

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

    // ----------------------------------------------------------
    // Ordering race: `customer.subscription.updated` can arrive BEFORE
    // `checkout.session.completed`. Previously syncUserTier ran unconditionally
    // with no row → computed FREE → un-subscribed a user who had just paid.
    // ----------------------------------------------------------

    const makeUpdatedEvent = (status: string) =>
      ({
        id: 'sub_stripe_race',
        status,
        cancel_at: null,
        items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
        metadata: { internalUserId: 'user-123', planSlug: 'pro' },
      }) as any;

    it('creates the row and keeps the paid tier when it beats checkout (raw active)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null); // no row yet
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER); // currently FREE

      // STATEFUL: findMany reflects what is actually persisted. Before the create
      // there are no active rows, so syncUserTier would compute FREE — which is
      // exactly the bug. If the create branch is ever removed, this test fails on
      // the tier assertion rather than passing on a permissive mock.
      const persisted: unknown[] = [];
      mockPrisma.subscription.create.mockImplementation(async () => {
        persisted.push({
          id: 'sub-new',
          planTier: 'PRO',
          status: 'ACTIVE',
          createdAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
        });
        return {};
      });
      mockPrisma.subscription.findMany.mockImplementation(async () => persisted);

      await service.handleSubscriptionUpdated(makeUpdatedEvent('active'));

      expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            stripeSubscriptionId: 'sub_stripe_race',
            planTier: 'PRO',
            status: 'ACTIVE',
            platform: 'STRIPE',
          }),
        }),
      );
      // The regression: must NOT be written FREE.
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { subscriptionTier: 'PRO' } }),
      );
    });

    it('creates the row for raw trialing too', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-new', planTier: 'PRO', status: 'ACTIVE', createdAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date() },
      ]);

      await service.handleSubscriptionUpdated(makeUpdatedEvent('trialing'));

      expect(mockPrisma.subscription.create).toHaveBeenCalled();
    });

    it('does NOT create a row or touch the tier for raw incomplete (payment pending)', async () => {
      // `incomplete` means the first payment has not succeeded (SCA / declined).
      // mapStripeStatus() would launder it to 'ACTIVE' via its `|| 'ACTIVE'`
      // fallback, so this asserts we gate on the RAW status instead.
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await service.handleSubscriptionUpdated(makeUpdatedEvent('incomplete'));

      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
      // Assert on findMany, NOT on user.update. findMany is the first statement in
      // syncUserTier, so it proves the early-return was taken. `user.update` alone
      // is unfalsifiable here: user.findUnique is unmocked → resolves undefined →
      // syncUserTier's `changed = !!user && ...` is false whether or not it ran, so
      // the pre-fix unconditional-syncUserTier bug would still pass this test.
      expect(mockPrisma.subscription.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('does NOT touch the tier for raw canceled with no local row', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await service.handleSubscriptionUpdated(makeUpdatedEvent('canceled'));

      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
      // See the `incomplete` case above for why this asserts on findMany.
      expect(mockPrisma.subscription.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('swallows P2002 when checkout wins the race concurrently, and still syncs tier', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockRejectedValue({ code: 'P2002' });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-from-checkout', planTier: 'PRO', status: 'ACTIVE', createdAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date() },
      ]);

      await expect(
        service.handleSubscriptionUpdated(makeUpdatedEvent('active')),
      ).resolves.not.toThrow();

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { subscriptionTier: 'PRO' } }),
      );
    });

    it('rethrows a non-P2002 create failure', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockRejectedValue({ code: 'P1001' });

      await expect(service.handleSubscriptionUpdated(makeUpdatedEvent('active'))).rejects.toEqual({
        code: 'P1001',
      });
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
      // M6: user currently PRO → recompute FREE after the sub is EXPIRED.
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, subscriptionTier: 'PRO' });

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
        id: 'sub-db-1',
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
        // Explicit: handleInvoicePaid reactivates only when status === 'PAST_DUE'.
        status: 'ACTIVE',
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

    // ----------------------------------------------------------
    // Dunning recovery + redelivery. invoice.payment_succeeded can beat
    // customer.subscription.updated back to ACTIVE; if it does, the governing gate
    // skips the grant and NOTHING retries (no MonthlyCreditsLog row is written).
    // ----------------------------------------------------------

    const makePaidInvoice = (id = 'in_dunning') =>
      ({
        id,
        amount_paid: 999,
        currency: 'usd',
        lines: {
          data: [
            {
              description: 'Pro Plan × 1',
              period: { start: 1700000000, end: 1702592000 },
            },
          ],
        },
        parent: { subscription_details: { subscription: 'sub_stripe_123' } },
      }) as any;

    const primeGrantMocks = () => {
      mockPrisma.transaction.create.mockResolvedValue({});
      mockPrisma.plan.findFirst.mockResolvedValue({ ...MOCK_PLAN, slug: 'pro', monthlyCredits: 15 });
      mockTxUser.update.mockResolvedValue({});
      mockTxMonthlyCreditsLog.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      mockPrisma.user.update.mockResolvedValue({});
    };

    it('reactivates a PAST_DUE sub and grants the credits it would otherwise lose', async () => {
      const row = {
        id: 'sub-db-1',
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
        status: 'PAST_DUE',
        currentPeriodStart: new Date(1700000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
      };
      mockPrisma.subscription.findFirst.mockResolvedValue(row);
      // STATEFUL: the governing-sub query only sees the row once it is ACTIVE.
      // If the reactivation is removed, findMany returns [] → grant skipped → this
      // test fails on the credit assertion, which is the actual regression.
      let active = false;
      mockPrisma.subscription.update.mockImplementation(async () => {
        active = true;
        return {};
      });
      mockPrisma.subscription.findMany.mockImplementation(async () =>
        active ? [{ ...row, status: 'ACTIVE', createdAt: new Date() }] : [],
      );
      primeGrantMocks();

      await service.handleInvoicePaid(makePaidInvoice());

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sub-db-1' }, data: { status: 'ACTIVE' } }),
      );
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT resurrect a CANCELLED sub, and grants nothing', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-db-1',
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
        status: 'CANCELLED',
        currentPeriodStart: new Date(1700000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
      });
      mockPrisma.subscription.findMany.mockResolvedValue([]); // nothing active
      primeGrantMocks();

      await service.handleInvoicePaid(makePaidInvoice('in_cancelled'));

      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      // Assert the OUTCOME, not the call: grantMonthlyCreditsForSubscription is
      // still invoked unconditionally — it returns not-governing-subscription.
      expect(mockTxMonthlyCreditsLog.create).not.toHaveBeenCalled();
    });

    it('does not write status again for an already-ACTIVE sub', async () => {
      const row = {
        id: 'sub-db-1',
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
        status: 'ACTIVE',
        currentPeriodStart: new Date(1700000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
      };
      mockPrisma.subscription.findFirst.mockResolvedValue(row);
      mockPrisma.subscription.findMany.mockResolvedValue([{ ...row, createdAt: new Date() }]);
      primeGrantMocks();

      await service.handleInvoicePaid(makePaidInvoice('in_active'));

      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledTimes(1);
    });

    it('survives a redelivered invoice (P2002 on the Transaction) and still grants once', async () => {
      const row = {
        id: 'sub-db-1',
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
        status: 'ACTIVE',
        currentPeriodStart: new Date(1700000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
      };
      mockPrisma.subscription.findFirst.mockResolvedValue(row);
      mockPrisma.subscription.findMany.mockResolvedValue([{ ...row, createdAt: new Date() }]);
      primeGrantMocks();
      // stripePaymentId is @unique — a redelivery collides here. Previously this
      // escaped, the controller 500'd, Stripe retried, and the loop never broke.
      mockPrisma.transaction.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.handleInvoicePaid(makePaidInvoice('in_redelivered'))).resolves.not.toThrow();

      // Reached the grant despite the duplicate transaction.
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalledTimes(1);
    });

    it('rethrows a non-P2002 Transaction failure', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-db-1',
        userId: 'user-123',
        stripeSubscriptionId: 'sub_stripe_123',
        planTier: 'PRO',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
      });
      mockPrisma.subscription.findMany.mockResolvedValue([]);
      primeGrantMocks();
      mockPrisma.transaction.create.mockRejectedValue({ code: 'P1001' });

      await expect(service.handleInvoicePaid(makePaidInvoice('in_db_down'))).rejects.toEqual({
        code: 'P1001',
      });
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
      // M6: user currently PRO → recompute FREE after the sub is PAST_DUE.
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, subscriptionTier: 'PRO' });

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
