/**
 * Tests for EntitlementsService — the provider-neutral tier recompute + credit
 * grants/clawbacks. Covers the M6 cross-provider rules: max-tier-across-active,
 * equal-tier tiebreak (earliest currentPeriodStart), never-blind-downgrade, and
 * the governing-sub monthly-credit dedup (two-provider EQUAL-tier fixture).
 */
import { EntitlementsService } from '../src/payments/entitlements.service';
import type { Subscription, SubscriptionTier } from '@prisma/client';

// ---- mock prisma + chat-payment ----
const mockTxUser = { update: jest.fn(), findUnique: jest.fn() };
const mockTxMonthlyCreditsLog = { create: jest.fn() };
const mockTxCreditLedger = { create: jest.fn() };
const mockTxQueryRaw = jest.fn();

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  plan: { findFirst: jest.fn() },
  subscription: { findMany: jest.fn() },
  monthlyCreditsLog: { create: jest.fn() },
  $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      user: mockTxUser,
      monthlyCreditsLog: mockTxMonthlyCreditsLog,
      creditLedger: mockTxCreditLedger,
      $queryRaw: mockTxQueryRaw,
    }),
  ),
};

const mockChatPayment = { resnapshotChatQuotaOnTierChange: jest.fn() };

/**
 * Build a minimal active Subscription row. `createdAt` defaults to `start` so
 * the existing tiebreak tests (which vary `start`) keep the same relative order;
 * pass `createdAt` explicitly to diverge it from `currentPeriodStart`.
 */
function sub(
  overrides: Partial<Subscription> & { id: string; planTier: SubscriptionTier; start: string },
): Subscription {
  return {
    id: overrides.id,
    userId: overrides.userId ?? 'user-1',
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? null,
    appleOriginalTxId: overrides.appleOriginalTxId ?? null,
    googlePurchaseToken: overrides.googlePurchaseToken ?? null,
    planTier: overrides.planTier,
    status: overrides.status ?? 'ACTIVE',
    platform: overrides.platform ?? 'STRIPE',
    currentPeriodStart: new Date(overrides.start),
    currentPeriodEnd: new Date('2027-01-01'),
    cancelledAt: null,
    createdAt: overrides.createdAt ?? new Date(overrides.start),
    updatedAt: new Date('2026-01-01'),
  } as Subscription;
}

