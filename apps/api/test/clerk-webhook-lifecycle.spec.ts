import { ClerkWebhookController } from '../src/webhooks/clerk-webhook.controller';
import { SIGNUP_BONUS_LEDGER_REASON } from '../src/common/signup-bonus';

/**
 * Phase 1 gate — the Clerk webhook's two money/PII-bearing branches.
 *
 * Both were live and neither was exercised:
 *
 * - `handleUserDeleted` is the ONLY erase path for a Clerk account-portal or
 *   Dashboard deletion, and it also runs on every in-app deletion (because
 *   `deleteAccount` deletes the Clerk user). Deleting its `erasePersonalData`
 *   call left the whole suite green — the sixth instance in this project of a
 *   well-covered helper behind untested wiring. `free-spend-vectors.spec.ts`
 *   even passes a `USERS_STUB` marked *"Irrelevant to signup-bonus vectors;
 *   stubbed for arity"*, which is exactly how the gap stayed invisible.
 * - The three signup-grant sites insert credits via `user.create({ data: {
 *   credits } })`, a shape the ledger sweep's grep did not match, so every
 *   account in the system carried an unledgered 3 credits.
 *
 * Handlers are invoked directly, matching `free-spend-vectors.spec.ts` — svix
 * verification is covered by `webhook-hardening.spec.ts` and is not the subject
 * here. For the retry semantics the assertion is that the handler REJECTS,
 * which is precisely what makes the dispatcher return 500 rather than 200.
 */

type AnyFn = jest.Mock;
const CLERK = 'clerk_user_x';

/** Prisma's unique-constraint violation, as the client actually shapes it. */
function p2002() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: ['clerk_user_id'] },
  });
}

function makeController(opts?: {
  priorDeletedRow?: boolean;
  existingUser?: { id: string } | null;
  eraseImpl?: AnyFn;
  ledgerImpl?: AnyFn;
  createImpl?: AnyFn;
}) {
  const ledgerCreate: AnyFn = opts?.ledgerImpl ?? jest.fn().mockResolvedValue({});
  const prisma = {
    user: {
      // `resolveSignupCredits`: a prior `deleted_…` row means 0 credits.
      findFirst: jest.fn().mockResolvedValue(opts?.priorDeletedRow ? { id: 'old' } : null),
      findUnique: jest
        .fn()
        .mockResolvedValue(opts?.existingUser === undefined ? { id: 'user-1' } : opts.existingUser),
      create: opts?.createImpl ?? jest.fn().mockResolvedValue({ id: 'user-new' }),
      upsert: jest.fn().mockResolvedValue({ id: 'user-up' }),
      update: jest.fn().mockResolvedValue({}),
    },
    creditLedger: { create: ledgerCreate },
  };
  const usersService = {
    erasePersonalData: opts?.eraseImpl ?? jest.fn().mockResolvedValue(undefined),
  };
  const redis = { del: jest.fn().mockResolvedValue(1) };

  const controller = new ClerkWebhookController(
    prisma as never,
    redis as never,
    { get: jest.fn() } as never,
    usersService as never,
  );
  return { controller, prisma, usersService, redis, ledgerCreate };
}

/** The handlers are private; this mirrors `free-spend-vectors.spec.ts`. */
function call(controller: ClerkWebhookController, handler: string, data: unknown) {
  return (controller as unknown as Record<string, (d: unknown) => Promise<void>>)[handler](data);
}

const EVENT = { id: CLERK, first_name: 'A', last_name: 'B', image_url: null };

