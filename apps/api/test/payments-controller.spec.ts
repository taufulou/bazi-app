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
  getSubscriptionStatus: jest.fn(),
  getTransactionHistory: jest.fn(),
};

const mockStripeService = {
  createSubscriptionCheckout: jest.fn(),
  createOneTimeCheckout: jest.fn(),
  createPortalSession: jest.fn(),
  cancelSubscription: jest.fn(),
  reactivateSubscription: jest.fn(),
  canUseFreeReading: jest.fn(),
  markFreeReadingUsed: jest.fn(),
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
});
