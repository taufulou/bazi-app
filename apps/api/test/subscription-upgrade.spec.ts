/**
 * F9 — `POST /api/payments/upgrade` must not grant entitlement on its own say-so.
 *
 * Two defects this locks:
 *
 *  1. The endpoint blind-wrote `User.subscriptionTier = <requested tier>`,
 *     bypassing `syncUserTier`. `User.subscriptionTier` is a CROSS-PROVIDER
 *     maximum, so a Stripe BASIC -> PRO change by someone holding an active
 *     Apple MASTER subscription silently DOWNGRADED them to PRO. It also skipped
 *     the chat-quota resnapshot that `syncUserTier` performs.
 *
 *  2. It wrote `status: 'ACTIVE'` + the new tier purely because the Stripe API
 *     call did not throw. The local `Subscription` row is selected on OUR status
 *     column, which can be stale — so a subscription that Stripe considers
 *     `past_due` / `unpaid` / `incomplete` was upgraded to a HIGHER paid tier.
 *
 * The harness constructs a REAL `EntitlementsService` over the mock Prisma, so
 * the cross-provider tier recompute genuinely runs rather than being asserted
 * against a stub.
 */
import { StripeService } from '../src/payments/stripe.service';
import { EntitlementsService } from '../src/payments/entitlements.service';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

// ============================================================
// Mock Stripe SDK
// ============================================================

const mockStripeSubscriptions = { update: jest.fn(), retrieve: jest.fn() };
const mockStripeProducts = { retrieve: jest.fn(), create: jest.fn() };

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: { list: jest.fn(), search: jest.fn(), create: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    subscriptions: mockStripeSubscriptions,
    products: mockStripeProducts,
    coupons: { retrieve: jest.fn(), create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }));
});

const mockCaptureMessage = jest.fn();
jest.mock('@sentry/nestjs', () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

// ============================================================
// Mock Prisma
// ============================================================

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  plan: { findFirst: jest.fn() },
  subscription: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  monthlyCreditsLog: { create: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => (key === 'STRIPE_SECRET_KEY' ? 'sk_test_fake' : undefined)),
};

const mockResnapshot = jest.fn();

// ============================================================
// Fixtures
// ============================================================

const USER = {
  id: 'user-123',
  clerkUserId: 'clerk_abc',
  subscriptionTier: 'BASIC' as const,
  credits: 0,
};

const PRO_PLAN = {
  id: 'plan-pro',
  slug: 'pro',
  nameZhTw: '進階版',
  priceMonthly: 9.99,
  priceAnnual: 79.99,
  currency: 'USD',
  isActive: true,
};

