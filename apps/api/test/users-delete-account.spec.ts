/**
 * Tests for UsersService.deleteAccount — the Apple 5.1.1(v) account-deletion
 * path. Focuses on the active-IAP guard + the anonymize. Third-party calls
 * (Stripe cancel / Clerk delete / RC delete) are skipped when their config keys
 * are unset, so they don't run here.
 */
import { UsersService } from '../src/users/users.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
};

// Config with no third-party keys → deleteAccount skips Stripe/Clerk/RC calls.
const mockConfig = { get: jest.fn().mockReturnValue(undefined) };

describe('UsersService.deleteAccount', () => {
  let svc: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new UsersService(mockPrisma as any, mockConfig as any);
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('throws NotFound when the user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.deleteAccount('clerk_x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('BLOCKS with ACTIVE_IAP_SUBSCRIPTION when an active IAP sub exists + not acknowledged', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      subscriptions: [{ status: 'ACTIVE', platform: 'APPLE_IAP', stripeSubscriptionId: null }],
    });
    await expect(svc.deleteAccount('clerk_1')).rejects.toMatchObject({
      response: { code: 'ACTIVE_IAP_SUBSCRIPTION', platforms: ['APPLE_IAP'] },
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('proceeds + anonymizes when the IAP cancellation is acknowledged', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      subscriptions: [{ status: 'ACTIVE', platform: 'APPLE_IAP', stripeSubscriptionId: null }],
    });
    const res = await svc.deleteAccount('clerk_1', { acknowledgedIapCancellation: true });
    expect(res).toEqual({ deleted: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ name: '[deleted]', credits: 0, subscriptionTier: 'FREE' }),
      }),
    );
  });

  it('anonymizes directly when there are no active IAP subs', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', subscriptions: [] });
    const res = await svc.deleteAccount('clerk_1');
    expect(res).toEqual({ deleted: true });
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect(arg.data.clerkUserId).toMatch(/^deleted_clerk_1_/);
  });

  it('does not treat a cancelled IAP sub as active (allows deletion)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      subscriptions: [{ status: 'EXPIRED', platform: 'APPLE_IAP', stripeSubscriptionId: null }],
    });
    await expect(svc.deleteAccount('clerk_1')).resolves.toEqual({ deleted: true });
  });
});
