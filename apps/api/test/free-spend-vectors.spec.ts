/**
 * A4 + F1 (Phase 1A) — free-spend vectors.
 *
 * A4a: birth profiles are the multiplier on free AI generation (the fortune
 * free tier is scoped per profile per day), so an uncapped account can mint one
 * free narration per profile per day.
 *
 * F1: `deleteAccount` anonymizes rather than deletes, renaming `clerkUserId` to
 * `deleted_<id>_<ts>` — which frees the original id. All three insert sites
 * (ensureUser's fallback + both Clerk-webhook create branches) then re-mint the
 * 3-credit signup bonus for a returning identity. Loopable whenever the
 * Clerk-side delete doesn't take effect, and `deleteClerkUser` is best-effort:
 * it swallows API errors and returns early when CLERK_SECRET_KEY is unset.
 */
import { BadRequestException } from '@nestjs/common';
import { UsersService } from '../src/users/users.service';
import { ClerkWebhookController } from '../src/webhooks/clerk-webhook.controller';
import {
  resolveSignupCredits,
  SIGNUP_BONUS_CREDITS,
} from '../src/common/signup-bonus';

const CLERK = 'user_clerk_abc';
const USER_ID = 'db-uuid-1';

// ============================================================
// A4a — birth-profile cap
// ============================================================

function makeUsersService(profileCount: number, cap?: string) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: USER_ID }),
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    birthProfile: {
      count: jest.fn().mockResolvedValue(profileCount),
      create: jest.fn().mockResolvedValue({ id: 'bp-new' }),
      updateMany: jest.fn(),
    },
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'BIRTH_PROFILE_MAX_PER_USER' ? cap : undefined,
    ),
  };
  const service = new UsersService(prisma as never, config as never, AI_STUB as never);
  return { service, prisma };
}

const DTO = {
  name: 'Test',
  birthDate: '1990-01-01',
  birthTime: '12:00',
  birthCity: '台北',
  birthTimezone: 'Asia/Taipei',
  gender: 'MALE',
} as never;

// C1 — UsersService injects AIService only to reuse its cache-key hash on
// account deletion. Irrelevant to these tests; stubbed so the arity matches.
const USERS_STUB = { erasePersonalData: jest.fn() };
const AI_STUB = { generateBirthDataHash: jest.fn(() => 'hash') };

