/**
 * Tests for PaymentsController — REST endpoint routing and DTO validation.
 */
import { PaymentsController } from '../src/payments/payments.controller';

// ============================================================
// Mock Services
// ============================================================

const mockPaymentsService = {
  getAvailableGateways: jest.fn(),
  getActivePlans: jest.fn(),
  getActiveCreditPackages: jest.fn(),
  getSubscriptionStatus: jest.fn(),
  getMonthlyCreditsStatus: jest.fn(),
  getTransactionHistory: jest.fn(),
};

const mockStripeService = {
  createSubscriptionCheckout: jest.fn(),
  createOneTimeCheckout: jest.fn(),
  createCreditPackageCheckout: jest.fn(),
  createPortalSession: jest.fn(),
  cancelSubscription: jest.fn(),
  reactivateSubscription: jest.fn(),
  canUseFreeReading: jest.fn(),
  markFreeReadingUsed: jest.fn(),
};

const mockSectionUnlockService = {
  unlockSection: jest.fn(),
  getUnlockedSections: jest.fn(),
  getReadingWithSectionAccess: jest.fn(),
};

// ============================================================
// Test Data
// ============================================================

const AUTH_PAYLOAD = { userId: 'clerk_user_abc', sessionId: 'sess_123' };

const MOCK_PLANS = [
  {
    id: 'plan-1',
    slug: 'basic',
    nameZhTw: '基礎版',
    priceMonthly: 4.99,
    priceAnnual: 39.99,
    currency: 'USD',
    readingsPerMonth: 5,
    isActive: true,
  },
  {
    id: 'plan-2',
    slug: 'pro',
    nameZhTw: '進階版',
    priceMonthly: 9.99,
    priceAnnual: 79.99,
    currency: 'USD',
    readingsPerMonth: 15,
    isActive: true,
  },
];

// ============================================================
// Tests
// ============================================================

