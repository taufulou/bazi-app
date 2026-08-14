/**
 * F9 — `POST /api/payments/upgrade` must not grant entitlement on its own say-so.
 *
 * Defects this locks:
 *
 *  1. It blind-wrote `User.subscriptionTier = <requested tier>`, bypassing
 *     `syncUserTier`. That column is a CROSS-PROVIDER maximum, so a Stripe
 *     BASIC -> PRO change by someone holding an active Apple MASTER subscription
 *     silently DOWNGRADED them. It also skipped the chat-quota resnapshot.
 *
 *  2. It wrote `status: 'ACTIVE'` + the new tier purely because the Stripe API
 *     call did not throw. The local row is selected on OUR status column, which
 *     can be stale — so a subscription Stripe holds `past_due` / `unpaid` /
 *     `incomplete` was upgraded to a HIGHER paid tier.
 *
 *  3. (audit) The entitlement check ran AFTER `subscriptions.update`, so a
 *     refusal still left Stripe re-priced and — via `cancel_at_period_end: false`
 *     — silently un-cancelled. It now runs pre-flight, off the retrieved
 *     subscription, with a post-update backstop.
 *
 *  4. (audit) `pause_collection` leaves `status: 'active'`, so the status map
 *     alone waved through a subscription Stripe collects nothing from.
 *
 * The harness runs a REAL `EntitlementsService` over a STATEFUL fake Prisma, so
 * the cross-provider recompute genuinely executes and read-after-write ordering
 * is observable rather than fixtured.
 */
import { StripeService } from '../src/payments/stripe.service';
import { EntitlementsService } from '../src/payments/entitlements.service';
import { BadRequestException, HttpStatus } from '@nestjs/common';

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
// Mock Prisma — DELIBERATELY STATEFUL
//
// A `findMany` hardcoded to the post-state severs the pipeline these tests exist
// to validate: `effectiveTier` would be supplied by the fixture rather than
// produced by the code. Proven by mutation — with a static fake, moving
// `syncUserTier` ABOVE the row write and writing the WRONG tier to the row both
// stayed green. So `subscription.update` mutates the row set and `findMany` reads
// back through the `where` it was actually given, making read-after-write
// ordering, the `status: 'ACTIVE'` filter and `userId` scoping all observable.
// ============================================================

interface Row {
  id: string;
  userId: string;
  stripeSubscriptionId: string | null;
  planTier: string;
  status: string;
  platform: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  createdAt: Date;
  cancelledAt?: Date | null;
}

let subscriptionRows: Row[] = [];

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  plan: { findFirst: jest.fn() },
  subscription: {
    findFirst: jest.fn(),
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        subscriptionRows
          .filter(
            (r) =>
              (where.userId === undefined || r.userId === where.userId) &&
              (where.status === undefined || r.status === where.status),
          )
          // Snapshot: a live object would let a later write change what an
          // earlier read saw, which is the opposite of a real query.
          .map((r) => ({ ...r })),
      ),
    ),
    update: jest.fn(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = subscriptionRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row ? { ...row } : null);
      },
    ),
  },
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

const USER = { id: 'user-123', clerkUserId: 'clerk_abc', subscriptionTier: 'BASIC', credits: 0 };

const PRO_PLAN = {
  id: 'plan-pro',
  slug: 'pro',
  nameZhTw: '進階版',
  priceMonthly: 9.99,
  priceAnnual: 79.99,
  currency: 'USD',
  isActive: true,
};

