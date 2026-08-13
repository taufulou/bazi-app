/**
 * Signup-bonus resolution (F1).
 *
 * THE BUG THIS EXISTS TO CLOSE
 * `deleteAccount` does not delete the user row — it anonymizes it and renames
 * `clerkUserId` to `deleted_<originalClerkUserId>_<timestamp>` (financial
 * records must survive). That frees the original id, so the SAME Clerk identity
 * can be inserted again as a brand-new user.
 *
 * Three call sites grant the 3-credit bonus on insert — `ensureUser`'s
 * auto-create fallback and both `create` branches in the Clerk webhook — so any
 * of them re-mints the bonus for a returning identity. It is loopable whenever
 * the Clerk-side delete does not take effect: `deleteClerkUser` is best-effort
 * (it swallows API errors and returns early when `CLERK_SECRET_KEY` is unset),
 * so the Clerk identity can outlive the DB row, re-authenticate, and mint 3
 * more credits — repeatedly.
 *
 * THE FIX
 * Grant the bonus only to an identity with no prior (soft-deleted) account.
 * This is deliberately narrow: it does NOT try to stop signup-bonus farming via
 * fresh throwaway signups, which is a different problem (every new Clerk id is
 * legitimately new) and is bounded by the AI spend controls in Phase 2.
 *
 * Not a schema change on purpose — the `deleted_<id>_<ts>` naming already
 * carries the fact we need, and a migration is a heavier lever than this
 * warrants pre-launch. If a `deletedAt` column is ever added, switch the lookup
 * to it and delete the prefix matching.
 */
import { Logger } from '@nestjs/common';

/** Credits granted to a genuinely new account. Mirrored at all insert sites. */
export const SIGNUP_BONUS_CREDITS = 3;

/** Prefix a soft-deleted row's `clerkUserId` is rewritten to. Keep in sync with `deleteAccount`. */
export const DELETED_USER_PREFIX = 'deleted_';

const logger = new Logger('SignupBonus');

/**
 * Minimal structural type — avoids importing PrismaService here so the Clerk
 * webhook controller (which injects PrismaService directly) and UsersService
 * can both call this without new DI wiring.
 */
interface UserFinder {
  user: {
    findFirst(args: {
      where: { clerkUserId: { startsWith: string } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

/**
 * How many credits a newly-inserted row for `clerkUserId` should start with.
 *
 * Returns 0 when this Clerk identity previously had an account that was
 * deleted, so the bonus is granted once per identity rather than once per
 * insert. Fails OPEN (grants the bonus) if the lookup throws — a database
 * hiccup should not silently deny a real new user their signup credits, and the
 * downside is bounded at 3 credits.
 */
export async function resolveSignupCredits(
  prisma: UserFinder,
  clerkUserId: string,
): Promise<number> {
  try {
    const priorDeleted = await prisma.user.findFirst({
      // `deleteAccount` writes `deleted_${clerkUserId}_${Date.now()}`, so the
      // trailing separator narrows the match to this id rather than any longer
      // id that merely starts with it.
      //
      // ⚠️ It NARROWS, it does not anchor. Prisma compiles `startsWith` to
      // `LIKE 'pattern%'` without escaping LIKE metacharacters, and `_` is
      // LIKE's single-character wildcard — so `deleted_user_ab_%` would also
      // match `deleted_user_abc1_…`. Inert in practice: Clerk ids are
      // fixed-length, so one is never a strict prefix of another, and the
      // failure direction is WITHHOLDING 3 credits from a stranger, never
      // minting them. Escape the pattern if ids ever become variable-length.
      where: { clerkUserId: { startsWith: `${DELETED_USER_PREFIX}${clerkUserId}_` } },
      select: { id: true },
    });

    if (priorDeleted) {
      logger.warn(
        `Signup bonus WITHHELD for ${clerkUserId} — identity has a prior deleted account ` +
        `(${priorDeleted.id}). Re-creation after deletion must not re-mint credits.`,
      );
      return 0;
    }
    return SIGNUP_BONUS_CREDITS;
  } catch (err) {
    logger.error(
      `Signup-bonus lookup failed for ${clerkUserId}; granting the default to avoid ` +
      `denying a real new user: ${err}`,
    );
    return SIGNUP_BONUS_CREDITS;
  }
}
