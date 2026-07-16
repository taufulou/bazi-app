/**
 * Tests for RevenueCatWebhookController — bearer auth, missing-event guard,
 * Redis replay-idempotency, dispatch, and the 500-on-handler-throw retry path.
 */
import { RevenueCatWebhookController } from '../src/webhooks/revenuecat-webhook.controller';

const mockService = { verifyAuthHeader: jest.fn(), handleEvent: jest.fn() };
const mockRedis = { get: jest.fn(), set: jest.fn() };

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const event = { id: 'evt_1', type: 'INITIAL_PURCHASE', app_user_id: 'clerk_1' };

describe('RevenueCatWebhookController', () => {
  let controller: RevenueCatWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RevenueCatWebhookController(mockService as any, mockRedis as any);
    mockService.verifyAuthHeader.mockReturnValue(true);
    mockRedis.get.mockResolvedValue(null);
  });

  it('rejects a bad Authorization with 401', async () => {
    mockService.verifyAuthHeader.mockReturnValue(false);
    const res = makeRes();
    await controller.handleRevenueCatWebhook({} as any, res, 'Bearer nope', { event } as any);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockService.handleEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing event payload with 400', async () => {
    const res = makeRes();
    await controller.handleRevenueCatWebhook({} as any, res, 'Bearer rc-secret', {} as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('skips an already-processed event (idempotency)', async () => {
    mockRedis.get.mockResolvedValue('1');
    const res = makeRes();
    await controller.handleRevenueCatWebhook({} as any, res, 'Bearer rc-secret', { event } as any);
    expect(mockService.handleEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('dispatches + marks processed on the happy path', async () => {
    const res = makeRes();
    await controller.handleRevenueCatWebhook({} as any, res, 'Bearer rc-secret', { event } as any);
    expect(mockService.handleEvent).toHaveBeenCalledWith(event);
    expect(mockRedis.set).toHaveBeenCalledWith('rc:event:evt_1', '1', 172800);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 (and does NOT mark processed) when the handler throws', async () => {
    mockService.handleEvent.mockRejectedValue(new Error('boom'));
    const res = makeRes();
    await controller.handleRevenueCatWebhook({} as any, res, 'Bearer rc-secret', { event } as any);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
