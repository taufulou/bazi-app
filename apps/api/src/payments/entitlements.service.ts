import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Subscription, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatPaymentService } from '../chat/chat-payment.service';
import { isUniqueConstraintViolation } from './prisma-errors';

/**
 * Provider-neutral entitlements — the SINGLE place that decides a user's
 * effective subscription tier and grants / claws back credits. Consumed by
 * BOTH {@link StripeService} and (M6) RevenueCatService.
 *
 * ## Why this exists
 * The tier was a denormalized `User.subscriptionTier` scalar that Stripe
 * handlers *blind-wrote* (created → planTier, deleted/failed → FREE). With
 * mobile IAP a user can hold a Stripe sub AND an Apple/Google sub at the same
 * time (`Subscription.userId` is NOT unique). A blind write would let a Stripe
 * cancellation wipe a still-active Apple subscription.
 *
 * The fix: recompute the effective tier from ALL active `Subscription` rows on
 * every provider event, so a single provider's change can never blind-downgrade
 * a user who still holds coverage elsewhere. FREE only results when NO active
 * subscription remains.
 *
 * ## Cross-provider rules (M6.B3)
 * - Effective tier = MAX tier across active subs.
 * - Equal-tier tiebreak = earliest `createdAt` (deterministic + IMMUTABLE) — the
 *   "governing" subscription. (Must NOT use `currentPeriodStart`: that advances
 *   on every renewal, so the governing sub would oscillate and the monthly-credit
 *   dedup below would starve both subs after the first period.)
 * - Monthly credits are granted only for the GOVERNING sub each period, so
 *   holding two equal-tier subs yields ONE grant, not two.
 * - Grace: a provider (RevenueCat BILLING_ISSUE) keeps its row `ACTIVE` until
 *   the real EXPIRATION event; because "active" here means `status === ACTIVE`,
 *   the grace period is expressed purely by NOT flipping the row's status.
 */

/** Ordinal rank of each tier for MAX / tiebreak comparisons. */
const TIER_RANK: Record<SubscriptionTier, number> = {
  FREE: 0,
  BASIC: 1,
  PRO: 2,
  MASTER: 3,
};

