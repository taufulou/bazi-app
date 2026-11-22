/**
 * Tests for RevenueCatService — mobile-IAP webhook event handling. Asserts each
 * event type routes to the correct EntitlementsService call + Subscription
 * upsert, the two-provider governing-sub dedup on RENEWAL, the consumable
 * refund clawback (+ Sentry alert), BILLING_ISSUE grace (no status flip), and
 * TRANSFER (move sub + recompute both users).
 */
import { RevenueCatService, RevenueCatEvent } from '../src/payments/revenuecat.service';

// Mock Sentry so the clawback alert is observable + inert.
const mockCaptureMessage = jest.fn();
jest.mock('@sentry/nestjs', () => ({ captureMessage: (...args: unknown[]) => mockCaptureMessage(...args) }));

const mockPrisma = {
  // findFirst: the soft-deleted lookup (`deleted_<id>_`) added by 1A-core item 3.
  user: { findUnique: jest.fn(), findFirst: jest.fn() },
  plan: { findFirst: jest.fn() },
  creditPackage: { findFirst: jest.fn() },
  subscription: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  // findUnique: the refund-before-purchase check (1A-core item 5).
  transaction: { create: jest.fn(), findUnique: jest.fn() },
  monthlyCreditsLog: { findUnique: jest.fn() },
  // findFirst: the pack-grant lookup a consumable refund makes (PR #76 review).
  creditLedger: { findFirst: jest.fn() },
  // Implementation set in beforeEach (it invokes the callback with this same
  // mock and propagates its rejection — so a test can tell whether a P2002 is
  // caught inside or outside the transaction).
  $transaction: jest.fn(),
};

const mockEntitlements = {
  syncUserTier: jest.fn().mockResolvedValue({ tier: 'PRO', changed: true }),
  grantMonthlyCreditsForSubscription: jest.fn().mockResolvedValue({ granted: true, creditsGranted: 15 }),
  grantMonthlyCreditsForGoverningSub: jest.fn().mockResolvedValue({ granted: true, creditsGranted: 15 }),
  grantCredits: jest.fn(),
  clawbackCredits: jest.fn().mockResolvedValue({ clawedBack: 12 }),
};

const mockConfig = {
  get: jest.fn().mockImplementation((k: string) => (k === 'RC_WEBHOOK_SECRET' ? 'rc-secret' : undefined)),
};

const DAY = 24 * 60 * 60 * 1000;

function makeEvent(overrides: Partial<RevenueCatEvent>): RevenueCatEvent {
  return {
    id: 'evt_1',
    type: 'INITIAL_PURCHASE',
    app_user_id: 'clerk_buyer',
    product_id: 'com.tianming.pro.monthly',
    store: 'APP_STORE',
    // Relative to now: since 1A-core an activation whose period is already over
    // is recorded EXPIRED, not ACTIVE, so fixed past dates would change meaning.
    purchased_at_ms: Date.now() - DAY,
    expiration_at_ms: Date.now() + 29 * DAY,
    original_transaction_id: 'apple_tx_1',
    transaction_id: 'apple_tx_1',
    ...overrides,
  };
}