describe('A4a — birth-profile cap', () => {
  it('allows creation below the default cap of 10', async () => {
    const { service, prisma } = makeUsersService(9);
    await service.createBirthProfile(CLERK, DTO);
    expect(prisma.birthProfile.create).toHaveBeenCalled();
  });

  it('rejects at the cap with BIRTH_PROFILE_LIMIT_REACHED', async () => {
    const { service, prisma } = makeUsersService(10);

    await expect(service.createBirthProfile(CLERK, DTO)).rejects.toMatchObject({
      response: { code: 'BIRTH_PROFILE_LIMIT_REACHED' },
    });
    expect(prisma.birthProfile.create).not.toHaveBeenCalled();
  });

  it('rejects above the cap too (defensive — pre-existing over-limit accounts)', async () => {
    const { service } = makeUsersService(47);
    await expect(service.createBirthProfile(CLERK, DTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('honours BIRTH_PROFILE_MAX_PER_USER when set', async () => {
    const { service } = makeUsersService(3, '3');
    await expect(service.createBirthProfile(CLERK, DTO)).rejects.toThrow();

    const { service: s2, prisma: p2 } = makeUsersService(3, '25');
    await s2.createBirthProfile(CLERK, DTO);
    expect(p2.birthProfile.create).toHaveBeenCalled();
  });

  it('falls back to 10 when the env value is junk rather than disabling the cap', async () => {
    // A NaN/negative must not read as "unlimited" — that would silently remove
    // the control the moment someone typos the env var.
    for (const junk of ['abc', '', '-5', '0']) {
      const { service } = makeUsersService(10, junk);
      await expect(service.createBirthProfile(CLERK, DTO)).rejects.toThrow();
    }
  });
});

// ============================================================
// F1 — signup bonus is granted once per identity
// ============================================================

function makeFinder(priorDeleted: { id: string } | null, throws = false) {
  return {
    user: {
      findFirst: jest.fn(async () => {
        if (throws) throw new Error('db down');
        return priorDeleted;
      }),
    },
  };
}

describe('F1 — signup bonus is once per identity, not once per insert', () => {
  it('grants the full bonus to a genuinely new identity', async () => {
    const finder = makeFinder(null);
    await expect(resolveSignupCredits(finder, CLERK)).resolves.toBe(SIGNUP_BONUS_CREDITS);
  });

  it('grants ZERO when the identity has a prior deleted account', async () => {
    const finder = makeFinder({ id: 'old-row' });
    await expect(resolveSignupCredits(finder, CLERK)).resolves.toBe(0);
  });

  it('narrows the prefix match with a trailing separator', async () => {
    // deleteAccount writes `deleted_${clerkUserId}_${Date.now()}`. Without the
    // trailing separator, clerkUserId "user_ab" would match a deleted row for
    // "user_abc" and wrongly deny a different user their bonus.
    //
    // Asserts the QUERY SHAPE only. It cannot prove exclusion: Prisma compiles
    // startsWith to LIKE without escaping, and `_` is a LIKE wildcard, so the
    // separator narrows rather than anchors. See the note in signup-bonus.ts.
    const finder = makeFinder(null);
    await resolveSignupCredits(finder, 'user_ab');
    expect(finder.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clerkUserId: { startsWith: 'deleted_user_ab_' } },
      }),
    );
  });

  it('FAILS OPEN if the lookup throws — a db hiccup must not deny a real signup', async () => {
    const finder = makeFinder(null, true);
    await expect(resolveSignupCredits(finder, CLERK)).resolves.toBe(SIGNUP_BONUS_CREDITS);
  });

  it('BOTH Clerk-webhook insert sites use the resolved amount, not a hardcoded 3', async () => {
    // These two were completely uncovered: reverting both to `credits: 3`
    // passed the entire suite. The F1 write-up stresses there are THREE insert
    // sites precisely because the obvious one is not the whole loop — a test
    // that only pins `ensureUser` leaves 2 of 3 re-openable.
    for (const handler of ['handleUserCreated', 'handleUserUpdated'] as const) {
      const prisma = {
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'prior-deleted-row' }),
          create: jest.fn().mockResolvedValue({}),
          upsert: jest.fn().mockResolvedValue({}),
        },
      };
      const controller = new ClerkWebhookController(
        prisma as never,
        { del: jest.fn() } as never,
        { get: jest.fn() } as never,
        // C1 — the user.deleted handler now erases PII via UsersService.
        // Irrelevant to signup-bonus vectors; stubbed for arity.
        USERS_STUB as never,
      );

      await (
        controller as unknown as Record<string, (d: unknown) => Promise<void>>
      )[handler]({ id: CLERK, first_name: 'A', last_name: 'B', image_url: null });

      // handleUserCreated → create({data}); handleUserUpdated → upsert({create}).
      const written = prisma.user.create.mock.calls.length
        ? prisma.user.create.mock.calls[0][0].data
        : prisma.user.upsert.mock.calls[0][0].create;

      expect(written.credits).toBe(0);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clerkUserId: { startsWith: `deleted_${CLERK}_` } },
        }),
      );
    }
  });

  it('both webhook sites still grant the full bonus to a genuinely new identity', async () => {
    // The other direction: the fix must not deny a real signup.
    for (const handler of ['handleUserCreated', 'handleUserUpdated'] as const) {
      const prisma = {
        user: {
          findFirst: jest.fn().mockResolvedValue(null), // no prior deletion
          create: jest.fn().mockResolvedValue({}),
          upsert: jest.fn().mockResolvedValue({}),
        },
      };
      const controller = new ClerkWebhookController(
        prisma as never,
        { del: jest.fn() } as never,
        { get: jest.fn() } as never,
        // C1 — the user.deleted handler now erases PII via UsersService.
        // Irrelevant to signup-bonus vectors; stubbed for arity.
        USERS_STUB as never,
      );

      await (
        controller as unknown as Record<string, (d: unknown) => Promise<void>>
      )[handler]({ id: CLERK, first_name: 'A', last_name: 'B', image_url: null });

      const written = prisma.user.create.mock.calls.length
        ? prisma.user.create.mock.calls[0][0].data
        : prisma.user.upsert.mock.calls[0][0].create;

      expect(written.credits).toBe(SIGNUP_BONUS_CREDITS);
    }
  });

  it('ensureUser auto-create uses the resolved amount, not a hardcoded 3', async () => {
    // The loop this closes: delete (row renamed, Clerk delete fails) →
    // re-authenticate → ensureUser auto-creates → +3 → repeat.
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'deleted-row' }), // prior deletion
        create: jest.fn().mockResolvedValue({ id: USER_ID, credits: 0 }),
      },
      birthProfile: { count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    };
    const service = new UsersService(prisma as never, { get: jest.fn() } as never, AI_STUB as never);

    // createBirthProfile goes through ensureUser; the cap check runs after and
    // is irrelevant here (count is a jest.fn() returning undefined).
    await service.createBirthProfile(CLERK, DTO).catch(() => undefined);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ credits: 0 }) }),
    );
  });
});
