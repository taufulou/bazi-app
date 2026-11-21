/**
 * 1A-core item 6 — `UsersService.endSubscriptionsForDeletedUser`, the step both
 * deletion doors (in-app `deleteAccount` and the Clerk `user.deleted` webhook)
 * now share. Design: .claude/plans/1a-core-payment-hardening.md.
 *
 * What it must guarantee, and why each test exists:
 * - Provider calls (Stripe cancel, RevenueCat delete) happen BEFORE the rows
 *   are marked ended, and never throw — the webhook anonymises after this step,
 *   so a throwing provider would leave a deleted person's name in place.
 * - Stripe semantics are UNCHANGED from the old in-app code (ACTIVE only,
 *   best-effort). Widening them is launch todo #29.
 * - Rows end as EXPIRED via a status update, never a delete (retained record),
 *   and a user's own earlier `cancelledAt` is preserved.
 */
import { UsersService } from '../src/users/users.service';

const mockStripeCancel = jest.fn();
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({ subscriptions: { cancel: mockStripeCancel } })));

const order: string[] = [];
const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  subscription: {
    findMany: jest.fn(),
    updateMany: jest.fn(async () => {
      order.push('updateMany');
      return { count: 1 };
    }),
    deleteMany: jest.fn(),
  },
  birthProfile: { findMany: jest.fn().mockResolvedValue([]) },
  baziReading: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn(async () => undefined),
};

const keys: Record<string, string | undefined> = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  RC_API_KEY: 'rc_key',
  CLERK_SECRET_KEY: undefined,
};
const mockConfig = { get: jest.fn((k: string) => keys[k]) };
const mockAi = { generateBirthDataHash: jest.fn(() => 'h') };

const fetchMock = jest.fn();

describe('UsersService.endSubscriptionsForDeletedUser (1A-core item 6)', () => {
  let svc: UsersService;
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    order.length = 0;
    svc = new UsersService(mockPrisma as never, mockConfig as never, mockAi as never);
    mockStripeCancel.mockImplementation(async () => void order.push('stripeCancel'));
    fetchMock.mockImplementation(async () => {
      order.push('rcDelete');
      return { ok: true, status: 200 };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockPrisma.subscription.findMany.mockResolvedValue([
      { status: 'ACTIVE', platform: 'STRIPE', stripeSubscriptionId: 'sub_active' },
      { status: 'PAST_DUE', platform: 'STRIPE', stripeSubscriptionId: 'sub_pastdue' },
      { status: 'EXPIRED', platform: 'STRIPE', stripeSubscriptionId: 'sub_expired' },
      { status: 'ACTIVE', platform: 'APPLE_IAP', stripeSubscriptionId: null },
    ]);
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('cancels ACTIVE Stripe subscriptions only — unchanged semantics (widening is todo #29)', async () => {
    await svc.endSubscriptionsForDeletedUser('u1', 'clerk_1');
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
    expect(mockStripeCancel).toHaveBeenCalledWith('sub_active');
  });

  it('calls the providers BEFORE ending the rows', async () => {
    await svc.endSubscriptionsForDeletedUser('u1', 'clerk_1');
    expect(order.indexOf('stripeCancel')).toBeLessThan(order.indexOf('updateMany'));
    expect(order.indexOf('rcDelete')).toBeLessThan(order.indexOf('updateMany'));
  });

  it('ends every non-EXPIRED row as EXPIRED by status update, preserving an earlier cancelledAt', async () => {
    await svc.endSubscriptionsForDeletedUser('u1', 'clerk_1');
    expect(mockPrisma.subscription.updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'u1', status: { not: 'EXPIRED' }, cancelledAt: null },
      data: { status: 'EXPIRED', cancelledAt: expect.any(Date) },
    });
    expect(mockPrisma.subscription.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'u1', status: { not: 'EXPIRED' } },
      data: { status: 'EXPIRED' },
    });
    expect(mockPrisma.subscription.deleteMany).not.toHaveBeenCalled();
  });

  it('a Stripe failure does not throw and does not stop ending the rows', async () => {
    mockStripeCancel.mockRejectedValue(new Error('stripe down'));
    await expect(svc.endSubscriptionsForDeletedUser('u1', 'clerk_1')).resolves.toBeUndefined();
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalled();
  });

  it('a RevenueCat failure does not throw and does not stop ending the rows', async () => {
    fetchMock.mockRejectedValue(new Error('rc timeout'));
    await expect(svc.endSubscriptionsForDeletedUser('u1', 'clerk_1')).resolves.toBeUndefined();
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalled();
  });

  it('deletes the RevenueCat subscriber under the REAL Clerk id, with a timeout', async () => {
    await svc.endSubscriptionsForDeletedUser('u1', 'clerk_1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.revenuecat.com/v1/subscribers/clerk_1',
      expect.objectContaining({ method: 'DELETE', signal: expect.any(AbortSignal) }),
    );
  });

  it('a database error ending the rows propagates', async () => {
    mockPrisma.subscription.updateMany.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.endSubscriptionsForDeletedUser('u1', 'clerk_1')).rejects.toThrow('db down');
  });

  describe('wired into deleteAccount', () => {
    beforeEach(() => {
      mockPrisma.user.update.mockResolvedValue({});
    });

    it('runs after the erase and before the anonymise', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', subscriptions: [] });
      mockPrisma.$transaction.mockImplementation(async () => void order.push('erase'));
      mockPrisma.user.update.mockImplementation(async () => {
        order.push('anonymise');
        return {};
      });
      const spy = jest.spyOn(svc, 'endSubscriptionsForDeletedUser');
      await svc.deleteAccount('clerk_1');
      expect(spy).toHaveBeenCalledWith('u1', 'clerk_1');
      expect(order.indexOf('erase')).toBeLessThan(order.indexOf('updateMany'));
      expect(order.indexOf('updateMany')).toBeLessThan(order.indexOf('anonymise'));
    });

    it('is NOT reached when the active-IAP guard blocks', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        subscriptions: [{ status: 'ACTIVE', platform: 'APPLE_IAP' }],
      });
      const spy = jest.spyOn(svc, 'endSubscriptionsForDeletedUser');
      await expect(svc.deleteAccount('clerk_1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ACTIVE_IAP_SUBSCRIPTION' }),
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
