/**
 * 1A-core — RevenueCat hardening before the first real store purchase.
 * Design: .claude/plans/1a-core-payment-hardening.md (items 2–5).
 *
 * Every guard here was added because its absence loses money or access
 * silently, so the tests assert the QUERY a guard issues (call arguments), not
 * only the outcome: these Prisma mocks return a row whatever the where-clause
 * says, so an outcome-only test stays green when the guard is deleted.
 */
import { RevenueCatService, RevenueCatEvent } from '../src/payments/revenuecat.service';
import { RevenueCatEventNotProcessableError } from '../src/payments/revenuecat-errors';

const mockCaptureMessage = jest.fn();
jest.mock('@sentry/nestjs', () => ({ captureMessage: (...args: unknown[]) => mockCaptureMessage(...args) }));

const mockPrisma = {
  user: { findUnique: jest.fn(), findFirst: jest.fn() },
  plan: { findFirst: jest.fn() },
  creditPackage: { findFirst: jest.fn() },
  subscription: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  transaction: { create: jest.fn(), findUnique: jest.fn() },
  monthlyCreditsLog: { findUnique: jest.fn() },
  creditLedger: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

const mockEntitlements = {
  syncUserTier: jest.fn(),
  grantMonthlyCreditsForSubscription: jest.fn(),
  grantMonthlyCreditsForGoverningSub: jest.fn(),
  grantCredits: jest.fn(),
  clawbackCredits: jest.fn(),
};

const mockConfig = { get: jest.fn().mockReturnValue('rc-secret') };

const DAY = 24 * 60 * 60 * 1000;
const PRO_PLAN = { slug: 'pro', isActive: true };
const PACK = { slug: 'value-12', creditAmount: 12, priceUsd: 9.99, isActive: true };
const P2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

function makeEvent(overrides: Partial<RevenueCatEvent>): RevenueCatEvent {
  return {
    id: 'evt_1',
    type: 'INITIAL_PURCHASE',
    app_user_id: 'clerk_buyer',
    product_id: 'com.tianming.app.pro.monthly',
    store: 'APP_STORE',
    environment: 'SANDBOX',
    purchased_at_ms: Date.now() - DAY,
    expiration_at_ms: Date.now() + 29 * DAY,
    original_transaction_id: 'apple_tx_1',
    transaction_id: 'apple_tx_1',
    ...overrides,
  };
}

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    userId: 'user-buyer',
    planTier: 'PRO',
    status: 'ACTIVE',
    platform: 'APPLE_IAP',
    currentPeriodStart: new Date(Date.now() - DAY),
    currentPeriodEnd: new Date(Date.now() + 29 * DAY),
    ...overrides,
  };
}

const sentryNames = () => mockCaptureMessage.mock.calls.map((c) => c[0]);
const sentryCall = (name: string) => mockCaptureMessage.mock.calls.find((c) => c[0] === name);
const expiredUpdate = () =>
  mockPrisma.subscription.update.mock.calls.find(
    (c: unknown[]) => (c[0] as { data?: { status?: string } } | undefined)?.data?.status === 'EXPIRED',
  );