/** BASIC/PRO/MASTER → the `Plan.slug` used to look up `monthlyCredits`. */
const TIER_TO_PLAN_SLUG: Record<string, string> = {
  BASIC: 'basic',
  PRO: 'pro',
  MASTER: 'master',
};

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatPaymentService: ChatPaymentService,
  ) {}

  // ============================================================
  // Effective tier
  // ============================================================

  /**
   * Pick the "governing" subscription from a set of ACTIVE rows: highest tier
   * wins; equal-tier tiebreak = earliest `currentPeriodStart` (deterministic).
   * Returns null for an empty set. Pure — no I/O.
   */
  pickGoverningSubscription(activeSubs: Subscription[]): Subscription | null {
    if (activeSubs.length === 0) return null;
    return [...activeSubs].sort((a, b) => {
      const rankDiff = TIER_RANK[b.planTier] - TIER_RANK[a.planTier];
      if (rankDiff !== 0) return rankDiff; // higher tier first
      // Earlier-CREATED sub wins. createdAt is immutable; currentPeriodStart
      // advances on renewal and would make the governing sub oscillate.
      return a.createdAt.getTime() - b.createdAt.getTime();
    })[0];
  }

  /** Effective tier for a set of ACTIVE subs (FREE when none). Pure — no I/O. */
  computeEffectiveTier(activeSubs: Subscription[]): SubscriptionTier {
    const governing = this.pickGoverningSubscription(activeSubs);
    return governing ? governing.planTier : 'FREE';
  }

  /**
   * Recompute the user's effective tier from ALL active `Subscription` rows
   * (across providers), write it to `User.subscriptionTier` IF it changed, and
   * re-snapshot the chat monthly quota. Never blind-downgrades — FREE only
   * results when no active subscription remains.
   *
   * Call this AFTER upserting the provider's `Subscription` row (create /
   * status change). Chat-quota resnapshot failures are swallowed (logged) so a
   * webhook is never failed by a chat-quota hiccup.
   */
  async syncUserTier(
    userId: string,
    opts?: { skipChatResnapshot?: boolean },
  ): Promise<{ tier: SubscriptionTier; changed: boolean }> {
    const activeSubs = await this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    const effectiveTier = this.computeEffectiveTier(activeSubs);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true },
    });
    const changed = !!user && user.subscriptionTier !== effectiveTier;

    if (changed) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionTier: effectiveTier },
      });
    }

    // Re-snapshot the current-month chat quota so a tier change takes effect
    // immediately. Internally idempotent (only fires when stored tier differs).
    if (!opts?.skipChatResnapshot) {
      try {
        await this.chatPaymentService.resnapshotChatQuotaOnTierChange(userId, effectiveTier);
      } catch (err) {
        this.logger.error(`Chat-quota resnapshot failed for user ${userId}: ${err}`);
      }
    }

    this.logger.log(
      `syncUserTier user=${userId} tier=${effectiveTier} changed=${changed} activeSubs=${activeSubs.length}`,
    );
    return { tier: effectiveTier, changed };
  }

  // ============================================================
  // Monthly subscription credits
  // ============================================================

  /**
   * Grant a subscriber's monthly credits for a billing period. Idempotent via
   * the `MonthlyCreditsLog` unique `[userId, periodStart]` constraint — a
   * duplicate `[userId, periodStart]` throws Prisma P2002 and is swallowed
   * (prevents double-grant on webhook replay). Moved verbatim from
   * `StripeService.grantMonthlyCredits` so its existing tests carry over.
   *
   * NOTE: does NOT write a `CreditLedger` row (only `MonthlyCreditsLog` + the
   * `credits` increment) — this preserves the pre-M6 behavior exactly.
   */
  async grantMonthlyCredits(
    userId: string,
    planTier: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ granted: boolean; creditsGranted: number }> {
    const planSlug = TIER_TO_PLAN_SLUG[planTier];
    if (!planSlug) {
      this.logger.warn(`Unknown plan tier "${planTier}" — skipping monthly credit grant`);
      return { granted: false, creditsGranted: 0 };
    }

    const plan = await this.prisma.plan.findFirst({
      where: { slug: planSlug, isActive: true },
    });
    if (!plan) {
      this.logger.warn(`Plan "${planSlug}" not found — skipping monthly credit grant`);
      return { granted: false, creditsGranted: 0 };
    }

    const monthlyCredits = plan.monthlyCredits;
    if (monthlyCredits <= 0) {
      this.logger.log(`Plan "${planSlug}" has ${monthlyCredits} monthly credits — skipping grant`);
      return { granted: false, creditsGranted: 0 };
    }

    // $transaction for atomicity: create log + increment credits together.
    // The unique constraint [userId, periodStart] prevents double-grant.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.monthlyCreditsLog.create({
          data: { userId, creditAmount: monthlyCredits, periodStart, periodEnd },
        });
        await tx.user.update({
          where: { id: userId },
          data: { credits: { increment: monthlyCredits } },
        });
      });

      this.logger.log(
        `Granted ${monthlyCredits} monthly credits to user ${userId} for period ` +
          `${periodStart.toISOString()} — ${periodEnd.toISOString()}`,
      );
      return { granted: true, creditsGranted: monthlyCredits };
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        this.logger.log(
          `Monthly credits already granted for user ${userId}, period ` +
            `${periodStart.toISOString()} — idempotent skip`,
        );
        return { granted: false, creditsGranted: 0 };
      }
      throw error;
    }
  }

  /**
   * Cross-provider monthly-credit grant: only the GOVERNING active sub grants
   * for a period, so holding two equal-tier subs (e.g. Stripe BASIC + Apple
   * BASIC) yields ONE monthly grant, not two.
   *
   * @param subscription the sub whose creation/renewal triggered this grant.
   * @param periodOverride explicit period (a Stripe renewal reads it off the
   *   invoice line item, which can lead the sub row's `currentPeriod*`); falls
   *   back to the sub's own current period.
   */
  async grantMonthlyCreditsForSubscription(
    userId: string,
    subscription: Pick<Subscription, 'id' | 'planTier' | 'currentPeriodStart' | 'currentPeriodEnd'>,
    periodOverride?: { periodStart: Date; periodEnd: Date },
  ): Promise<{ granted: boolean; creditsGranted: number; reason?: string }> {
    const activeSubs = await this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    const governing = this.pickGoverningSubscription(activeSubs);
    if (!governing || governing.id !== subscription.id) {
      this.logger.log(
        `Skip monthly grant for user ${userId} sub ${subscription.id} — not the governing subscription`,
      );
      return { granted: false, creditsGranted: 0, reason: 'not-governing-subscription' };
    }
    const periodStart = periodOverride?.periodStart ?? subscription.currentPeriodStart;
    const periodEnd = periodOverride?.periodEnd ?? subscription.currentPeriodEnd;
    return this.grantMonthlyCredits(userId, subscription.planTier, periodStart, periodEnd);
  }

  /**
   * Grant monthly credits for the user's GOVERNING active sub, using that sub's
   * own current period. Use on INITIAL purchase (a create): grants the (possibly
   * new) governing tier's credits, idempotent via the `MonthlyCreditsLog` unique
   * key. Unlike {@link grantMonthlyCreditsForSubscription}, this does NOT take a
   * period override — a create should grant the governing sub's *current* period
   * (never a different sub's advancing period), so holding two equal-tier subs
   * can't double-grant across mismatched period keys.
   */
  async grantMonthlyCreditsForGoverningSub(
    userId: string,
  ): Promise<{ granted: boolean; creditsGranted: number; reason?: string }> {
    const activeSubs = await this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    const governing = this.pickGoverningSubscription(activeSubs);
    if (!governing) {
      return { granted: false, creditsGranted: 0, reason: 'no-active-subscription' };
    }
    return this.grantMonthlyCredits(
      userId,
      governing.planTier,
      governing.currentPeriodStart,
      governing.currentPeriodEnd,
    );
  }

  // ============================================================
  // One-off credit grants / clawbacks (IAP consumable packs)
  // ============================================================

  /**
   * Grant one-off credits (e.g. an IAP credit-pack purchase). Ledgered
   * (positive `CreditLedger` row) so a later refund has a matching negative.
   * Idempotency is the CALLER's responsibility (the RC webhook's Redis dedup) —
   * this is a raw increment.
   */
  async grantCredits(userId: string, amount: number, reason: string): Promise<void> {
    if (amount <= 0) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { credits: { increment: amount } },
      });
      await tx.creditLedger.create({ data: { userId, amount: +amount, reason } });
    });
    this.logger.log(`Granted ${amount} credits to user ${userId}: ${reason}`);
  }

  /**
   * Claw back credits (a consumable-pack refund). Floors at the user's current
   * balance so credits never go negative — if the pack was already spent, we
   * claw back only what remains. Ledgered (negative `CreditLedger` row).
   *
   * @returns { clawedBack } the amount actually removed (0 when floored).
   */
  async clawbackCredits(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<{ clawedBack: number }> {
    if (amount <= 0) return { clawedBack: 0 };
    return this.prisma.$transaction(async (tx) => {
      // Atomic non-negative decrement: GREATEST clamps at 0 within the same
      // row-locked UPDATE, so concurrent clawbacks (or a clawback racing a
      // normal spend) can never drive credits below 0. The CTE captures the
      // pre-update balance to report the amount actually removed.
      const rows = await tx.$queryRaw<Array<{ clawed_back: number }>>(Prisma.sql`
        WITH before AS (SELECT credits AS c FROM "users" WHERE id = ${userId})
        UPDATE "users" u
        SET credits = GREATEST(u.credits - ${amount}::int, 0)
        FROM before
        WHERE u.id = ${userId}
        RETURNING LEAST(${amount}::int, before.c) AS clawed_back
      `);
      const clawedBack = Number(rows[0]?.clawed_back ?? 0);
      if (clawedBack <= 0) {
        this.logger.warn(`Clawback of ${amount} for user ${userId} floored to 0: ${reason}`);
        return { clawedBack: 0 };
      }
      await tx.creditLedger.create({ data: { userId, amount: -clawedBack, reason } });
      this.logger.warn(`Clawed back ${clawedBack}/${amount} credits from user ${userId}: ${reason}`);
      return { clawedBack };
    });
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Delegates to the shared helper so P2002 detection has ONE implementation
   * across the payment services (this + RevenueCat + Stripe). Kept as a private
   * method so existing call sites read unchanged.
   */
  private isUniqueConstraintError(error: unknown): boolean {
    return isUniqueConstraintViolation(error);
  }
}
