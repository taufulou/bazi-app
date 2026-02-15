/**
 * Tests for Payment API client functions.
 * Validates request format, auth headers, error handling.
 */
import {
  createSubscriptionCheckout,
  createOneTimeCheckout,
  getSubscriptionStatus,
  cancelSubscription,
  reactivateSubscription,
  createPortalSession,
  getActivePlans,
  checkFreeReading,
  useFreeReading,
} from '../app/lib/api';

// ============================================================
// Mock fetch
// ============================================================

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

function mockFetchSuccess(data: any) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, message: string) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ message }),
  });
}

// ============================================================
// Tests
// ============================================================

describe('Payment API Client', () => {
  describe('createSubscriptionCheckout', () => {
    it('sends correct payload with planSlug and billingCycle', async () => {
      const mockSession = { url: 'https://checkout.stripe.com/cs_123', sessionId: 'cs_123' };
      mockFetchSuccess(mockSession);

      const result = await createSubscriptionCheckout('token-123', {
        planSlug: 'pro',
        billingCycle: 'annual',
        successUrl: '/dashboard?subscription=success',
        cancelUrl: '/pricing?cancelled=true',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/payments/checkout/subscription'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer token-123',
          }),
          body: expect.stringContaining('"planSlug":"pro"'),
        }),
      );
      expect(result).toEqual(mockSession);
    });

    it('includes promoCode when provided', async () => {
      mockFetchSuccess({ url: 'https://checkout.stripe.com/cs_abc', sessionId: 'cs_abc' });

      await createSubscriptionCheckout('token-123', {
        planSlug: 'basic',
        billingCycle: 'monthly',
        promoCode: 'LAUNCH2026',
        successUrl: '/success',
        cancelUrl: '/cancel',
      });

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.promoCode).toBe('LAUNCH2026');
    });

    it('throws on API error', async () => {
      mockFetchError(400, 'Plan not found');

      await expect(
        createSubscriptionCheckout('token-123', {
          planSlug: 'invalid',
          billingCycle: 'monthly',
          successUrl: '/success',
          cancelUrl: '/cancel',
        }),
      ).rejects.toThrow('Plan not found');
    });
  });

  describe('createOneTimeCheckout', () => {
    it('sends serviceSlug in payload', async () => {
      mockFetchSuccess({ url: 'https://checkout.stripe.com/cs_456', sessionId: 'cs_456' });

      await createOneTimeCheckout('token-123', {
        serviceSlug: 'credit-pack-10',
        successUrl: '/success',
        cancelUrl: '/cancel',
      });

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.serviceSlug).toBe('credit-pack-10');
    });
  });

  describe('getSubscriptionStatus', () => {
    it('fetches subscription status with auth token', async () => {
      const mockStatus = {
        subscribed: true,
        plan: 'pro',
        status: 'active',
        currentPeriodEnd: '2026-04-15',
        cancelAtPeriodEnd: false,
      };
      mockFetchSuccess(mockStatus);

      const result = await getSubscriptionStatus('token-123');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/payments/subscription'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
          }),
        }),
      );
      expect(result).toEqual(mockStatus);
    });
  });

  describe('cancelSubscription', () => {
    it('sends POST to cancel endpoint', async () => {
      mockFetchSuccess({ message: 'Subscription cancelled' });

      await cancelSubscription('token-123');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/payments/cancel'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('getActivePlans', () => {
    it('fetches plans without auth token', async () => {
      const mockPlans = [{ id: 'plan-1', name: 'Basic' }];
      mockFetchSuccess(mockPlans);

      const result = await getActivePlans();

      // Should NOT include Authorization header
      const callHeaders = (global.fetch as jest.Mock).mock.calls[0][1]?.headers || {};
      expect(callHeaders.Authorization).toBeUndefined();
      expect(result).toEqual(mockPlans);
    });
  });
});
