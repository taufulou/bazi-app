/**
 * `UsersService.deleteAccount` — the Apple 5.1.1(v) account-deletion path, and
 * (C1) whether it actually deletes anything.
 *
 * It did not. The method anonymized the `User` row and stopped, reasoning that
 * deleting the row would take the financial records with it — every money table
 * is `onDelete: Cascade` from User. The instinct was right and the execution
 * inverted it: because NO row was ever deleted, NONE of the declared cascades
 * fired. "Delete my account" left behind every birth profile (date, time, city,
 * coordinates, gender), every reading, every comparison, every chat message the
 * user typed, and every fortune snapshot.
 *
 * Third-party calls (Stripe cancel / Clerk delete / RC delete) are skipped when
 * their config keys are unset, so they don't run here.
 */
import { UsersService } from '../src/users/users.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

/** Every delete, in the order it happened — the SetNull trap is an ORDER bug. */
let deleteOrder: string[] = [];

function deleter(table: string) {
  return jest.fn((args: unknown) => {
    deleteOrder.push(table);
    return Promise.resolve({ count: 1, args });
  });
}

const tx = {
  dailyFortuneSnapshot: { deleteMany: deleter('dailyFortuneSnapshot') },
  chatSession: { deleteMany: deleter('chatSession') },
  chatMonthlyUsage: { deleteMany: deleter('chatMonthlyUsage') },
  baziComparison: { deleteMany: deleter('baziComparison') },
  baziReading: { deleteMany: deleter('baziReading') },
  birthProfile: { deleteMany: deleter('birthProfile') },
  readingCache: { deleteMany: deleter('readingCache') },
  // Present but must NEVER be called — the financial record is retained.
  transaction: { deleteMany: deleter('transaction') },
  subscription: { deleteMany: deleter('subscription') },
  creditLedger: { deleteMany: deleter('creditLedger') },
  monthlyCreditsLog: { deleteMany: deleter('monthlyCreditsLog') },
  adRewardLog: { deleteMany: deleter('adRewardLog') },
  sectionUnlock: { deleteMany: deleter('sectionUnlock') },
  user: { delete: deleter('user'), update: jest.fn() },
};

const PROFILE = {
  id: 'profile-1',
  birthDate: new Date('1987-09-06T00:00:00.000Z'),
  birthTime: '16:11',
  birthCity: '吉打',
  gender: 'MALE',
};

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  birthProfile: { findMany: jest.fn() },
  baziReading: { findMany: jest.fn() },
  $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
};

const mockConfig = { get: jest.fn().mockReturnValue(undefined) };
const mockAi = { generateBirthDataHash: jest.fn(() => 'hash_abc') };