describe('RevenueCatService — 1A-core', () => {
  let svc: RevenueCatService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new RevenueCatService(mockPrisma as never, mockEntitlements as never, mockConfig as never);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-buyer' });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.plan.findFirst.mockResolvedValue(PRO_PLAN);
    mockPrisma.creditPackage.findFirst.mockResolvedValue(null);
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.transaction.create.mockResolvedValue({});
    mockPrisma.transaction.findUnique.mockResolvedValue(null);
    mockPrisma.monthlyCreditsLog.findUnique.mockResolvedValue(null);
    mockPrisma.creditLedger.findFirst.mockResolvedValue({ id: 'ledger-grant' });
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockEntitlements.syncUserTier.mockResolvedValue({ tier: 'FREE', changed: true });
    mockEntitlements.clawbackCredits.mockResolvedValue({ clawedBack: 15 });
    mockEntitlements.grantMonthlyCreditsForSubscription.mockResolvedValue({ granted: true, creditsGranted: 15 });
    mockEntitlements.grantMonthlyCreditsForGoverningSub.mockResolvedValue({ granted: true, creditsGranted: 15 });
  });

  // ============================================================
  // Item 2 — the active flag must not refuse an already-paid event
  // ============================================================
  describe('item 2 — isActive does not gate a paid event', () => {
    it('resolves the plan WITHOUT an isActive filter (exact query)', async () => {
      await svc.handleEvent(makeEvent({ type: 'RENEWAL' }));
      expect(mockPrisma.plan.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { appleProductId: 'com.tianming.app.pro.monthly' },
            { googleProductId: 'com.tianming.app.pro.monthly' },
          ],
        },
      });
    });

    it('resolves the credit pack WITHOUT an isActive filter (exact query)', async () => {
      mockPrisma.creditPackage.findFirst.mockResolvedValue(PACK);
      await svc.handleEvent(makeEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'com.tianming.app.credits.12' }));
      expect(mockPrisma.creditPackage.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { appleProductId: 'com.tianming.app.credits.12' },
            { googleProductId: 'com.tianming.app.credits.12' },
          ],
        },
      });
    });

    it('a NEW sale of an inactive plan still activates — and warns', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue({ slug: 'pro', isActive: false });
      await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE' }));
      expect(mockPrisma.subscription.create).toHaveBeenCalled();
      expect(sentryCall('revenuecat.inactive_product_purchased')?.[1]).toMatchObject({ level: 'warning' });
    });

    it('a RENEWAL of an inactive plan activates silently (renewals are expected)', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue({ slug: 'pro', isActive: false });
      await svc.handleEvent(makeEvent({ type: 'RENEWAL' }));
      expect(mockPrisma.subscription.create).toHaveBeenCalled();
      expect(sentryNames()).not.toContain('revenuecat.inactive_product_purchased');
    });

    it('an inactive pack still grants its credits — and warns', async () => {
      mockPrisma.creditPackage.findFirst.mockResolvedValue({ ...PACK, isActive: false });
      await svc.handleEvent(makeEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'com.tianming.app.credits.12' }));
      expect(mockEntitlements.grantCredits).toHaveBeenCalledWith('user-buyer', 12, expect.any(String));
      expect(sentryNames()).toContain('revenuecat.inactive_product_purchased');
    });
  });

  // ============================================================
  // Item 3 — lost events are loud and retried
  // ============================================================
  describe('item 3 — unprocessable events throw (500 → retry)', () => {
    it.each(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'CANCELLATION', 'EXPIRATION'])(
      '%s from a non-IAP store is acknowledged BEFORE any user lookup',
      async (type) => {
        mockPrisma.user.findUnique.mockResolvedValue(null); // would throw if reached
        await expect(svc.handleEvent(makeEvent({ type, store: 'STRIPE' }))).resolves.toBeUndefined();
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      },
    );

    it('an unmapped pack throws with a Sentry ERROR and writes no transaction', async () => {
      mockPrisma.creditPackage.findFirst.mockResolvedValue(null);
      await expect(
        svc.handleEvent(makeEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'nope' })),
      ).rejects.toBeInstanceOf(RevenueCatEventNotProcessableError);
      expect(sentryCall('revenuecat.unmapped_product')?.[1]).toMatchObject({ level: 'error' });
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });

    it('a plan with no tier mapping throws', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue({ slug: 'legacy-gold', isActive: true });
      await expect(svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE' }))).rejects.toMatchObject({
        reason: 'unmapped_product',
      });
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });

    it('a known-DELETED account is acknowledged, with no writes (exact prefix query)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-deleted' });
      await expect(svc.handleEvent(makeEvent({ type: 'RENEWAL' }))).resolves.toBeUndefined();
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { clerkUserId: { startsWith: 'deleted_clerk_buyer_' } },
        select: { id: true },
      });
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(sentryNames()).not.toContain('revenuecat.unknown_app_user');
    });

    it('a deleted ALIAS does not swallow a never-seen PRIMARY id — still thrown and retried (audit L2)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockImplementation(({ where }: { where: { clerkUserId: { startsWith: string } } }) =>
        Promise.resolve(where.clerkUserId.startsWith === 'deleted_clerk_old_alias_' ? { id: 'user-deleted' } : null),
      );
      await expect(
        svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', aliases: ['clerk_old_alias'] })),
      ).rejects.toMatchObject({ reason: 'unknown_app_user' });
    });

    it('a never-seen PRODUCTION user pages (Sentry error) and throws', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', environment: 'PRODUCTION' })),
      ).rejects.toMatchObject({ reason: 'unknown_app_user' });
      expect(sentryCall('revenuecat.unknown_app_user')?.[1]).toMatchObject({ level: 'error' });
    });

    it('a never-seen SANDBOX user is a warning, still thrown', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', environment: 'SANDBOX' })),
      ).rejects.toMatchObject({ reason: 'unknown_app_user' });
      expect(sentryCall('revenuecat.unknown_app_user')?.[1]).toMatchObject({ level: 'warning' });
    });

    it('a database error in the deleted-user lookup propagates (never a silent 200)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockRejectedValue(new Error('db down'));
      await expect(svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE' }))).rejects.toThrow('db down');
    });

    it('Sentry payloads never carry the app_user_id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE' }))).rejects.toBeDefined();
      expect(JSON.stringify(mockCaptureMessage.mock.calls)).not.toContain('clerk_buyer');
    });

    describe('TRANSFER recipient', () => {
      const transfer = (to: string[]) =>
        makeEvent({ type: 'TRANSFER', transferred_from: ['clerk_old'], transferred_to: to });

      beforeEach(() => {
        mockPrisma.user.findUnique.mockImplementation(({ where }: { where: { clerkUserId: string } }) =>
          Promise.resolve(
            where.clerkUserId === 'clerk_new' ? { id: 'user-new' } : where.clerkUserId === 'clerk_old' ? { id: 'user-old' } : null,
          ),
        );
        mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ userId: 'user-old' }));
      });

      it('resolves a live user that is NOT the first entry', async () => {
        await svc.handleEvent(transfer(['$RCAnonymousID:abc', 'clerk_new']));
        expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-1' },
          data: { userId: 'user-new' },
        });
      });

      it('throws when the recipient was never seen', async () => {
        await expect(svc.handleEvent(transfer(['clerk_stranger']))).rejects.toMatchObject({
          reason: 'unknown_app_user',
        });
        expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      });

      it('acknowledges an anonymous-only recipient', async () => {
        await expect(svc.handleEvent(transfer(['$RCAnonymousID:abc']))).resolves.toBeUndefined();
        expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================================
  // Item 4 — record whether money is real
  // ============================================================
  describe('item 4 — environment', () => {
    it.each([
      ['SANDBOX', { environment: 'SANDBOX' }],
      ['PRODUCTION', { environment: 'PRODUCTION' }],
    ])('a %s subscription is created with that environment', async (env, expected) => {
      await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', environment: env }));
      expect(mockPrisma.subscription.create.mock.calls[0][0].data).toMatchObject(expected);
    });

    it('an unrecognised environment is OMITTED, not guessed', async () => {
      await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', environment: 'WHATEVER' }));
      expect(mockPrisma.subscription.create.mock.calls[0][0].data).not.toHaveProperty('environment');
    });

    it('the update path records it too', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ currentPeriodEnd: new Date(Date.now() + DAY) }));
      await svc.handleEvent(makeEvent({ type: 'RENEWAL', environment: 'PRODUCTION' }));
      expect(mockPrisma.subscription.update.mock.calls[0][0].data).toMatchObject({ environment: 'PRODUCTION' });
    });

    it('a pack purchase transaction records it', async () => {
      mockPrisma.creditPackage.findFirst.mockResolvedValue(PACK);
      await svc.handleEvent(makeEvent({ type: 'NON_RENEWING_PURCHASE', environment: 'SANDBOX' }));
      expect(mockPrisma.transaction.create.mock.calls[0][0].data).toMatchObject({ environment: 'SANDBOX' });
    });
  });

  // ============================================================
  // Item 5 — refunds end the membership; stale events don't resurrect it
  // ============================================================
  describe('item 5 — subscription refund', () => {
    const purchasedAt = Date.now() - 10 * DAY;
    const refund = (overrides: Partial<RevenueCatEvent> = {}) =>
      makeEvent({
        type: 'CANCELLATION',
        cancel_reason: 'CUSTOMER_SUPPORT',
        purchased_at_ms: purchasedAt,
        expiration_at_ms: Date.now() - 1000,
        transaction_id: 'apple_tx_renewal_3',
        price: -9.99,
        ...overrides,
      });

    // A DISTINCT transaction client (line-audit L1). With `fn(mockPrisma)` the
    // client and `this.prisma` were the same object, so writing through
    // `this.prisma` inside the callback — i.e. OUTSIDE the transaction — passed.
    const txClient = {
      transaction: { create: jest.fn() },
      monthlyCreditsLog: { findUnique: jest.fn() },
    };

    beforeEach(() => {
      // The refund is for the period the row currently holds.
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ currentPeriodStart: new Date(purchasedAt) }));
      txClient.transaction.create.mockReset().mockResolvedValue({});
      txClient.monthlyCreditsLog.findUnique.mockReset().mockResolvedValue({ creditAmount: 15 });
      mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(txClient));
    });

    it('records the refund, claws back THAT period’s grant inside one transaction, then expires', async () => {
      await svc.handleEvent(refund());

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled(); // nothing outside the transaction
      expect(txClient.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stripePaymentId: 'rc-refund:apple_tx_renewal_3',
          type: 'REFUND',
          amount: 9.99, // absolute value of RevenueCat's price
          environment: 'SANDBOX',
        }),
      });
      // The KEY is the guard: the refunded period's grant, keyed by the
      // refund event's purchased_at_ms — not the row's (rewritable) period.
      expect(txClient.monthlyCreditsLog.findUnique).toHaveBeenCalledWith({
        where: { userId_periodStart: { userId: 'user-buyer', periodStart: new Date(purchasedAt) } },
      });
      expect(mockPrisma.monthlyCreditsLog.findUnique).not.toHaveBeenCalled();
      // Enlisted in the caller's transaction (4th arg) — atomic with the row.
      expect(mockEntitlements.clawbackCredits).toHaveBeenCalledWith('user-buyer', 15, expect.any(String), txClient);
      expect(expiredUpdate()).toBeDefined();
      expect(mockEntitlements.syncUserTier).toHaveBeenCalledWith('user-buyer');
      expect(sentryNames()).toContain('revenuecat.subscription_refunded');
    });

    it('a duplicate refund (P2002) skips the clawback but STILL expires', async () => {
      txClient.transaction.create.mockRejectedValueOnce(P2002());
      await expect(svc.handleEvent(refund())).resolves.toBeUndefined();
      expect(mockEntitlements.clawbackCredits).not.toHaveBeenCalled();
      expect(expiredUpdate()).toBeDefined();
    });

    it('a clawback failure propagates (500, retried) and does not expire', async () => {
      mockEntitlements.clawbackCredits.mockRejectedValueOnce(new Error('db down'));
      await expect(svc.handleEvent(refund())).rejects.toThrow('db down');
      expect(expiredUpdate()).toBeUndefined();
    });

    it('no monthly log for that period → nothing clawed back, still expires', async () => {
      txClient.monthlyCreditsLog.findUnique.mockResolvedValue(null);
      await svc.handleEvent(refund());
      expect(mockEntitlements.clawbackCredits).not.toHaveBeenCalled();
      expect(expiredUpdate()).toBeDefined();
    });

    it('an amount RevenueCat did not send is recorded as 0 and labelled', async () => {
      await svc.handleEvent(refund({ price: undefined }));
      expect(txClient.transaction.create.mock.calls[0][0].data).toMatchObject({
        amount: 0,
        description: expect.stringContaining('amount not provided'),
      });
    });

    it.each([
      ['a FUTURE expiry', { expiration_at_ms: Date.now() + 5 * DAY }],
      ['NO expiry', { expiration_at_ms: null }],
    ])('a refund with %s is left ACTIVE for review (fail-safe)', async (_label, overrides) => {
      await svc.handleEvent(refund(overrides as Partial<RevenueCatEvent>));
      expect(expiredUpdate()).toBeUndefined();
      expect(txClient.transaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { cancelledAt: expect.any(Date) },
      });
      expect(sentryNames()).toContain('revenuecat.refund_needs_review');
    });

    it('a refund of an OLDER period claws that period back but does NOT end the current one (audit M2)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ currentPeriodStart: new Date(purchasedAt + 30 * DAY) }));
      await svc.handleEvent(refund());
      expect(mockEntitlements.clawbackCredits).toHaveBeenCalledWith('user-buyer', 15, expect.any(String), txClient);
      expect(expiredUpdate()).toBeUndefined();
      expect(sentryCall('revenuecat.refund_needs_review')?.[1]).toMatchObject({ tags: { reason: 'older_period' } });
    });

    it('without a transaction_id the refund key is original-tx + purchase time, not the event id (audit L3)', async () => {
      await svc.handleEvent(refund({ transaction_id: undefined, id: 'evt_refund_A' }));
      expect(txClient.transaction.create.mock.calls[0][0].data.stripePaymentId).toBe(`rc-refund:apple_tx_1:${purchasedAt}`);
    });

    it('a BILLING_ERROR cancellation with a PAST expiry stays ACTIVE (the reason, not the clock, decides)', async () => {
      await svc.handleEvent(refund({ cancel_reason: 'BILLING_ERROR' }));
      expect(expiredUpdate()).toBeUndefined();
      expect(mockEntitlements.clawbackCredits).not.toHaveBeenCalled();
    });
  });

  describe('item 5 — older events must not overwrite newer state', () => {
    const rowEnd = Date.now() + 10 * DAY;

    it('a retried RENEWAL for an EXPIRED period (equal expiry) is ignored — no write, no grant', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ status: 'EXPIRED', currentPeriodEnd: new Date(rowEnd) }));
      await svc.handleEvent(makeEvent({ type: 'RENEWAL', expiration_at_ms: rowEnd }));
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockEntitlements.grantMonthlyCreditsForSubscription).not.toHaveBeenCalled();
      expect(sentryCall('revenuecat.stale_activation_ignored')?.[1]).toMatchObject({ tags: { reason: 'ended_period' } });
    });

    it('a RENEWAL with a LATER expiry re-activates an EXPIRED row (genuine resubscription)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ status: 'EXPIRED', currentPeriodEnd: new Date(rowEnd) }));
      await svc.handleEvent(makeEvent({ type: 'RENEWAL', expiration_at_ms: rowEnd + 30 * DAY }));
      expect(mockPrisma.subscription.update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE' });
    });

    it('an OLDER RENEWAL on an ACTIVE row skips the write but still grants its paid period', async () => {
      const row = subRow({ currentPeriodEnd: new Date(rowEnd) });
      mockPrisma.subscription.findFirst.mockResolvedValue(row);
      const olderStart = Date.now() - 40 * DAY;
      const olderEnd = Date.now() - 10 * DAY;
      await svc.handleEvent(makeEvent({ type: 'RENEWAL', purchased_at_ms: olderStart, expiration_at_ms: olderEnd }));
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockEntitlements.grantMonthlyCreditsForSubscription).toHaveBeenCalledWith('user-buyer', row, {
        periodStart: new Date(olderStart),
        periodEnd: new Date(olderEnd),
      });
    });

    it('an OLDER non-renewal activation on an ACTIVE row grants nothing', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ currentPeriodEnd: new Date(rowEnd) }));
      await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', expiration_at_ms: rowEnd - DAY }));
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockEntitlements.grantMonthlyCreditsForSubscription).not.toHaveBeenCalled();
      expect(mockEntitlements.grantMonthlyCreditsForGoverningSub).not.toHaveBeenCalled();
    });

    it('UNCANCELLATION with an EQUAL expiry on an ACTIVE row IS applied (equal is not older)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ currentPeriodEnd: new Date(rowEnd), cancelledAt: new Date() }));
      await svc.handleEvent(makeEvent({ type: 'UNCANCELLATION', expiration_at_ms: rowEnd }));
      expect(mockPrisma.subscription.update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', cancelledAt: null });
    });

    it('with NO existing row, an already-over period is RECORDED as EXPIRED — never ACTIVE, no grant (audit M1)', async () => {
      await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', expiration_at_ms: Date.now() - DAY }));
      expect(mockPrisma.subscription.create.mock.calls[0][0].data).toMatchObject({ status: 'EXPIRED' });
      expect(mockEntitlements.grantMonthlyCreditsForGoverningSub).not.toHaveBeenCalled();
      expect(sentryCall('revenuecat.stale_activation_ignored')?.[1]).toMatchObject({ tags: { reason: 'period_already_over' } });
    });

    it('an EXPIRED row is not re-activated by a later-but-already-over expiry (audit M1)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ status: 'EXPIRED', currentPeriodEnd: new Date(Date.now() - 5 * DAY) }));
      await svc.handleEvent(makeEvent({ type: 'RENEWAL', expiration_at_ms: Date.now() - DAY }));
      const data = mockPrisma.subscription.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('status');
      expect(mockEntitlements.grantMonthlyCreditsForSubscription).not.toHaveBeenCalled();
    });

    it('an ACTIVE row receiving an already-over (but newer) expiry stays ACTIVE (its EXPIRATION is still to come)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ currentPeriodEnd: new Date(Date.now() - 5 * DAY) }));
      await svc.handleEvent(makeEvent({ type: 'RENEWAL', expiration_at_ms: Date.now() - DAY }));
      expect(mockPrisma.subscription.update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE' });
    });

    it('EXPIRATION records its expiry as the period end, so a retried RENEWAL for that period is then ignored (audit M1)', async () => {
      const oldEnd = Date.now() - 40 * DAY;
      const expiredAt = Date.now() - 10 * DAY;
      mockPrisma.subscription.findFirst.mockResolvedValue(
        subRow({ currentPeriodStart: new Date(oldEnd - 30 * DAY), currentPeriodEnd: new Date(oldEnd) }),
      );
      await svc.handleEvent(makeEvent({ type: 'EXPIRATION', expiration_at_ms: expiredAt }));
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'EXPIRED', currentPeriodEnd: new Date(expiredAt) },
      });
    });

    it('EXPIRATION never shortens the stored period end', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(subRow({ currentPeriodEnd: new Date(rowEnd) }));
      await svc.handleEvent(makeEvent({ type: 'EXPIRATION', expiration_at_ms: rowEnd - DAY }));
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({ where: { id: 'sub-1' }, data: { status: 'EXPIRED' } });
    });

    it('a refund recorded BEFORE its purchase blocks the purchase (exact key query)', async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue({ id: 'tx-refund' });
      await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', transaction_id: 'apple_tx_1' }));
      expect(mockPrisma.transaction.findUnique).toHaveBeenCalledWith({
        where: { stripePaymentId: 'rc-refund:apple_tx_1' },
        select: { id: true },
      });
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
      expect(sentryCall('revenuecat.stale_activation_ignored')?.[1]).toMatchObject({
        tags: { reason: 'refund_already_recorded' },
      });
    });

    it('an activation with no transaction_id does not look for a refund', async () => {
      await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', transaction_id: undefined }));
      expect(mockPrisma.transaction.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.create).toHaveBeenCalled();
    });
  });

  // ============================================================
  // PR #76 review — two retry orderings that cost money or access
  // ============================================================
  describe('PR #76 review — a late EXPIRATION must not end a newer period', () => {
    // The customer lapsed, then resubscribed on the same original transaction:
    // the stored row is ACTIVE with a period that STARTED after the old expiry.
    const resubscribed = () =>
      subRow({ currentPeriodStart: new Date(Date.now() - 2 * DAY), currentPeriodEnd: new Date(Date.now() + 28 * DAY) });

    it('an EXPIRATION for the period before the current one is ignored — no write, no tier recompute', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(resubscribed());
      await svc.handleEvent(makeEvent({ type: 'EXPIRATION', expiration_at_ms: Date.now() - 3 * DAY }));
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
      expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
      expect(sentryNames()).toContain('revenuecat.stale_expiration_ignored');
    });

    it('an expiry exactly at the current period start is the old period — ignored', async () => {
      const row = resubscribed();
      mockPrisma.subscription.findFirst.mockResolvedValue(row);
      await svc.handleEvent(makeEvent({ type: 'EXPIRATION', expiration_at_ms: row.currentPeriodStart.getTime() }));
      expect(expiredUpdate()).toBeUndefined();
    });

    it('an expiry INSIDE the current period (a refund that shortened it) still expires', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(resubscribed());
      await svc.handleEvent(makeEvent({ type: 'EXPIRATION', expiration_at_ms: Date.now() - 60 * 60 * 1000 }));
      expect(expiredUpdate()).toBeDefined();
      expect(mockEntitlements.syncUserTier).toHaveBeenCalledWith('user-buyer');
      expect(sentryNames()).not.toContain('revenuecat.stale_expiration_ignored');
    });

    it('an EXPIRATION with no expiry still expires (nothing to compare)', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(resubscribed());
      await svc.handleEvent(makeEvent({ type: 'EXPIRATION', expiration_at_ms: undefined }));
      expect(expiredUpdate()).toBeDefined();
    });
  });

  describe('PR #76 review — a credit-pack refund that arrives before its purchase', () => {
    const packEvent = (overrides: Partial<RevenueCatEvent>) =>
      makeEvent({ product_id: 'com.tianming.app.credits.12', transaction_id: 'apple_pack_1', ...overrides });
    beforeEach(() => mockPrisma.creditPackage.findFirst.mockResolvedValue(PACK));

    it('the refund of a never-granted pack records the REFUND row but claws back NOTHING (exact grant query)', async () => {
      mockPrisma.creditLedger.findFirst.mockResolvedValue(null);
      await svc.handleEvent(packEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }));
      expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stripePaymentId: 'rc-refund:apple_pack_1', type: 'REFUND' }),
      });
      expect(mockPrisma.creditLedger.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-buyer', reason: 'iap-credit-pack:value-12:apple_pack_1' },
        select: { id: true },
      });
      expect(mockEntitlements.clawbackCredits).not.toHaveBeenCalled();
      expect(sentryNames()).toContain('revenuecat.refund_before_purchase');
    });

    it('the refund of a granted pack claws it back as before', async () => {
      await svc.handleEvent(packEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }));
      expect(mockEntitlements.clawbackCredits).toHaveBeenCalledWith('user-buyer', 12, 'iap-refund:value-12:apple_pack_1');
    });

    it('a refund with no transaction_id cannot look the grant up — claws back as before', async () => {
      await svc.handleEvent(packEvent({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', transaction_id: undefined }));
      expect(mockPrisma.creditLedger.findFirst).not.toHaveBeenCalled();
      expect(mockEntitlements.clawbackCredits).toHaveBeenCalled();
    });

    it('the purchase of an already-refunded pack records the sale but grants NOTHING (exact refund query)', async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue({ id: 'tx-refund' });
      await svc.handleEvent(packEvent({ type: 'NON_RENEWING_PURCHASE' }));
      expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stripePaymentId: 'rc-purchase:apple_pack_1', type: 'CREDIT_PURCHASE' }),
      });
      expect(mockPrisma.transaction.findUnique).toHaveBeenCalledWith({
        where: { stripePaymentId: 'rc-refund:apple_pack_1' },
        select: { id: true },
      });
      expect(mockEntitlements.grantCredits).not.toHaveBeenCalled();
      expect(sentryNames()).toContain('revenuecat.refunded_purchase_not_granted');
    });

    it('a purchase with no refund grants, under the reason the refund looks up', async () => {
      await svc.handleEvent(packEvent({ type: 'NON_RENEWING_PURCHASE' }));
      expect(mockEntitlements.grantCredits).toHaveBeenCalledWith('user-buyer', 12, 'iap-credit-pack:value-12:apple_pack_1');
    });
  });
});