/** The caller's own Stripe subscription row (BASIC), as stored locally. */
const STRIPE_SUB_ROW = {
  id: 'sub-row-stripe',
  userId: USER.id,
  stripeSubscriptionId: 'sub_stripe_1',
  planTier: 'BASIC' as const,
  status: 'ACTIVE' as const,
  platform: 'STRIPE' as const,
  currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

/** A concurrently-held Apple subscription at a HIGHER tier. */
const APPLE_MASTER_ROW = {
  ...STRIPE_SUB_ROW,
  id: 'sub-row-apple',
  stripeSubscriptionId: null,
  planTier: 'MASTER' as const,
  platform: 'APPLE' as const,
  createdAt: new Date('2026-02-01T00:00:00Z'),
};

/** Stripe's view of the subscription BEFORE the update. */
const stripeSubBefore = {
  id: 'sub_stripe_1',
  status: 'active',
  metadata: { internalUserId: USER.id, planSlug: 'basic' },
  items: { data: [{ id: 'si_1', price: { product: 'prod_1' } }] },
};

/** Build Stripe's response to `subscriptions.update`. */
function stripeSubAfter(status: string, cancelAt: number | null = null) {
  return { ...stripeSubBefore, status, cancel_at: cancelAt };
}

describe('F9 — upgradeSubscription entitlement safety', () => {
  let service: StripeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StripeService(
      mockConfig as any,
      mockPrisma as any,
      { get: jest.fn(), set: jest.fn() } as any,
      new EntitlementsService(mockPrisma as any, {
        resnapshotChatQuotaOnTierChange: mockResnapshot,
      } as any),
    );

    mockPrisma.user.findUnique.mockResolvedValue(USER);
    mockPrisma.plan.findFirst.mockResolvedValue(PRO_PLAN);
    mockPrisma.subscription.findFirst.mockResolvedValue(STRIPE_SUB_ROW);
    // Default: the Stripe sub is the only one the user holds.
    mockPrisma.subscription.findMany.mockResolvedValue([
      { ...STRIPE_SUB_ROW, planTier: 'PRO' },
    ]);
    mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubBefore);
    mockStripeProducts.retrieve.mockResolvedValue({ id: 'prod_1', active: true });
    mockStripeSubscriptions.update.mockResolvedValue(stripeSubAfter('active'));
  });

  // ============================================================
  // Defect 1 — cross-provider blind downgrade
  // ============================================================

  describe('cross-provider tier (never blind-downgrades)', () => {
    beforeEach(() => {
      // The user holds Apple MASTER as well; their stored tier reflects it.
      mockPrisma.user.findUnique.mockResolvedValue({ ...USER, subscriptionTier: 'MASTER' });
      mockPrisma.subscription.findMany.mockResolvedValue([
        { ...STRIPE_SUB_ROW, planTier: 'PRO' },
        APPLE_MASTER_ROW,
      ]);
    });

    it('keeps MASTER when a Stripe BASIC->PRO change happens alongside Apple MASTER', async () => {
      const res = await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(res).toEqual({ success: true, newTier: 'PRO', effectiveTier: 'MASTER' });
    });

    it('does not write PRO onto User.subscriptionTier', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      // syncUserTier only writes when the effective tier CHANGES; MASTER is
      // already stored, so the correct behaviour is no write at all. What must
      // never happen is a write of the requested tier.
      const tierWrites = mockPrisma.user.update.mock.calls.filter(
        ([arg]) => arg?.data?.subscriptionTier !== undefined,
      );
      expect(tierWrites).toHaveLength(0);
    });

    it('still records the new tier on the Stripe subscription row itself', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: STRIPE_SUB_ROW.id },
          data: expect.objectContaining({ planTier: 'PRO' }),
        }),
      );
    });
  });

  describe('single-provider tier', () => {
    it('promotes the user when Stripe is their only subscription', async () => {
      const res = await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(res).toEqual({ success: true, newTier: 'PRO', effectiveTier: 'PRO' });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { subscriptionTier: 'PRO' },
      });
    });

    it('resnapshots the chat quota (the raw write used to skip this)', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockResnapshot).toHaveBeenCalledWith(USER.id, 'PRO');
    });

    it('downgrades to the remaining tier when the Stripe sub is lowered', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...USER, subscriptionTier: 'MASTER' });
      mockPrisma.plan.findFirst.mockResolvedValue({ ...PRO_PLAN, slug: 'basic' });
      mockPrisma.subscription.findMany.mockResolvedValue([
        { ...STRIPE_SUB_ROW, planTier: 'BASIC' },
      ]);

      const res = await service.upgradeSubscription(USER.clerkUserId, 'basic', 'monthly');

      expect(res.effectiveTier).toBe('BASIC');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { subscriptionTier: 'BASIC' },
      });
    });
  });

  // ============================================================
  // Defect 2 — entitlement must follow Stripe's status
  // ============================================================

  describe('withholds the grant unless Stripe reports an entitled status', () => {
    // `unpaid`/`past_due` = delinquent; `incomplete` = first payment unsettled
    // (declined card / SCA pending); `canceled`/`incomplete_expired` = gone;
    // `wat` = a status this codebase does not recognise, which must fail CLOSED.
    it.each(['past_due', 'unpaid', 'incomplete', 'canceled', 'incomplete_expired', 'wat'])(
      'rejects when Stripe returns "%s"',
      async (status) => {
        mockStripeSubscriptions.update.mockResolvedValue(stripeSubAfter(status));

        await expect(
          service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
        ).rejects.toThrow(HttpException);
      },
    );

    it('responds 402 with a machine-readable code', async () => {
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubAfter('past_due'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toMatchObject({
        status: HttpStatus.PAYMENT_REQUIRED,
        response: { code: 'UPGRADE_PAYMENT_REQUIRED' },
      });
    });

    it('writes NOTHING locally when the status is not entitled', async () => {
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubAfter('past_due'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toThrow();

      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('alerts, because a silently-withheld upgrade looks like a bug to the user', async () => {
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubAfter('past_due'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toThrow();

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'stripe.upgrade_not_entitled',
        expect.objectContaining({
          extra: expect.objectContaining({ stripeStatus: 'past_due', requestedTier: 'PRO' }),
        }),
      );
    });

    it('accepts "trialing" — a trial IS entitled', async () => {
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubAfter('trialing'));

      const res = await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(res.effectiveTier).toBe('PRO');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
      );
    });
  });

  // ============================================================
  // Row fidelity
  // ============================================================

  describe('the Subscription row mirrors Stripe', () => {
    it('clears cancelledAt when Stripe reports no pending cancellation', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cancelledAt: null }) }),
      );
    });

    it('carries a pending cancellation through instead of hardcoding null', async () => {
      const cancelAt = 1_800_000_000;
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubAfter('active', cancelAt));

      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancelledAt: new Date(cancelAt * 1000) }),
        }),
      );
    });

    it('keeps deferred proration — always_invoice would mint a monthly credit grant', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        expect.objectContaining({ proration_behavior: 'create_prorations' }),
      );
    });
  });

  // ============================================================
  // Pre-existing behaviour that must not regress
  // ============================================================

  describe('Stripe API failure', () => {
    it('surfaces a 400 and leaves local state untouched', async () => {
      mockStripeSubscriptions.update.mockRejectedValue(new Error('card_declined'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