const stripeRow = (): Row => ({
  id: 'sub-row-stripe',
  userId: USER.id,
  stripeSubscriptionId: 'sub_stripe_1',
  planTier: 'BASIC',
  status: 'ACTIVE',
  platform: 'STRIPE',
  currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

/** A concurrently-held Apple subscription at a HIGHER tier. */
const appleMasterRow = (): Row => ({
  ...stripeRow(),
  id: 'sub-row-apple',
  stripeSubscriptionId: null,
  planTier: 'MASTER',
  platform: 'APPLE',
  createdAt: new Date('2026-02-01T00:00:00Z'),
});

const stripeSubBefore = {
  id: 'sub_stripe_1',
  status: 'active',
  pause_collection: null,
  metadata: { internalUserId: USER.id, planSlug: 'basic' },
  items: { data: [{ id: 'si_1', price: { product: 'prod_1' } }] },
};

function stripeSubWith(
  status: string,
  opts: { cancelAt?: number | null; pauseCollection?: unknown } = {},
) {
  return {
    ...stripeSubBefore,
    status,
    cancel_at: opts.cancelAt ?? null,
    pause_collection: opts.pauseCollection ?? null,
  };
}

/** The single `subscription.update` payload that carries the tier grant. */
function grantWrite() {
  return mockPrisma.subscription.update.mock.calls
    .map(([arg]) => arg)
    .find((a) => a?.data?.planTier !== undefined);
}

describe('F9 — upgradeSubscription entitlement safety', () => {
  let service: StripeService;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionRows = [stripeRow()];

    service = new StripeService(
      mockConfig as any,
      mockPrisma as any,
      { get: jest.fn(), set: jest.fn() } as any,
      new EntitlementsService(mockPrisma as any, {
        resnapshotChatQuotaOnTierChange: mockResnapshot,
      } as any),
    );

    mockPrisma.user.findUnique.mockResolvedValue({ ...USER });
    mockPrisma.plan.findFirst.mockResolvedValue(PRO_PLAN);
    mockPrisma.subscription.findFirst.mockImplementation(() =>
      Promise.resolve({ ...subscriptionRows[0] }),
    );
    mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubBefore);
    mockStripeProducts.retrieve.mockResolvedValue({ id: 'prod_1', active: true });
    mockStripeSubscriptions.update.mockResolvedValue(stripeSubWith('active'));
  });

  // ============================================================
  // Defect 1 — cross-provider blind downgrade
  // ============================================================

  describe('cross-provider tier (never blind-downgrades)', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...USER, subscriptionTier: 'MASTER' });
      subscriptionRows = [stripeRow(), appleMasterRow()];
    });

    it('keeps MASTER when a Stripe BASIC->PRO change happens alongside Apple MASTER', async () => {
      const res = await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(res).toEqual({ success: true, newTier: 'PRO', effectiveTier: 'MASTER' });
    });

    it('never writes the REQUESTED tier onto User.subscriptionTier', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      // Asserts the security property — "no tier other than the cross-provider
      // maximum" — NOT "no write at all". The stricter form passed only by
      // fixture accident (stored tier already MASTER ⇒ syncUserTier's `changed`
      // is false), so making that write unconditional-and-idempotent would have
      // turned this red while the code stayed correct.
      const wrongWrites = mockPrisma.user.update.mock.calls
        .map(([arg]) => arg)
        .filter(
          (a) => a?.data?.subscriptionTier !== undefined && a.data.subscriptionTier !== 'MASTER',
        );
      expect(wrongWrites).toHaveLength(0);
    });

    it('REPAIRS a stale stored tier upward (webhook not yet landed)', async () => {
      // The realistic cross-provider case: Apple MASTER is active but the stored
      // column still says BASIC. syncUserTier must correct it to MASTER.
      mockPrisma.user.findUnique.mockResolvedValue({ ...USER, subscriptionTier: 'BASIC' });

      const res = await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(res.effectiveTier).toBe('MASTER');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { subscriptionTier: 'MASTER' },
      });
    });

    it('still records the new tier on the Stripe subscription row itself', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(grantWrite()).toMatchObject({
        where: { id: 'sub-row-stripe' },
        data: { planTier: 'PRO' },
      });
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

    it('derives the effective tier from the row it just wrote, in that order', async () => {
      // With the stateful fake, computing the tier BEFORE the row write yields the
      // pre-upgrade value. This is the read-after-write ordering `syncUserTier`'s
      // own docblock requires, and a static fixture cannot see it.
      const res = await service.upgradeSubscription(USER.clerkUserId, 'master', 'monthly');

      expect(res.effectiveTier).toBe('MASTER');
      expect(subscriptionRows[0].planTier).toBe('MASTER');
    });

    it('resnapshots the chat quota (the raw write used to skip this)', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockResnapshot).toHaveBeenCalledWith(USER.id, 'PRO');
    });

    it('downgrades to the remaining tier when the Stripe sub is lowered', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...USER, subscriptionTier: 'MASTER' });
      mockPrisma.plan.findFirst.mockResolvedValue({ ...PRO_PLAN, slug: 'basic' });

      const res = await service.upgradeSubscription(USER.clerkUserId, 'basic', 'monthly');

      expect(res.effectiveTier).toBe('BASIC');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { subscriptionTier: 'BASIC' },
      });
    });

    it('ignores a non-ACTIVE row when computing the tier', async () => {
      // An EXPIRED Apple MASTER row must not prop the user up at MASTER.
      subscriptionRows = [stripeRow(), { ...appleMasterRow(), status: 'EXPIRED' }];

      const res = await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(res.effectiveTier).toBe('PRO');
    });
  });

  // ============================================================
  // Defect 2/3/4 — entitlement must follow Stripe, and refuse before mutating
  // ============================================================

  describe('withholds the grant unless Stripe reports an entitled status', () => {
    // `unpaid`/`past_due` = delinquent; `incomplete` = first payment unsettled
    // (declined card / SCA pending); `canceled`/`incomplete_expired` = gone;
    // `wat` = a status this codebase does not recognise, which must fail CLOSED.
    it.each(['past_due', 'unpaid', 'incomplete', 'canceled', 'incomplete_expired', 'wat'])(
      'rejects with 402 + code when Stripe reports "%s"',
      async (status) => {
        mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubWith(status));

        // Typed rejection, not a bare `.toThrow()`: NotFoundException and
        // BadRequestException also extend HttpException, so the loose form
        // passed on a 400 and could not tell "refused by the gate" from
        // "fell over earlier".
        await expect(
          service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
        ).rejects.toMatchObject({
          status: HttpStatus.PAYMENT_REQUIRED,
          response: { code: 'UPGRADE_PAYMENT_REQUIRED' },
        });
      },
    );

    it('rejects a paused subscription even though Stripe still calls it "active"', async () => {
      // pause_collection leaves the status unchanged, so the status map alone
      // waves this through while Stripe collects nothing.
      mockStripeSubscriptions.retrieve.mockResolvedValue(
        stripeSubWith('active', { pauseCollection: { behavior: 'void' } }),
      );

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toMatchObject({ status: HttpStatus.PAYMENT_REQUIRED });
    });

    it('does NOT touch Stripe when it refuses', async () => {
      // The whole point of the pre-flight gate: no re-pricing, and no silent
      // un-cancelling via `cancel_at_period_end: false`.
      mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubWith('past_due'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toThrow();

      expect(mockStripeSubscriptions.update).not.toHaveBeenCalled();
    });

    it('grants no tier — to the row or to the user', async () => {
      mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubWith('past_due'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toThrow();

      expect(grantWrite()).toBeUndefined();
      expect(subscriptionRows[0].planTier).toBe('BASIC');
      const tierWrites = mockPrisma.user.update.mock.calls
        .map(([arg]) => arg)
        .filter((a) => a?.data?.subscriptionTier === 'PRO');
      expect(tierWrites).toHaveLength(0);
    });

    it('reconciles the stale local status it just disproved', async () => {
      // We have learned from Stripe that our stored ACTIVE is a lie. Leaving it
      // also leaves handleInvoicePaid's dunning recovery (gated on a local
      // PAST_DUE) unable to fire when the invoice settles.
      mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubWith('past_due'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toThrow();

      expect(subscriptionRows[0].status).toBe('PAST_DUE');
      // …and the tier recompute that follows drops the now-unentitled user.
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { subscriptionTier: 'FREE' },
      });
    });

    it('does NOT overwrite a stored status from a status it cannot map', async () => {
      mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubWith('wat'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toThrow();

      expect(subscriptionRows[0].status).toBe('ACTIVE');
    });

    it('alerts, because a silently-withheld upgrade looks like a bug to the user', async () => {
      mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubWith('past_due'));

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

    it('backstops a status that only goes bad on the update response', async () => {
      // Should be unreachable (create_prorations raises no invoice, so the update
      // cannot move the status) — but if it ever does, refuse rather than grant.
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubWith('past_due'));

      await expect(
        service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly'),
      ).rejects.toMatchObject({ status: HttpStatus.PAYMENT_REQUIRED });

      expect(grantWrite()).toBeUndefined();
    });

    it('accepts "trialing" — a trial IS entitled', async () => {
      mockStripeSubscriptions.retrieve.mockResolvedValue(stripeSubWith('trialing'));
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubWith('trialing'));

      const res = await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(res.effectiveTier).toBe('PRO');
      expect(grantWrite()).toMatchObject({ data: { status: 'ACTIVE' } });
    });
  });

  // ============================================================
  // What we send to Stripe
  // ============================================================

  describe('the Stripe update payload', () => {
    it('writes BOTH recovery keys into metadata', async () => {
      // The 402 path's entire safety argument is "the webhook will land the tier
      // once the invoice settles" — which requires planSlug, and requires
      // internalUserId or handleSubscriptionUpdated early-returns.
      //
      // The fixture deliberately starts with NEITHER key. Seeded with them (as an
      // earlier version of this test was), `...stripeSub.metadata` supplies both
      // by spread and the assertion passes with the fix deleted — verified: that
      // mutation survived all 161 tests. Empty metadata is also the realistic
      // case, since it is precisely subscriptions we did not create that lack it.
      mockStripeSubscriptions.retrieve.mockResolvedValue({ ...stripeSubBefore, metadata: {} });

      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        expect.objectContaining({
          metadata: expect.objectContaining({ planSlug: 'pro', internalUserId: USER.id }),
        }),
      );
    });

    it('does not clobber unrelated pre-existing metadata', async () => {
      mockStripeSubscriptions.retrieve.mockResolvedValue({
        ...stripeSubBefore,
        metadata: { campaign: 'launch-2026' },
      });

      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        expect.objectContaining({
          metadata: expect.objectContaining({ campaign: 'launch-2026' }),
        }),
      );
    });

    it('prices a monthly change from priceMonthly', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              price_data: expect.objectContaining({
                unit_amount: 999,
                recurring: { interval: 'month' },
              }),
            }),
          ],
        }),
      );
    });

    it('prices an annual change from priceAnnual', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'annual');

      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              price_data: expect.objectContaining({
                unit_amount: 7999,
                recurring: { interval: 'year' },
              }),
            }),
          ],
        }),
      );
    });

    it('clears a pending cancellation on a successful change', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(mockStripeSubscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        expect.objectContaining({ cancel_at_period_end: false }),
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
  // Row fidelity
  // ============================================================

  describe('the Subscription row mirrors Stripe', () => {
    it('clears cancelledAt when Stripe reports no pending cancellation', async () => {
      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(grantWrite()).toMatchObject({ data: { cancelledAt: null } });
    });

    it('carries a pending cancellation through instead of hardcoding null', async () => {
      const cancelAt = 1_800_000_000;
      mockStripeSubscriptions.update.mockResolvedValue(stripeSubWith('active', { cancelAt }));

      await service.upgradeSubscription(USER.clerkUserId, 'pro', 'monthly');

      expect(grantWrite()).toMatchObject({ data: { cancelledAt: new Date(cancelAt * 1000) } });
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

      expect(grantWrite()).toBeUndefined();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