describe('UsersService.deleteAccount', () => {
  let svc: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    deleteOrder = [];
    svc = new UsersService(mockPrisma as any, mockConfig as any, mockAi as any);
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.birthProfile.findMany.mockResolvedValue([PROFILE]);
    mockPrisma.baziReading.findMany.mockResolvedValue([
      { readingType: 'LIFETIME', targetYear: null, birthProfileId: PROFILE.id },
    ]);
  });

  // ============================================================
  // Existing behaviour — the IAP guard
  // ============================================================

  it('throws NotFound when the user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.deleteAccount('clerk_x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('BLOCKS with ACTIVE_IAP_SUBSCRIPTION when an active IAP sub exists + not acknowledged', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      subscriptions: [{ status: 'ACTIVE', platform: 'APPLE_IAP' }],
    });

    await expect(svc.deleteAccount('clerk_x')).rejects.toBeInstanceOf(ForbiddenException);
    // And erases nothing — a blocked deletion must not be a partial deletion.
    expect(deleteOrder).toEqual([]);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('proceeds when the IAP cancellation is acknowledged', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      subscriptions: [{ status: 'ACTIVE', platform: 'APPLE_IAP' }],
    });

    await expect(
      svc.deleteAccount('clerk_x', { acknowledgedIapCancellation: true }),
    ).resolves.toEqual({ deleted: true });
  });

  it('does not treat a cancelled IAP sub as active', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      subscriptions: [{ status: 'CANCELLED', platform: 'APPLE_IAP' }],
    });

    await expect(svc.deleteAccount('clerk_x')).resolves.toEqual({ deleted: true });
  });

  // ============================================================
  // C1 — erasure
  // ============================================================

  describe('C1 — personal data is actually erased', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', subscriptions: [] });
    });

    it.each([
      ['birth profiles — the birth date, time, city, coordinates, gender', 'birthProfile'],
      ['readings', 'baziReading'],
      ['comparisons', 'baziComparison'],
      ['chat sessions (cascading to the messages the user typed)', 'chatSession'],
      ['chat usage counters', 'chatMonthlyUsage'],
      ['fortune snapshots', 'dailyFortuneSnapshot'],
      ['cached copies of their readings', 'readingCache'],
    ])('deletes %s', async (_label, table) => {
      await svc.deleteAccount('clerk_x');
      expect(deleteOrder).toContain(table);
    });

    it('deletes fortune snapshots BEFORE profiles', async () => {
      // `DailyFortuneSnapshot.birthProfileId` is SetNull, not Cascade. Delete
      // the profiles first and the snapshots are ORPHANED, not removed —
      // narrative text plus a chartHash, with nothing left to attribute them to
      // and no way to find them again.
      await svc.deleteAccount('clerk_x');

      expect(deleteOrder.indexOf('dailyFortuneSnapshot')).toBeGreaterThanOrEqual(0);
      expect(deleteOrder.indexOf('dailyFortuneSnapshot')).toBeLessThan(
        deleteOrder.indexOf('birthProfile'),
      );
    });

    it('scopes every delete to this user', async () => {
      await svc.deleteAccount('clerk_x');

      for (const table of ['chatSession', 'chatMonthlyUsage', 'baziComparison', 'baziReading', 'birthProfile'] as const) {
        expect(tx[table].deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      }
    });

    it('purges the cache with the AI service’s OWN hash, not a copy', async () => {
      // A re-implemented hash that drifts by one character silently stops
      // matching, and deletion would report success while the cached readings
      // stayed put.
      await svc.deleteAccount('clerk_x');

      expect(mockAi.generateBirthDataHash).toHaveBeenCalledWith(
        '1987-09-06',
        '16:11',
        '吉打',
        'male',
        'LIFETIME',
        undefined,
      );
      expect(tx.readingCache.deleteMany).toHaveBeenCalledWith({
        where: { birthDataHash: { in: ['hash_abc'] } },
      });
    });

    it('uses the HOUR_UNKNOWN sentinel so 時辰未知 cache rows still match', async () => {
      mockPrisma.birthProfile.findMany.mockResolvedValue([{ ...PROFILE, birthTime: null }]);

      await svc.deleteAccount('clerk_x');

      expect(mockAi.generateBirthDataHash).toHaveBeenCalledWith(
        expect.any(String),
        'HOUR_UNKNOWN',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it.each([
      'transaction',
      'subscription',
      'creditLedger',
      'monthlyCreditsLog',
      'adRewardLog',
      'sectionUnlock',
    ])('RETAINS %s — money and entitlement history', async (table) => {
      await svc.deleteAccount('clerk_x');
      expect(deleteOrder).not.toContain(table);
    });

    it('never deletes the User row itself — that would cascade the financials away', async () => {
      await svc.deleteAccount('clerk_x');
      expect(deleteOrder).not.toContain('user');
    });

    it('anonymizes the retained row, including the device fingerprint', async () => {
      await svc.deleteAccount('clerk_x');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          name: '[deleted]',
          avatarUrl: null,
          credits: 0,
          subscriptionTier: 'FREE',
          // An identifier in its own right — it exists to link anonymous
          // sessions to a person, and has no financial purpose.
          deviceFingerprint: null,
        }),
      });
    });

    it('erases inside ONE transaction — a partial erasure is the worst outcome', async () => {
      await svc.deleteAccount('clerk_x');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('handles an account with no profiles and no readings', async () => {
      mockPrisma.birthProfile.findMany.mockResolvedValue([]);
      mockPrisma.baziReading.findMany.mockResolvedValue([]);

      await expect(svc.deleteAccount('clerk_x')).resolves.toEqual({ deleted: true });
      // No profile ids ⇒ nothing to scope those two by, so they are skipped
      // rather than issued with an empty `in` list.
      expect(deleteOrder).not.toContain('dailyFortuneSnapshot');
      expect(deleteOrder).not.toContain('readingCache');
      // …but the user-scoped deletes still run.
      expect(deleteOrder).toContain('birthProfile');
    });

    it('skips cache rows for a reading whose profile is already gone', async () => {
      mockPrisma.baziReading.findMany.mockResolvedValue([
        { readingType: 'LIFETIME', targetYear: null, birthProfileId: 'missing-profile' },
      ]);

      await svc.deleteAccount('clerk_x');

      expect(mockAi.generateBirthDataHash).not.toHaveBeenCalled();
      expect(deleteOrder).not.toContain('readingCache');
    });
  });
});