describe('Clerk webhook — the signup bonus is ledgered', () => {
  it('handleUserCreated writes a CreditLedger row for the granted bonus', async () => {
    const { controller, ledgerCreate } = makeController();
    await call(controller, 'handleUserCreated', EVENT);

    expect(ledgerCreate).toHaveBeenCalledWith({
      data: { userId: 'user-new', amount: 3, reason: SIGNUP_BONUS_LEDGER_REASON },
    });
  });

  it('grants nothing and ledgers nothing for a returning identity', async () => {
    // A ledger row here would invent a grant that never happened, which is
    // worse than the missing row it replaces.
    const { controller, ledgerCreate } = makeController({ priorDeletedRow: true });
    await call(controller, 'handleUserCreated', EVENT);

    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('handleUserUpdated ledgers only when it actually INSERTS', async () => {
    const { controller, ledgerCreate, prisma } = makeController({ existingUser: null });
    await call(controller, 'handleUserUpdated', EVENT);

    expect(prisma.user.create).toHaveBeenCalled();
    expect(ledgerCreate).toHaveBeenCalledWith({
      data: { userId: 'user-new', amount: 3, reason: SIGNUP_BONUS_LEDGER_REASON },
    });
  });

  it('handleUserUpdated does NOT ledger when the row already exists', async () => {
    // The update branch leaves `credits` untouched; ledgering unconditionally
    // would mint a phantom 3 on every profile edit.
    const { controller, ledgerCreate, prisma } = makeController({
      existingUser: { id: 'user-existing' },
    });
    await call(controller, 'handleUserUpdated', EVENT);

    expect(ledgerCreate).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { clerkUserId: CLERK },
      data: { name: 'A B', avatarUrl: null },
    });
  });

  describe('the insert race — two handlers, one identity', () => {
    /**
     * Clerk fires `user.created` and `user.updated` for a brand-new identity
     * close enough together that they overlap, and NestJS serves them
     * concurrently (svix is signature verification, not deduplication).
     *
     * Every insert site used to answer "am I the one inserting?" with a read
     * taken one round-trip before the write. These pin the answer to the
     * database instead. Each test fails if its try/catch is removed.
     */

    it('handleUserUpdated does NOT double-ledger when it loses the race', async () => {
      // THE BUG: the `existing` read returns null, so the old code took the
      // grant branch; the atomic upsert then resolved to UPDATE. Credits stayed
      // correct at 3 while a SECOND signup_bonus row was written, so
      // sum(CreditLedger.amount) != User.credits for that account.
      const { controller, ledgerCreate, prisma } = makeController({
        existingUser: null,
        createImpl: jest.fn().mockRejectedValue(p2002()),
      });

      await expect(call(controller, 'handleUserUpdated', EVENT)).resolves.toBeUndefined();

      expect(ledgerCreate).not.toHaveBeenCalled();
      // and it still does the thing the event was actually about
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { clerkUserId: CLERK },
        data: { name: 'A B', avatarUrl: null },
      });
    });

    it('handleUserCreated swallows the lost race instead of 500ing forever', async () => {
      // Not merely transient: Clerk's retry collides with the same row, so an
      // unhandled P2002 here fails this webhook permanently.
      const { controller, ledgerCreate } = makeController({
        createImpl: jest.fn().mockRejectedValue(p2002()),
      });

      await expect(call(controller, 'handleUserCreated', EVENT)).resolves.toBeUndefined();
      expect(ledgerCreate).not.toHaveBeenCalled();
    });

    it('still surfaces a create failure that is NOT a unique violation', async () => {
      // The catch must not become a blanket swallow — a dead database has to
      // keep reaching Clerk as a 500 so the event is retried.
      const { controller } = makeController({
        createImpl: jest.fn().mockRejectedValue(new Error('connection refused')),
      });

      await expect(call(controller, 'handleUserCreated', EVENT)).rejects.toThrow(
        'connection refused',
      );
    });
  });

  it('a ledger failure never costs a real user their signup', async () => {
    const ledger = jest.fn().mockRejectedValue(new Error('ledger down'));
    const { controller, prisma } = makeController({ ledgerImpl: ledger });

    await expect(call(controller, 'handleUserCreated', EVENT)).resolves.toBeUndefined();
    expect(prisma.user.create).toHaveBeenCalled();
  });
});

describe('Clerk webhook — user.deleted erases personal data', () => {
  it('calls erasePersonalData for the matched user', async () => {
    // The wiring assertion that did not exist. Deleting the call from the
    // controller was green across the entire suite.
    const { controller, usersService } = makeController();
    await call(controller, 'handleUserDeleted', EVENT);

    expect(usersService.erasePersonalData).toHaveBeenCalledWith('user-1');
  });

  it('erases BEFORE anonymizing', async () => {
    // Anonymizing first would rename `clerkUserId`, so a later retry could no
    // longer find the row to erase.
    const order: string[] = [];
    const erase = jest.fn().mockImplementation(async () => void order.push('erase'));
    const { controller, prisma } = makeController({ eraseImpl: erase });
    (prisma.user.update as AnyFn).mockImplementation(async () => {
      order.push('anonymize');
      return {};
    });

    await call(controller, 'handleUserDeleted', EVENT);

    expect(order).toEqual(['erase', 'anonymize']);
  });

  it('REJECTS when the erase fails, so the dispatcher 500s and Clerk retries', async () => {
    // The old code caught this, logged "User not found for deletion" — a cause
    // that was not the cause — and returned 200, so the delivery was never
    // retried and the personal data stayed. A 30s transaction timeout on a
    // heavy account is the realistic trigger.
    const erase = jest.fn().mockRejectedValue(new Error('transaction timeout'));
    const { controller, prisma } = makeController({ eraseImpl: erase });

    await expect(call(controller, 'handleUserDeleted', EVENT)).rejects.toThrow(
      'transaction timeout',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('REJECTS when the anonymize fails', async () => {
    const { controller, prisma } = makeController();
    (prisma.user.update as AnyFn).mockRejectedValue(new Error('db down'));

    await expect(call(controller, 'handleUserDeleted', EVENT)).rejects.toThrow('db down');
  });

  it('resolves without erasing when no local user exists', async () => {
    // The genuinely benign case — including redelivery after `deleteAccount`
    // already renamed `clerkUserId`. Must NOT reject, or Clerk retries forever.
    const { controller, usersService, prisma } = makeController({ existingUser: null });

    await expect(call(controller, 'handleUserDeleted', EVENT)).resolves.toBeUndefined();
    expect(usersService.erasePersonalData).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a cache-invalidation failure does not fail the deletion', async () => {
    // A stale admin-role entry is a 5-minute annoyance; retrying a deletion that
    // already succeeded is worse.
    const { controller, redis, usersService } = makeController();
    (redis.del as AnyFn).mockRejectedValue(new Error('redis down'));

    await expect(call(controller, 'handleUserDeleted', EVENT)).resolves.toBeUndefined();
    expect(usersService.erasePersonalData).toHaveBeenCalled();
  });
});