describe('EntitlementsService', () => {
  let svc: EntitlementsService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new EntitlementsService(mockPrisma as any, mockChatPayment as any);
  });

  // ---- pickGoverningSubscription / computeEffectiveTier (pure) ----
  describe('effective tier (pure)', () => {
    it('empty set → null / FREE', () => {
      expect(svc.pickGoverningSubscription([])).toBeNull();
      expect(svc.computeEffectiveTier([])).toBe('FREE');
    });

    it('picks the MAX tier across providers', () => {
      const subs = [sub({ id: 'a', planTier: 'BASIC', start: '2026-02-01', platform: 'STRIPE' }), sub({ id: 'b', planTier: 'PRO', start: '2026-03-01', platform: 'APPLE_IAP' })];
      expect(svc.computeEffectiveTier(subs)).toBe('PRO');
      expect(svc.pickGoverningSubscription(subs)?.id).toBe('b');
    });

    it('equal-tier tiebreak = earliest currentPeriodStart', () => {
      const subs = [
        sub({ id: 'later', planTier: 'BASIC', start: '2026-02-15', platform: 'APPLE_IAP' }),
        sub({ id: 'earlier', planTier: 'BASIC', start: '2026-02-01', platform: 'STRIPE' }),
      ];
      expect(svc.pickGoverningSubscription(subs)?.id).toBe('earlier');
      expect(svc.computeEffectiveTier(subs)).toBe('BASIC');
    });

    it('higher tier beats an earlier-start lower tier', () => {
      const subs = [
        sub({ id: 'earlyBasic', planTier: 'BASIC', start: '2026-01-01' }),
        sub({ id: 'latePro', planTier: 'PRO', start: '2026-06-01' }),
      ];
      expect(svc.pickGoverningSubscription(subs)?.id).toBe('latePro');
    });

    it('tiebreak uses IMMUTABLE createdAt, NOT the mutable currentPeriodStart (Finding 1)', () => {
      // Apple was created FIRST but just renewed, so its currentPeriodStart is
      // now LATER than Stripe's — it must still govern (earlier createdAt), else
      // the governing sub would oscillate on renewal and starve both subs.
      const apple = sub({ id: 'apple', planTier: 'BASIC', start: '2026-03-01', createdAt: new Date('2026-01-01'), platform: 'APPLE_IAP' });
      const stripe = sub({ id: 'stripe', planTier: 'BASIC', start: '2026-02-01', createdAt: new Date('2026-02-15'), platform: 'STRIPE' });
      expect(svc.pickGoverningSubscription([apple, stripe])?.id).toBe('apple');
    });
  });

  // ---- syncUserTier ----
  describe('syncUserTier', () => {
    it('writes the recomputed tier + resnapshots chat when it changed', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([sub({ id: 'a', planTier: 'PRO', start: '2026-02-01' })]);
      mockPrisma.user.findUnique.mockResolvedValue({ subscriptionTier: 'FREE' });

      const res = await svc.syncUserTier('user-1');

      expect(res).toEqual({ tier: 'PRO', changed: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { subscriptionTier: 'PRO' } });
      expect(mockChatPayment.resnapshotChatQuotaOnTierChange).toHaveBeenCalledWith('user-1', 'PRO');
    });

    it('does NOT write when the tier is unchanged', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([sub({ id: 'a', planTier: 'PRO', start: '2026-02-01' })]);
      mockPrisma.user.findUnique.mockResolvedValue({ subscriptionTier: 'PRO' });

      const res = await svc.syncUserTier('user-1');

      expect(res.changed).toBe(false);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      // resnapshot still called (idempotent internally)
      expect(mockChatPayment.resnapshotChatQuotaOnTierChange).toHaveBeenCalledWith('user-1', 'PRO');
    });

    it('drops to FREE only when NO active sub remains', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({ subscriptionTier: 'PRO' });

      const res = await svc.syncUserTier('user-1');
      expect(res).toEqual({ tier: 'FREE', changed: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { subscriptionTier: 'FREE' } });
    });

    it('NEVER blind-downgrades: a Stripe BASIC + Apple PRO user stays PRO', async () => {
      // Simulates: Stripe sub is BASIC, but the user also holds an Apple PRO.
      // Recompute must yield PRO (max), not BASIC.
      mockPrisma.subscription.findMany.mockResolvedValue([
        sub({ id: 'stripe', planTier: 'BASIC', start: '2026-02-01', platform: 'STRIPE' }),
        sub({ id: 'apple', planTier: 'PRO', start: '2026-03-01', platform: 'APPLE_IAP' }),
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ subscriptionTier: 'BASIC' });

      const res = await svc.syncUserTier('user-1');
      expect(res.tier).toBe('PRO');
    });

    it('does not throw when chat resnapshot fails', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({ subscriptionTier: 'FREE' });
      mockChatPayment.resnapshotChatQuotaOnTierChange.mockRejectedValueOnce(new Error('redis down'));
      await expect(svc.syncUserTier('user-1')).resolves.toEqual({ tier: 'FREE', changed: false });
    });
  });

  // ---- grantMonthlyCredits (moved verbatim) ----
  describe('grantMonthlyCredits', () => {
    it('grants the plan amount and is idempotent on P2002', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue({ slug: 'pro', monthlyCredits: 15, isActive: true });
      const ok = await svc.grantMonthlyCredits('user-1', 'PRO', new Date('2026-02-01'), new Date('2026-03-01'));
      expect(ok).toEqual({ granted: true, creditsGranted: 15 });
      expect(mockTxMonthlyCreditsLog.create).toHaveBeenCalled();

      const p2002 = Object.assign(new Error('dup'), { code: 'P2002' });
      mockPrisma.$transaction.mockRejectedValueOnce(p2002);
      const dup = await svc.grantMonthlyCredits('user-1', 'PRO', new Date('2026-02-01'), new Date('2026-03-01'));
      expect(dup).toEqual({ granted: false, creditsGranted: 0 });
    });

    it('skips unknown tier', async () => {
      const res = await svc.grantMonthlyCredits('user-1', 'FREE', new Date(), new Date());
      expect(res.granted).toBe(false);
      expect(mockPrisma.plan.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---- governing-sub gate ----
  describe('grantMonthlyCreditsForSubscription (governing gate)', () => {
    it('grants when the triggering sub IS governing', async () => {
      const s = sub({ id: 'gov', planTier: 'PRO', start: '2026-02-01' });
      mockPrisma.subscription.findMany.mockResolvedValue([s]);
      mockPrisma.plan.findFirst.mockResolvedValue({ slug: 'pro', monthlyCredits: 15, isActive: true });

      const res = await svc.grantMonthlyCreditsForSubscription('user-1', s);
      expect(res.granted).toBe(true);
    });

    it('SKIPS when the triggering sub is NOT governing (two-provider EQUAL tier)', async () => {
      // Stripe BASIC (earlier, governing) + Apple BASIC (later). The Apple
      // renewal must NOT grant — only the governing Stripe sub does.
      const stripe = sub({ id: 'stripe', planTier: 'BASIC', start: '2026-02-01', platform: 'STRIPE' });
      const apple = sub({ id: 'apple', planTier: 'BASIC', start: '2026-02-15', platform: 'APPLE_IAP' });
      mockPrisma.subscription.findMany.mockResolvedValue([stripe, apple]);

      const res = await svc.grantMonthlyCreditsForSubscription('user-1', apple);
      expect(res).toEqual({ granted: false, creditsGranted: 0, reason: 'not-governing-subscription' });
      expect(mockPrisma.plan.findFirst).not.toHaveBeenCalled(); // never reached the grant
    });

    it('grantMonthlyCreditsForGoverningSub grants for whoever governs', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([sub({ id: 'gov', planTier: 'MASTER', start: '2026-02-01' })]);
      mockPrisma.plan.findFirst.mockResolvedValue({ slug: 'master', monthlyCredits: 50, isActive: true });
      const res = await svc.grantMonthlyCreditsForGoverningSub('user-1');
      expect(res).toEqual({ granted: true, creditsGranted: 50 });
    });

    it('grantMonthlyCreditsForGoverningSub skips with no active sub', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);
      const res = await svc.grantMonthlyCreditsForGoverningSub('user-1');
      expect(res.reason).toBe('no-active-subscription');
    });
  });

  // ---- one-off grants / clawbacks ----
  describe('grantCredits / clawbackCredits', () => {
    it('grantCredits increments + writes a positive ledger row', async () => {
      await svc.grantCredits('user-1', 12, 'iap-credit-pack:value-12');
      expect(mockTxUser.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { credits: { increment: 12 } } });
      expect(mockTxCreditLedger.create).toHaveBeenCalledWith({ data: { userId: 'user-1', amount: 12, reason: 'iap-credit-pack:value-12' } });
    });

    it('grantCredits is a no-op for amount <= 0', async () => {
      await svc.grantCredits('user-1', 0, 'x');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    // Prisma has no nested interactive transactions: if a caller already opened one
    // and we opened another, the writes would land OUTSIDE the caller's transaction
    // and survive its rollback. handleOneTimePayment depends on this — it pairs the
    // grant with a UNIQUE Transaction row, and that pairing is only an idempotency
    // guarantee while the two are atomic.
    it('grantCredits enlists in a caller-supplied tx and does NOT open its own', async () => {
      const callerTxUser = { update: jest.fn() };
      const callerTxLedger = { create: jest.fn() };

      await svc.grantCredits('user-1', 12, 'stripe-credit-pack:value-12', {
        user: callerTxUser,
        creditLedger: callerTxLedger,
      } as never);

      // Writes land on the CALLER's client...
      expect(callerTxUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { credits: { increment: 12 } },
      });
      expect(callerTxLedger.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', amount: 12, reason: 'stripe-credit-pack:value-12' },
      });
      // ...and no second transaction is opened, nor any write on our own tx client.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTxUser.update).not.toHaveBeenCalled();
      expect(mockTxCreditLedger.create).not.toHaveBeenCalled();
    });

    it('clawbackCredits floors at the current balance (atomic GREATEST)', async () => {
      // The atomic UPDATE returns the amount actually removed (min(amount, balance)).
      mockTxQueryRaw.mockResolvedValue([{ clawed_back: 3 }]);
      const res = await svc.clawbackCredits('user-1', 5, 'iap-refund:value-12');
      expect(res).toEqual({ clawedBack: 3 });
      expect(mockTxCreditLedger.create).toHaveBeenCalledWith({ data: { userId: 'user-1', amount: -3, reason: 'iap-refund:value-12' } });
    });

    it('clawbackCredits removes the full amount when balance suffices', async () => {
      mockTxQueryRaw.mockResolvedValue([{ clawed_back: 5 }]);
      const res = await svc.clawbackCredits('user-1', 5, 'r');
      expect(res).toEqual({ clawedBack: 5 });
    });

    it('clawbackCredits is a no-op at zero balance', async () => {
      mockTxQueryRaw.mockResolvedValue([{ clawed_back: 0 }]);
      const res = await svc.clawbackCredits('user-1', 5, 'r');
      expect(res).toEqual({ clawedBack: 0 });
      expect(mockTxCreditLedger.create).not.toHaveBeenCalled();
    });
  });
});
