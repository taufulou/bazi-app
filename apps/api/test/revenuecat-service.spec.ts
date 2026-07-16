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
  user: { findUnique: jest.fn() },
  plan: { findFirst: jest.fn() },
  creditPackage: { findFirst: jest.fn() },
  subscription: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  transaction: { create: jest.fn() },
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

function makeEvent(overrides: Partial<RevenueCatEvent>): RevenueCatEvent {
  return {
    id: 'evt_1',
    type: 'INITIAL_PURCHASE',
    app_user_id: 'clerk_buyer',
    product_id: 'com.tianming.pro.monthly',
    store: 'APP_STORE',
    purchased_at_ms: Date.parse('2026-02-01'),
    expiration_at_ms: Date.parse('2026-03-01'),
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
    const existing = { id: 'sub-db-1', userId: 'user-buyer', planTier: 'PRO', currentPeriodStart: new Date('2026-02-01'), currentPeriodEnd: new Date('2026-03-01') };
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
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-db-1', userId: 'user-buyer' });

    await svc.handleEvent(makeEvent({ type: 'EXPIRATION' }));

    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-db-1' }, data: { status: 'EXPIRED' } }),
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
  it('skips when the product maps to no active Plan', async () => {
    mockPrisma.plan.findFirst.mockResolvedValue(null);
    mockPrisma.creditPackage.findFirst.mockResolvedValue(null);
    await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', product_id: 'unknown.product' }));
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    expect(mockEntitlements.syncUserTier).not.toHaveBeenCalled();
  });

  it('skips when the app_user_id resolves to no user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE' }));
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
  });

  it('ignores the $RCAnonymousID app_user_id', async () => {
    await svc.handleEvent(makeEvent({ type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc', aliases: [], original_app_user_id: undefined }));
    // No non-anonymous candidate → user lookup never yields a user.
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
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
});