describe('PaymentsController', () => {
  let controller: PaymentsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PaymentsController(
      mockPaymentsService as any,
      mockStripeService as any,
      mockSectionUnlockService as any,
    );
  });

  // ============================================================
  // Public Endpoints
  // ============================================================

  describe('GET /api/payments/gateways', () => {
    it('should return available payment gateways', async () => {
      const gateways = [
        { provider: 'stripe', region: 'global', isActive: true },
      ];
      mockPaymentsService.getAvailableGateways.mockResolvedValue(gateways);

      const result = await controller.getGateways('global');
      expect(result).toEqual(gateways);
      expect(mockPaymentsService.getAvailableGateways).toHaveBeenCalledWith('global');
    });

    it('should work without region filter', async () => {
      mockPaymentsService.getAvailableGateways.mockResolvedValue([]);
      await controller.getGateways(undefined);
      expect(mockPaymentsService.getAvailableGateways).toHaveBeenCalledWith(undefined);
    });
  });

  describe('GET /api/payments/plans', () => {
    it('should return active plans', async () => {
      mockPaymentsService.getActivePlans.mockResolvedValue(MOCK_PLANS);

      const result = await controller.getPlans();
      expect(result).toEqual(MOCK_PLANS);
      expect(result).toHaveLength(2);
    });
  });

  // ============================================================
  // Subscription Status
  // ============================================================

  describe('GET /api/payments/subscription', () => {
    it('should return subscription status for authenticated user', async () => {
      const status = {
        subscribed: true,
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: '2026-03-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      };
      mockPaymentsService.getSubscriptionStatus.mockResolvedValue(status);

      const result = await controller.getSubscriptionStatus(AUTH_PAYLOAD as any);
      expect(result).toEqual(status);
      expect(mockPaymentsService.getSubscriptionStatus).toHaveBeenCalledWith('clerk_user_abc');
    });
  });

  // ============================================================
  // Transaction History
  // ============================================================

  describe('GET /api/payments/transactions', () => {
    it('should return paginated transaction history', async () => {
      const txHistory = {
        items: [{ id: 'tx-1', amount: 9.99, type: 'SUBSCRIPTION' }],
        total: 1,
        page: 1,
        limit: 20,
      };
      mockPaymentsService.getTransactionHistory.mockResolvedValue(txHistory);

      const result = await controller.getTransactionHistory(AUTH_PAYLOAD as any, 1, 20);
      expect(result).toEqual(txHistory);
      expect(mockPaymentsService.getTransactionHistory).toHaveBeenCalledWith(
        'clerk_user_abc',
        1,
        20,
      );
    });
  });

  // ============================================================
  // Checkout Sessions
  // ============================================================

  describe('POST /api/payments/checkout/subscription', () => {
    it('should create a subscription checkout session', async () => {
      const checkoutResult = {
        sessionId: 'cs_123',
        url: 'https://checkout.stripe.com/session',
      };
      mockStripeService.createSubscriptionCheckout.mockResolvedValue(checkoutResult);

      const dto = {
        planSlug: 'pro',
        billingCycle: 'monthly' as const,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      };

      const result = await controller.createSubscriptionCheckout(AUTH_PAYLOAD as any, dto as any);

      expect(result).toEqual(checkoutResult);
      expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith({
        clerkUserId: 'clerk_user_abc',
        planSlug: 'pro',
        billingCycle: 'monthly',
        promoCode: undefined,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });
    });

    it('should pass promo code when provided', async () => {
      mockStripeService.createSubscriptionCheckout.mockResolvedValue({ sessionId: 'cs_x', url: 'url' });

      const dto = {
        planSlug: 'pro',
        billingCycle: 'annual' as const,
        promoCode: 'SAVE20',
        successUrl: 'url',
        cancelUrl: 'url',
      };

      await controller.createSubscriptionCheckout(AUTH_PAYLOAD as any, dto as any);

      expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ promoCode: 'SAVE20' }),
      );
    });
  });

  describe('POST /api/payments/checkout/one-time', () => {
    it('should create a one-time checkout session', async () => {
      const checkoutResult = {
        sessionId: 'cs_ot_123',
        url: 'https://checkout.stripe.com/one-time',
      };
      mockStripeService.createOneTimeCheckout.mockResolvedValue(checkoutResult);

      const dto = {
        serviceSlug: 'lifetime',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      };

      const result = await controller.createOneTimeCheckout(AUTH_PAYLOAD as any, dto as any);

      expect(result).toEqual(checkoutResult);
      expect(mockStripeService.createOneTimeCheckout).toHaveBeenCalledWith({
        clerkUserId: 'clerk_user_abc',
        serviceSlug: 'lifetime',
        promoCode: undefined,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });
    });
  });

  // ============================================================
  // Customer Portal
  // ============================================================

  describe('POST /api/payments/portal', () => {
    it('should create a customer portal session', async () => {
      const portalResult = { url: 'https://billing.stripe.com/portal/123' };
      mockStripeService.createPortalSession.mockResolvedValue(portalResult);

      const result = await controller.createPortalSession(
        AUTH_PAYLOAD as any,
        { returnUrl: 'https://example.com/dashboard' } as any,
      );

      expect(result).toEqual(portalResult);
      expect(mockStripeService.createPortalSession).toHaveBeenCalledWith(
        'clerk_user_abc',
        'https://example.com/dashboard',
      );
    });
  });

  // ============================================================
  // Subscription Management
  // ============================================================

  describe('POST /api/payments/cancel', () => {
    it('should cancel subscription', async () => {
      const cancelResult = { success: true, endsAt: '2026-03-01T00:00:00.000Z' };
      mockStripeService.cancelSubscription.mockResolvedValue(cancelResult);

      const result = await controller.cancelSubscription(AUTH_PAYLOAD as any);

      expect(result).toEqual(cancelResult);
      expect(mockStripeService.cancelSubscription).toHaveBeenCalledWith('clerk_user_abc');
    });
  });

  describe('POST /api/payments/reactivate', () => {
    it('should reactivate subscription', async () => {
      const reactivateResult = { success: true };
      mockStripeService.reactivateSubscription.mockResolvedValue(reactivateResult);

      const result = await controller.reactivateSubscription(AUTH_PAYLOAD as any);

      expect(result).toEqual(reactivateResult);
      expect(mockStripeService.reactivateSubscription).toHaveBeenCalledWith('clerk_user_abc');
    });
  });

  // ============================================================
  // Free Reading
  // ============================================================

  describe('GET /api/payments/free-reading', () => {
    it('should return free reading availability', async () => {
      mockStripeService.canUseFreeReading.mockResolvedValue(true);

      const result = await controller.checkFreeReading(AUTH_PAYLOAD as any);

      expect(result).toEqual({ available: true });
      expect(mockStripeService.canUseFreeReading).toHaveBeenCalledWith('clerk_user_abc');
    });

    it('should return not available when used', async () => {
      mockStripeService.canUseFreeReading.mockResolvedValue(false);

      const result = await controller.checkFreeReading(AUTH_PAYLOAD as any);
      expect(result).toEqual({ available: false });
    });
  });

  describe('POST /api/payments/free-reading/use', () => {
    it('should mark free reading as used', async () => {
      mockStripeService.markFreeReadingUsed.mockResolvedValue(undefined);

      const result = await controller.useFreeReading(AUTH_PAYLOAD as any);

      expect(result).toEqual({ success: true });
      expect(mockStripeService.markFreeReadingUsed).toHaveBeenCalledWith('clerk_user_abc');
    });
  });

  // ============================================================
  // Credit Packages
  // ============================================================

  describe('GET /api/payments/credit-packages', () => {
    it('should return active credit packages', async () => {
      const packages = [
        { id: 'pkg-1', slug: 'starter-5', creditAmount: 5, priceUsd: 4.99 },
        { id: 'pkg-2', slug: 'value-12', creditAmount: 12, priceUsd: 9.99 },
      ];
      mockPaymentsService.getActiveCreditPackages.mockResolvedValue(packages);

      const result = await controller.getCreditPackages();
      expect(result).toEqual(packages);
      expect(result).toHaveLength(2);
    });
  });

  // ============================================================
  // Monthly Credits Status
  // ============================================================

  describe('GET /api/payments/monthly-credits', () => {
    it('should return monthly credits status', async () => {
      const status = {
        currentPeriodCreditsGranted: 15,
        creditsRemaining: 10,
        nextResetDate: '2026-03-01T00:00:00.000Z',
      };
      mockPaymentsService.getMonthlyCreditsStatus.mockResolvedValue(status);

      const result = await controller.getMonthlyCreditsStatus(AUTH_PAYLOAD as any);
      expect(result).toEqual(status);
      expect(mockPaymentsService.getMonthlyCreditsStatus).toHaveBeenCalledWith('clerk_user_abc');
    });
  });

  // ============================================================
  // Credit Package Checkout
  // ============================================================

  describe('POST /api/payments/checkout/credits', () => {
    it('should create a credit package checkout session', async () => {
      const checkoutResult = {
        sessionId: 'cs_credit_123',
        url: 'https://checkout.stripe.com/credits',
      };
      mockStripeService.createCreditPackageCheckout.mockResolvedValue(checkoutResult);

      const dto = {
        packageSlug: 'starter-5',
        successUrl: '/dashboard?credits=success',
        cancelUrl: '/store?cancelled=true',
      };

      const result = await controller.createCreditCheckout(AUTH_PAYLOAD as any, dto as any);
      expect(result).toEqual(checkoutResult);
      expect(mockStripeService.createCreditPackageCheckout).toHaveBeenCalledWith({
        clerkUserId: 'clerk_user_abc',
        packageSlug: 'starter-5',
        successUrl: '/dashboard?credits=success',
        cancelUrl: '/store?cancelled=true',
      });
    });
  });

  // ============================================================
  // Section Unlock
  // ============================================================

  describe('POST /api/readings/:id/unlock-section', () => {
    it('should unlock a section via credit method', async () => {
      const unlockResult = { success: true, sectionKey: 'career', creditsUsed: 1 };
      mockSectionUnlockService.unlockSection.mockResolvedValue(unlockResult);

      const dto = { sectionKey: 'career', method: 'credit' as const, readingType: 'bazi' as const };
      const result = await controller.unlockSection(AUTH_PAYLOAD as any, 'reading-123', dto as any);

      expect(result).toEqual(unlockResult);
      expect(mockSectionUnlockService.unlockSection).toHaveBeenCalledWith(
        'clerk_user_abc',
        'reading-123',
        'bazi',
        'career',
        'credit',
      );
    });

    it('should unlock a section via ad_reward method', async () => {
      const unlockResult = { success: true, sectionKey: 'love', creditsUsed: 0 };
      mockSectionUnlockService.unlockSection.mockResolvedValue(unlockResult);

      const dto = { sectionKey: 'love', method: 'ad_reward' as const, readingType: 'zwds' as const };
      const result = await controller.unlockSection(AUTH_PAYLOAD as any, 'reading-456', dto as any);

      expect(result).toEqual(unlockResult);
      expect(mockSectionUnlockService.unlockSection).toHaveBeenCalledWith(
        'clerk_user_abc',
        'reading-456',
        'zwds',
        'love',
        'ad_reward',
      );
    });

    it('should propagate errors from service', async () => {
      mockSectionUnlockService.unlockSection.mockRejectedValue(
        new Error('Insufficient credits'),
      );

      const dto = { sectionKey: 'finance', method: 'credit' as const, readingType: 'bazi' as const };
      await expect(
        controller.unlockSection(AUTH_PAYLOAD as any, 'reading-789', dto as any),
      ).rejects.toThrow('Insufficient credits');
    });
  });

  describe('GET /api/readings/:id/unlocked-sections', () => {
    it('should return unlocked sections for a reading', async () => {
      const sectionsResult = { sections: ['career', 'love'], isSubscriber: false };
      mockSectionUnlockService.getUnlockedSections.mockResolvedValue(sectionsResult);

      const result = await controller.getUnlockedSections(AUTH_PAYLOAD as any, 'reading-123');

      expect(result).toEqual(sectionsResult);
      expect(mockSectionUnlockService.getUnlockedSections).toHaveBeenCalledWith(
        'clerk_user_abc',
        'reading-123',
      );
    });

    it('should return empty sections for new reading', async () => {
      const sectionsResult = { sections: [], isSubscriber: false };
      mockSectionUnlockService.getUnlockedSections.mockResolvedValue(sectionsResult);

      const result = await controller.getUnlockedSections(AUTH_PAYLOAD as any, 'reading-new');
      expect(result.sections).toHaveLength(0);
    });

    it('should show subscriber status', async () => {
      const sectionsResult = { sections: ['personality', 'career', 'love', 'finance', 'health'], isSubscriber: true };
      mockSectionUnlockService.getUnlockedSections.mockResolvedValue(sectionsResult);

      const result = await controller.getUnlockedSections(AUTH_PAYLOAD as any, 'reading-sub');
      expect(result.isSubscriber).toBe(true);
      expect(result.sections).toHaveLength(5);
    });
  });
});
