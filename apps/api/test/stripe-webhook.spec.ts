/**
 * Tests for StripeWebhookController — webhook signature verification and event routing.
 */
import { StripeWebhookController } from '../src/webhooks/stripe-webhook.controller';

// ============================================================
// Mock StripeService
// ============================================================

const mockStripeService = {
  verifyWebhookSignature: jest.fn(),
  handleCheckoutCompleted: jest.fn(),
  handleSubscriptionUpdated: jest.fn(),
  handleSubscriptionDeleted: jest.fn(),
  handleInvoicePaid: jest.fn(),
  handleInvoiceFailed: jest.fn(),
};

// Mock RedisService (for idempotency)
const mockRedis = {
  get: jest.fn().mockResolvedValue(null), // not yet processed by default
  set: jest.fn().mockResolvedValue('OK'),
};

// Mock Express Response
const createMockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Mock Express Request with rawBody
const createMockRequest = (rawBody: string) => ({
  rawBody: Buffer.from(rawBody),
} as any);

// ============================================================
// Tests
// ============================================================

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new StripeWebhookController(mockStripeService as any, mockRedis as any);
  });

  // ============================================================
  // Signature Verification
  // ============================================================

  describe('signature verification', () => {
    it('should reject requests without signature', async () => {
      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, '');

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('signature') }),
      );
    });

    it('should reject requests without raw body', async () => {
      const req = { rawBody: undefined } as any;
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_123');

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid signatures', async () => {
      const req = createMockRequest('{}');
      const res = createMockResponse();
      mockStripeService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await controller.handleStripeWebhook(req, res, 'sig_invalid');

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid signature' }),
      );
    });
  });

  // ============================================================
  // Event Routing
  // ============================================================

  describe('checkout.session.completed', () => {
    it('should route to handleCheckoutCompleted', async () => {
      const sessionData = { id: 'cs_123', mode: 'subscription' };
      mockStripeService.verifyWebhookSignature.mockReturnValue({
        type: 'checkout.session.completed',
        id: 'evt_123',
        data: { object: sessionData },
      });
      mockStripeService.handleCheckoutCompleted.mockResolvedValue(undefined);

      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_valid');

      expect(mockStripeService.handleCheckoutCompleted).toHaveBeenCalledWith(sessionData);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });
  });

  describe('customer.subscription.updated', () => {
    it('should route to handleSubscriptionUpdated', async () => {
      const subData = { id: 'sub_123', status: 'active' };
      mockStripeService.verifyWebhookSignature.mockReturnValue({
        type: 'customer.subscription.updated',
        id: 'evt_124',
        data: { object: subData },
      });
      mockStripeService.handleSubscriptionUpdated.mockResolvedValue(undefined);

      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_valid');

      expect(mockStripeService.handleSubscriptionUpdated).toHaveBeenCalledWith(subData);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('customer.subscription.deleted', () => {
    it('should route to handleSubscriptionDeleted', async () => {
      const subData = { id: 'sub_123' };
      mockStripeService.verifyWebhookSignature.mockReturnValue({
        type: 'customer.subscription.deleted',
        id: 'evt_125',
        data: { object: subData },
      });
      mockStripeService.handleSubscriptionDeleted.mockResolvedValue(undefined);

      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_valid');

      expect(mockStripeService.handleSubscriptionDeleted).toHaveBeenCalledWith(subData);
    });
  });

  describe('invoice.payment_succeeded', () => {
    it('should route to handleInvoicePaid', async () => {
      const invoiceData = { id: 'in_123', amount_paid: 999 };
      mockStripeService.verifyWebhookSignature.mockReturnValue({
        type: 'invoice.payment_succeeded',
        id: 'evt_126',
        data: { object: invoiceData },
      });
      mockStripeService.handleInvoicePaid.mockResolvedValue(undefined);

      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_valid');

      expect(mockStripeService.handleInvoicePaid).toHaveBeenCalledWith(invoiceData);
    });
  });

  describe('invoice.payment_failed', () => {
    it('should route to handleInvoiceFailed', async () => {
      const invoiceData = { id: 'in_fail' };
      mockStripeService.verifyWebhookSignature.mockReturnValue({
        type: 'invoice.payment_failed',
        id: 'evt_127',
        data: { object: invoiceData },
      });
      mockStripeService.handleInvoiceFailed.mockResolvedValue(undefined);

      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_valid');

      expect(mockStripeService.handleInvoiceFailed).toHaveBeenCalledWith(invoiceData);
    });
  });

  describe('unhandled events', () => {
    it('should return 200 for unhandled event types', async () => {
      mockStripeService.verifyWebhookSignature.mockReturnValue({
        type: 'payment_method.attached',
        id: 'evt_128',
        data: { object: {} },
      });

      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_valid');

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================

  describe('error handling', () => {
    it('should return 500 when handler throws (so Stripe retries transient errors)', async () => {
      mockStripeService.verifyWebhookSignature.mockReturnValue({
        type: 'checkout.session.completed',
        id: 'evt_err',
        data: { object: {} },
      });
      mockStripeService.handleCheckoutCompleted.mockRejectedValue(
        new Error('DB connection failed'),
      );

      const req = createMockRequest('{}');
      const res = createMockResponse();

      await controller.handleStripeWebhook(req, res, 'sig_valid');

      // Should return 500 for transient errors so Stripe retries (up to ~3 days)
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Webhook processing failed' }),
      );
    });
  });
});