describe('RevenueCatService', () => {
  let svc: RevenueCatService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new RevenueCatService(mockPrisma as any, mockEntitlements as any, mockConfig as any);
    // Default resolutions
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-buyer' });
    mockPrisma.plan.findFirst.mockResolvedValue({ slug: 'pro', isActive: true });
    mockPrisma.creditPackage.findFirst.mockResolvedValue(null);
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.transaction.findUnique.mockResolvedValue(null);
    mockPrisma.monthlyCreditsLog.findUnique.mockResolvedValue(null);
    mockPrisma.creditLedger.findFirst.mockResolvedValue({ id: 'ledger-grant' }); // the pack was granted
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockEntitlements.syncUserTier.mockResolvedValue({ tier: 'PRO', changed: true });
  });

  // ---- auth ----
  describe('verifyAuthHeader', () => {
    it('accepts the exact bearer secret', () => {
      expect(svc.verifyAuthHeader('Bearer rc-secret')).toBe(true);
    });
    it('rejects a wrong/missing bearer', () => {
      expect(svc.verifyAuthHeader('Bearer nope')).toBe(false);
      expect(svc.verifyAuthHeader(undefined)).toBe(false);
    });
    it('fails closed when the secret is unset', () => {
      mockConfig.get.mockReturnValueOnce(undefined);
      expect(svc.verifyAuthHeader('Bearer rc-secret')).toBe(false);
    });
  });

  // ---- INITIAL_PURCHASE ----
  it('INITIAL_PURCHASE: creates an Apple sub, recomputes tier, grants for governing', async () => {
    await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE' }));

    expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-buyer',
          planTier: 'PRO',
          status: 'ACTIVE',
          platform: 'APPLE_IAP',
          appleOriginalTxId: 'apple_tx_1',
        }),
      }),
    );
    expect(mockEntitlements.syncUserTier).toHaveBeenCalledWith('user-buyer');
    expect(mockEntitlements.grantMonthlyCreditsForGoverningSub).toHaveBeenCalledWith('user-buyer');
  });

  it('maps a Play product to GOOGLE_PLAY + googlePurchaseToken', async () => {
    await svc.handleEvent(makeEvent({ store: 'PLAY_STORE', original_transaction_id: 'goog_tok_1' }));
    expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ platform: 'GOOGLE_PLAY', googlePurchaseToken: 'goog_tok_1' }) }),
    );
  });

  // ---- RENEWAL ----
  it('RENEWAL: updates the existing sub + grants via the governing-sub gate', async () => {
    const existing = { id: 'sub-db-1', userId: 'user-buyer', planTier: 'PRO', status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 31 * DAY), currentPeriodEnd: new Date(Date.now() - DAY) };
    mockPrisma.subscription.findFirst.mockResolvedValue(existing);

    await svc.handleEvent(makeEvent({ type: 'RENEWAL' }));

    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-db-1' }, data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(mockEntitlements.grantMonthlyCreditsForSubscription).toHaveBeenCalledWith(
      'user-buyer',
      existing,
      expect.objectContaining({ periodStart: expect.any(Date), periodEnd: expect.any(Date) }),
    );
    expect(mockEntitlements.grantMonthlyCreditsForGoverningSub).not.toHaveBeenCalled();
  });

  // ---- NON_RENEWING_PURCHASE (consumable pack) ----
  it('NON_RENEWING_PURCHASE: grants pack credits + records a transaction', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue(null);
    mockPrisma.creditPackage.findFirst.mockResolvedValue({ slug: 'value-12', creditAmount: 12, priceUsd: 4.99, isActive: true });

    await svc.handleEvent(makeEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'com.tianming.credits.12', transaction_id: 'apple_consumable_1' }));

    expect(mockEntitlements.grantCredits).toHaveBeenCalledWith('user-buyer', 12, expect.stringContaining('iap-credit-pack:value-12'));
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CREDIT_PURCHASE' }) }),
    );
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
  });

  // ---- CANCELLATION: consumable refund ----
  it('CANCELLATION (consumable) claws back credits + Sentry alert', async () => {
    mockPrisma.creditPackage.findFirst.mockResolvedValue({ slug: 'value-12', creditAmount: 12, priceUsd: 4.99, isActive: true });

    await svc.handleEvent(makeEvent({ type: 'CANCELLATION', product_id: 'com.tianming.credits.12', transaction_id: 'apple_consumable_1', cancel_reason: 'CUSTOMER_SUPPORT' }));

    expect(mockEntitlements.clawbackCredits).toHaveBeenCalledWith('user-buyer', 12, expect.stringContaining('iap-refund:value-12'));
    expect(mockCaptureMessage).toHaveBeenCalledWith('RevenueCat consumable refund', expect.objectContaining({ level: 'warning' }));
    expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
  });

  // ---- CANCELLATION: subscription (auto-renew off) ----
  it('CANCELLATION (subscription) marks cancelledAt but KEEPS the tier (no status flip, no recompute)', async () => {
    mockPrisma.creditPackage.findFirst.mockResolvedValue(null); // product maps to a plan, not a pack
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1', userId: 'user-buyer' });

    await svc.handleEvent(makeEvent({ type: 'CANCELLATION' }));

    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-db-1' }, data: { cancelledAt: expect.any(Date) } }),
    );
    // Grace: tier persists until EXPIRATION.
    expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
    expect(mockEntitlements.clawbackCredits).not.toHaveBeenCalled();
  });

  // ---- EXPIRATION ----
  it('EXPIRATION: flips to EXPIRED + recomputes tier', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1', userId: 'user-buyer', currentPeriodEnd: new Date(Date.now() + 29 * DAY) });

    await svc.handleEvent(makeEvent({ type: 'EXPIRATION' }));

    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-db-1' }, data: expect.objectContaining({ status: 'EXPIRED' }) }),
    );
    expect(mockEntitlements.syncUserTier).toHaveBeenCalledWith('user-buyer');
  });

  // ---- BILLING_ISSUE grace ----
  it('BILLING_ISSUE: log-only — no status flip, no recompute (grace)', async () => {
    await svc.handleEvent(makeEvent({ type: 'BILLING_ISSUE' }));
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
  });

  // ---- TRANSFER ----
  it('TRANSFER: moves the sub to the new user + recomputes BOTH users', async () => {
    mockPrisma.user.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.clerkUserId === 'clerk_to'
          ? { id: 'user-to' }
          : where.clerkUserId === 'clerk_from'
            ? { id: 'user-from' }
            : null,
      ),
    );
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1', userId: 'user-from' });

    await svc.handleEvent(
      makeEvent({ type: 'TRANSFER', transferred_from: ['clerk_from'], transferred_to: ['clerk_to'] }),
    );

    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-db-1' }, data: { userId: 'user-to' } }),
    );
    expect(mockEntitlements.syncUserTier).toHaveBeenCalledWith('user-from');
    expect(mockEntitlements.syncUserTier).toHaveBeenCalledWith('user-to');
  });

  // ---- unknown mappings / users ----
  // 1A-core item 3: these used to log-and-skip, the controller answered 200, and
  // the event was lost. They now THROW so the controller 500s and RevenueCat
  // retries. (Full coverage of the outcomes lives in revenuecat-1a-core.spec.ts.)
  it('throws when the product maps to no Plan (unmapped product is not acknowledged)', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue(null);
    mockPrisma.creditPackage.findFirst.mockResolvedValue(null);
    await expect(
      svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', product_id: 'unknown.product' })),
    ).rejects.toMatchObject({ reason: 'unmapped_product' });
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
  });

  it('throws when the app_user_id was never seen (not deleted, not anonymous)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE' }))).rejects.toMatchObject({
      reason: 'unknown_app_user',
    });
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
  });

  it('ignores the $RCAnonymousID app_user_id — acknowledged, no Sentry event', async () => {
    await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc', aliases: [], original_app_user_id: undefined }));
    // No non-anonymous candidate → user lookup never yields a user.
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  // ---- audit fixes ----
  it('NON_RENEWING_PURCHASE is idempotent — a duplicate (P2002) skips the grant', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue(null);
    mockPrisma.creditPackage.findFirst.mockResolvedValue({ slug: 'value-12', creditAmount: 12, priceUsd: 4.99, isActive: true });
    mockPrisma.transaction.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await svc.handleEvent(makeEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'com.tianming.credits.12' }));
    expect(mockEntitlements.grantCredits).not.toHaveBeenCalled();
  });

  it('CANCELLATION (consumable) is idempotent — a duplicate refund (P2002) skips the clawback', async () => {
    mockPrisma.creditPackage.findFirst.mockResolvedValue({ slug: 'value-12', creditAmount: 12, priceUsd: 4.99, isActive: true });
    mockPrisma.transaction.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await svc.handleEvent(makeEvent({ type: 'CANCELLATION', product_id: 'com.tianming.credits.12' }));
    expect(mockEntitlements.clawbackCredits).not.toHaveBeenCalled();
  });

  it('skips a non-IAP store (e.g. STRIPE proxied via RC) — no sub, no recompute', async () => {
    await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', store: 'STRIPE' }));
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------
  // The same guard on the OTHER store-dependent handlers. Previously only
  // handleActiveSubscription had it, so if RC were ever configured with a non-IAP
  // store (Stripe / RC Billing — which the guard's own comment anticipates) a
  // NON_RENEWING_PURCHASE would grant credits via RC *and* again via the native
  // Stripe webhook. The idempotency keys differ (rc-purchase:<rc-tx> vs Stripe's
  // payment id), so neither dedup catches it. Rows would also be mislabelled
  // APPLE_IAP by platformFromStore's default, wrongly tripping the
  // account-deletion "cancel in App Store" interstitial.
  // ------------------------------------------------------------

  it('NON_RENEWING_PURCHASE from a non-IAP store grants nothing and writes no Transaction', async () => {
    mockPrisma.creditPackage.findFirst.mockResolvedValue({
      slug: 'value-12', creditAmount: 12, priceUsd: 4.99, isActive: true,
    });

    await svc.handleEvent(
      makeEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'com.tianming.credits.12', store: 'STRIPE' }),
    );

    expect(mockEntitlements.grantCredits).not.toHaveBeenCalled();
    // The guard must run BEFORE the idempotency Transaction — otherwise an orphan
    // APPLE_IAP row is left behind and the rc-purchase key is permanently poisoned.
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  it('EXPIRATION from a non-IAP store touches no subscription row', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1', userId: 'user-1' });

    await svc.handleEvent(makeEvent({ type: 'EXPIRATION', store: 'STRIPE' }));

    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
  });

  it('CANCELLATION from a PROMOTIONAL store claws nothing back', async () => {
    mockPrisma.creditPackage.findFirst.mockResolvedValue({
      slug: 'value-12', creditAmount: 12, priceUsd: 4.99, isActive: true,
    });

    await svc.handleEvent(
      makeEvent({ type: 'CANCELLATION', product_id: 'com.tianming.credits.12', store: 'PROMOTIONAL' }),
    );

    expect(mockEntitlements.clawbackCredits).not.toHaveBeenCalled();
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  it('TRANSFER is deliberately NOT gated on store — still moves the sub when store is absent', async () => {
    // handleTransfer reads `store` only through platformFromStore, whose APPLE_IAP
    // default means it is designed to tolerate an absent store. Hoisting the guard
    // to handleEvent would silently drop transfers, stranding a subscription on the
    // wrong user with a stale tier — which is why the guard lives in the four
    // store-dependent handlers instead.
    mockPrisma.user.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.clerkUserId === 'clerk_to'
          ? { id: 'user-to' }
          : where.clerkUserId === 'clerk_from'
            ? { id: 'user-from' }
            : null,
      ),
    );
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1', userId: 'user-from' });

    await svc.handleEvent(
      makeEvent({
        type: 'TRANSFER',
        store: undefined,
        transferred_from: ['clerk_from'],
        transferred_to: ['clerk_to'],
      }),
    );

    expect(mockPrisma.subscription.update).toHaveBeenCalled();
    expect(mockEntitlements.syncUserTier).toHaveBeenCalled();
  });
});
