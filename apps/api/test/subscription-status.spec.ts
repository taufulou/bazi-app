/**
 * 1B item 5 — `GET /api/payments/subscription` returns the Stripe row the
 * website's billing buttons act on, separately from the newest row of any
 * platform.
 */
import { PaymentsService } from '../src/payments/payments.service';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  subscription: { findFirst: jest.fn() },
};

describe('PaymentsService.getSubscriptionStatus — stripeSubscription', () => {
  let svc: PaymentsService;
  const appleRow = { planTier: 'MASTER', platform: 'APPLE_IAP', status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(), cancelledAt: null };
  const stripeRow = { ...appleRow, planTier: 'BASIC', platform: 'STRIPE' };

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PaymentsService(mockPrisma as never);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', subscriptionTier: 'MASTER', credits: 5 });
  });

  it('returns the Stripe row alongside a newer Apple row', async () => {
    // First findFirst = activeSubscription (newest any platform), second = Stripe.
    mockPrisma.subscription.findFirst.mockResolvedValueOnce(appleRow).mockResolvedValueOnce(stripeRow);
    const res = await svc.getSubscriptionStatus('clerk_1');
    expect(res.activeSubscription).toMatchObject({ platform: 'APPLE_IAP' });
    expect(res.stripeSubscription).toMatchObject({ platform: 'STRIPE', planTier: 'BASIC' });
  });

  it('queries STRIPE rows that are ACTIVE or PAST_DUE, or CANCELLED only while their period runs', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    await svc.getSubscriptionStatus('clerk_1');
    expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        platform: 'STRIPE',
        OR: [
          { status: { in: ['ACTIVE', 'PAST_DUE'] } },
          { status: 'CANCELLED', currentPeriodEnd: { gt: expect.any(Date) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('is null when there is no Stripe row', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValueOnce(appleRow).mockResolvedValueOnce(null);
    expect((await svc.getSubscriptionStatus('clerk_1')).stripeSubscription).toBeNull();
  });
});
