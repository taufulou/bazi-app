import { timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PaymentPlatform, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from './entitlements.service';
import { isUniqueConstraintViolation } from './prisma-errors';
import { revenueCatEnvironment } from './payment-environment';
import { RevenueCatEventNotProcessableError } from './revenuecat-errors';
import { findDeletedUserForClerkId } from '../common/signup-bonus';

/**
 * RevenueCat (mobile IAP) webhook service — the Apple/Google counterpart to
 * StripeService. Both consume the provider-neutral {@link EntitlementsService},
 * so a user's effective tier is recomputed from ALL active subscription rows
 * across providers (never blind-downgraded).
 *
 * ## Tier source of truth
 * The subscription TIER comes from the purchased PRODUCT → our `Plan`
 * (via `Plan.appleProductId` / `Plan.googleProductId`), NOT from the event
 * TYPE. The event type only decides the ACTION (activate / renew / expire /
 * refund). This mirrors RC's guidance to key entitlements off the payload's
 * product/entitlement, not hand-mapped event types.
 *
 * ## Grace (BILLING_ISSUE)
 * A billing issue does NOT flip the row out of ACTIVE — the tier persists
 * until the real EXPIRATION event (per RC's grace-period model). Because
 * `EntitlementsService` treats "active" as `status === ACTIVE`, the grace is
 * expressed purely by leaving the row ACTIVE.
 */

/** RevenueCat webhook v1 event (only the fields we consume). */
export interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id: string;
  /** RC aliases (e.g. after a TRANSFER / anonymous merge). */
  aliases?: string[];
  original_app_user_id?: string;
  product_id?: string;
  entitlement_ids?: string[] | null;
  period_type?: string; // NORMAL | TRIAL | INTRO
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  store?: string; // APP_STORE | PLAY_STORE | MAC_APP_STORE | STRIPE | ...
  environment?: string; // SANDBOX | PRODUCTION
  transaction_id?: string;
  original_transaction_id?: string;
  cancel_reason?: string;
  /** Price in USD (RevenueCat converts). Negative on some refund events. */
  price?: number | null;
  // TRANSFER events
  transferred_from?: string[];
  transferred_to?: string[];
}

export interface RevenueCatWebhookBody {
  api_version?: string;
  event?: RevenueCatEvent;
}

const SLUG_TO_TIER: Record<string, SubscriptionTier> = {
  basic: 'BASIC',
  pro: 'PRO',
  master: 'MASTER',
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Event types that represent a new sale (vs a renewal of an existing one). */
const INACTIVE_SALE_EVENT_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'PRODUCT_CHANGE']);

const RC_ANONYMOUS_PREFIX = '$RCAnonymousID:';

/** RevenueCat's cancel reason for a store refund. */
const REFUND_CANCEL_REASON = 'CUSTOMER_SUPPORT';

/**
 * Clock slack when deciding a refund's expiry has "already passed". The refund
 * event's `expiration_at_ms` is the refund moment; a small skew between
 * RevenueCat's clock and ours must not push a genuine refund into the
 * needs-review path.
 */
const REFUND_EXPIRY_TOLERANCE_MS = 60_000;

@Injectable()
export class RevenueCatService {
  private readonly logger = new Logger(RevenueCatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly config: ConfigService,
  ) {}

  // ============================================================
  // Auth
  // ============================================================

  /**
   * Verify the RC webhook `Authorization` header against `RC_WEBHOOK_SECRET`.
   * Fails CLOSED — if the secret is unset, no request is trusted.
   *
   * A3: uses a constant-time comparison. `===` on strings short-circuits at the
   * first differing byte, so response timing leaks a prefix-match oracle that
   * lets an attacker recover the secret byte-by-byte. Unlike Stripe/Clerk (HMAC
   * over the body, where the signature differs per request) this is a STATIC
   * bearer token replayed on every call — exactly the shape that oracle attacks.
   * `timingSafeEqual` requires equal-length buffers and throws otherwise, so the
   * length check is compared separately and deliberately leaks only length.
   */
  verifyAuthHeader(authHeader: string | undefined): boolean {
    const secret = this.config.get<string>('RC_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('RC_WEBHOOK_SECRET not set — rejecting all RevenueCat webhooks');
      return false;
    }
    if (!authHeader) return false;

    const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
    const received = Buffer.from(authHeader, 'utf8');
    if (expected.length !== received.length) return false;

    return timingSafeEqual(expected, received);
  }

  // ============================================================
  // Event dispatch
  // ============================================================

  async handleEvent(event: RevenueCatEvent): Promise<void> {
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        await this.handleActiveSubscription(event);
        break;

      case 'NON_RENEWING_PURCHASE':
        await this.handleConsumablePurchase(event);
        break;

      case 'CANCELLATION':
        await this.handleCancellation(event);
        break;

      case 'EXPIRATION':
        await this.handleExpiration(event);
        break;

      case 'BILLING_ISSUE':
        // Grace period — tier persists until EXPIRATION. Log only (do NOT flip
        // status out of ACTIVE).
        this.logger.warn(
          `RC BILLING_ISSUE for ${event.app_user_id} — grace; tier persists until EXPIRATION`,
        );
        break;

      case 'SUBSCRIPTION_PAUSED':
        this.logger.log(`RC SUBSCRIPTION_PAUSED for ${event.app_user_id} — log only (v1)`);
        break;

      case 'TRANSFER':
        await this.handleTransfer(event);
        break;

      default:
        this.logger.log(`Unhandled RC event type: ${event.type}`);
    }
  }

  // ============================================================
  // Handlers
  // ============================================================

  /** INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION. */
  private async handleActiveSubscription(event: RevenueCatEvent): Promise<void> {
    // Only real IAP stores create IAP subs. RC can proxy STRIPE (we handle
    // Stripe natively — skip to avoid double-handling) and send PROMOTIONAL /
    // AMAZON / RC_BILLING events; recording those as APPLE_IAP would wrongly
    // trip the account-deletion "cancel in App Store" interstitial.
    //
    // FIRST, before resolving the user (1A-core item 3): it needs no user, and an
    // unknown user now throws → 500 → retry. A non-IAP event for an unknown id
    // must be acknowledged, not retried for hours.
    if (!this.isIapStore(event.store)) {
      // warn, not log: reaching here means RC is configured with a store this
      // service does not own, which is a misconfiguration worth seeing in logs.
      this.logger.warn(`RC ${event.type}: non-IAP store "${event.store}" — skipping`);
      return;
    }

    const userId = await this.resolveUserId(event);
    if (!userId) return;

    const plan = await this.resolvePlan(event.product_id);
    if (!plan) this.throwUnmappedProduct(event, 'plan');
    this.warnIfInactiveSale(event, plan);
    const planTier = SLUG_TO_TIER[plan.slug];
    if (!planTier) this.throwUnmappedProduct(event, 'tier');

    const platform = this.platformFromStore(event.store);
    const periodStart = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();
    const periodEnd = event.expiration_at_ms
      ? new Date(event.expiration_at_ms)
      : new Date(Date.now() + THIRTY_DAYS_MS);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;

    // A refund that arrived BEFORE its purchase must not lose to the purchase's
    // retry. Only checkable when the activation carries its own transaction id —
    // keying on original_transaction_id would block every later renewal.
    if (event.transaction_id && (await this.isRefundRecorded(event.transaction_id))) {
      this.ignoreStaleActivation(event, 'refund_already_recorded');
      return;
    }

    const existing = await this.findSubscriptionByTxKey(platform, txKey);

    // Older events must not overwrite newer state (1A-core item 5). STATE-based,
    // not wall-clock: in sandbox a period lasts minutes, so a retried or delayed
    // activation is routinely "already expired" by the time it lands — comparing
    // against `now` would silently drop real purchases. Applies only when a row
    // exists and the event carries an expiry.
    if (existing && event.expiration_at_ms != null) {
      const eventExpiry = event.expiration_at_ms;
      const rowExpiry = existing.currentPeriodEnd.getTime();

      // A retried RENEWAL for a period that was refunded or has expired. A
      // genuine resubscription on the same original transaction carries a
      // strictly later expiry and passes.
      if (existing.status === 'EXPIRED' && eventExpiry <= rowExpiry) {
        this.ignoreStaleActivation(event, 'ended_period');
        return;
      }

      // An older event delivered after a newer one (retries reorder). Equal is
      // NOT older — UNCANCELLATION carries the current period's expiry.
      if (eventExpiry < rowExpiry) {
        this.ignoreStaleActivation(event, 'older_than_stored');
        // That period was still paid for, and its MonthlyCreditsLog key
        // (periodStart = purchased_at_ms) is distinct and idempotent, so grant
        // it — the governing-subscription gate still applies.
        if (event.type === 'RENEWAL') {
          await this.entitlements.grantMonthlyCreditsForSubscription(userId, existing, {
            periodStart,
            periodEnd,
          });
        }
        return;
      }
    }

    // Never (re)activate for a period that is already over (line-audit M1).
    // Entitlement is `status === ACTIVE` and nothing re-evaluates time, so an
    // activation landing after its own period ended — a retry or a replay after
    // the EXPIRATION, or a late first delivery — would otherwise grant a tier
    // permanently. An existing ACTIVE row stays ACTIVE (its EXPIRATION is still
    // to come); anything else is recorded as EXPIRED, with no tier and no grant.
    const periodAlreadyOver =
      event.expiration_at_ms != null && event.expiration_at_ms <= Date.now();
    if (periodAlreadyOver && existing?.status !== 'ACTIVE') {
      if (existing) {
        await this.prisma.subscription.update({
          where: { id: existing.id },
          data: {
            userId,
            planTier,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            ...this.environmentData(event),
          },
        });
      } else {
        await this.prisma.subscription.create({
          data: {
            userId,
            planTier,
            status: 'EXPIRED',
            platform,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            ...this.txKeyColumn(platform, txKey),
            ...this.environmentData(event),
          },
        });
      }
      await this.entitlements.syncUserTier(userId);
      this.ignoreStaleActivation(event, 'period_already_over');
      return;
    }

    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          userId, // PRODUCT_CHANGE / transfer edge — keep owner in sync
          planTier,
          status: 'ACTIVE',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelledAt: null, // UNCANCELLATION clears a prior auto-renew-off
          ...this.environmentData(event),
        },
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          userId,
          planTier,
          status: 'ACTIVE',
          platform,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          ...this.txKeyColumn(platform, txKey),
          ...this.environmentData(event),
        },
      });
    }

    // Recompute effective tier across ALL providers + resnapshot chat quota.
    await this.entitlements.syncUserTier(userId);

    // Credits: a RENEWAL advances the governing sub's period; an initial/change
    // grants for whoever's governing now (idempotent via MonthlyCreditsLog).
    if (event.type === 'RENEWAL') {
      const sub = await this.findSubscriptionByTxKey(platform, txKey);
      if (sub) {
        await this.entitlements.grantMonthlyCreditsForSubscription(userId, sub, {
          periodStart,
          periodEnd,
        });
      }
    } else {
      await this.entitlements.grantMonthlyCreditsForGoverningSub(userId);
    }

    this.logger.log(
      `RC ${event.type}: user=${userId} tier=${planTier} platform=${platform} product=${event.product_id}`,
    );
  }

  /** NON_RENEWING_PURCHASE — a consumable credit pack. Ledgered grant. */
  private async handleConsumablePurchase(event: RevenueCatEvent): Promise<void> {
    // BEFORE any DB write — placement matters here more than anywhere else. The
    // idempotency Transaction below carries platformFromStore(event.store), which
    // defaults unknown stores to APPLE_IAP. Guarding after it would leave an
    // orphan APPLE_IAP-labelled row (wrongly tripping the account-deletion
    // "cancel in App Store" interstitial) AND permanently poison the
    // rc-purchase:<tx> idempotency key, so a later legitimate retry is skipped.
    // Also before user resolution (see handleActiveSubscription).
    if (!this.isIapStore(event.store)) {
      this.logger.warn(`RC ${event.type}: non-IAP store "${event.store}" — skipping`);
      return;
    }

    const userId = await this.resolveUserId(event);
    if (!userId) return;

    const pkg = await this.resolveCreditPackage(event.product_id);
    if (!pkg) this.throwUnmappedProduct(event, 'credit_package');

    this.warnIfInactiveSale(event, pkg);

    // Idempotency: grantCredits is a raw increment with no dedup of its own, and
    // the webhook's Redis dedup is not atomic under concurrent/duplicate
    // delivery. Gate on the Transaction's UNIQUE stripePaymentId (reused as the
    // IAP idempotency key): create it FIRST, and a P2002 ("already processed")
    // → skip the grant. This makes the pack grant DB-idempotent independently.
    const idemKey = `rc-purchase:${event.transaction_id ?? event.id}`;
    try {
      await this.prisma.transaction.create({
        data: {
          userId,
          stripePaymentId: idemKey,
          amount: pkg.priceUsd,
          currency: 'USD',
          type: 'CREDIT_PURCHASE',
          description: `IAP credit pack: ${pkg.slug} (+${pkg.creditAmount})`,
          platform: this.platformFromStore(event.store),
          ...this.environmentData(event),
        },
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        this.logger.log(`RC NON_RENEWING_PURCHASE ${idemKey} already processed — idempotent skip`);
        return;
      }
      throw err;
    }

    const reason = `iap-credit-pack:${pkg.slug}:${event.transaction_id ?? event.id}`;
    await this.entitlements.grantCredits(userId, pkg.creditAmount, reason);

    this.logger.log(`RC NON_RENEWING_PURCHASE: user=${userId} +${pkg.creditAmount} credits (${pkg.slug})`);
  }

  /**
   * CANCELLATION. Three cases:
   * - Consumable product (maps to a CreditPackage) = a REFUND → claw back credits
   *   (floored at 0) + Sentry alert.
   * - Subscription product with cancel_reason CUSTOMER_SUPPORT = a REFUND → end
   *   the membership and claw back that period's monthly grant (1A-core item 5).
   * - Any other subscription cancellation = the user turned OFF auto-renew (or a
   *   billing failure); they remain entitled until EXPIRATION. Record
   *   `cancelledAt` but keep the row ACTIVE (no tier drop).
   */
  private async handleCancellation(event: RevenueCatEvent): Promise<void> {
    // Before any DB write and before user resolution (see handleConsumablePurchase).
    if (!this.isIapStore(event.store)) {
      this.logger.warn(`RC ${event.type}: non-IAP store "${event.store}" — skipping`);
      return;
    }

    const userId = await this.resolveUserId(event);
    if (!userId) return;

    const pkg = await this.resolveCreditPackage(event.product_id);
    if (pkg) {
      // Idempotency (mirror the purchase path): gate the clawback on a UNIQUE
      // REFUND Transaction so a redelivered refund can't double-claw.
      const idemKey = `rc-refund:${event.transaction_id ?? event.id}`;
      try {
        await this.prisma.transaction.create({
          data: {
            userId,
            stripePaymentId: idemKey,
            amount: pkg.priceUsd,
            currency: 'USD',
            type: 'REFUND',
            description: `IAP refund: ${pkg.slug} (-${pkg.creditAmount})`,
            platform: this.platformFromStore(event.store),
            ...this.environmentData(event),
          },
        });
      } catch (err) {
        if (this.isUniqueConstraintError(err)) {
          this.logger.log(`RC refund ${idemKey} already processed — idempotent skip`);
          return;
        }
        throw err;
      }

      const reason = `iap-refund:${pkg.slug}:${event.transaction_id ?? event.id}`;
      const { clawedBack } = await this.entitlements.clawbackCredits(userId, pkg.creditAmount, reason);
      Sentry.captureMessage('RevenueCat consumable refund', {
        level: 'warning',
        extra: {
          userId,
          package: pkg.slug,
          requested: pkg.creditAmount,
          clawedBack,
          transactionId: event.transaction_id,
          cancelReason: event.cancel_reason,
        },
      });
      this.logger.warn(
        `RC CANCELLATION (consumable refund): user=${userId} pack=${pkg.slug} clawedBack=${clawedBack}/${pkg.creditAmount}`,
      );
      return;
    }

    const platform = this.platformFromStore(event.store);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;

    if (event.cancel_reason === REFUND_CANCEL_REASON) {
      const expiry = event.expiration_at_ms;
      if (expiry != null && expiry <= Date.now() + REFUND_EXPIRY_TOLERANCE_MS) {
        await this.handleSubscriptionRefund(event, userId, platform, txKey);
        return;
      }
      // FAIL-SAFE. A refund whose expiry is absent or still in the future does
      // not match the payload this code assumes (Apple can refund an older
      // renewal while the current period stays paid). Revoke nothing; tell a
      // human. Falls through to the auto-renew-off behaviour below.
      Sentry.captureMessage('revenuecat.refund_needs_review', {
        level: 'warning',
        tags: { eventType: event.type },
        extra: {
          eventId: event.id,
          productId: event.product_id,
          environment: event.environment,
          expirationAtMs: expiry ?? null,
        },
      });
      this.logger.warn(
        `RC CANCELLATION (refund, expiry ${expiry ?? 'absent'} not past): user=${userId} — left ACTIVE for review`,
      );
    }

    // Subscription cancellation = auto-renew off; still entitled until expiration.
    const existing = await this.findSubscriptionByTxKey(platform, txKey);
    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: { cancelledAt: new Date() }, // keep status ACTIVE until EXPIRATION
      });
    }
    this.logger.log(
      `RC CANCELLATION (auto-renew off): user=${userId} — tier retained until EXPIRATION`,
    );
  }

  /**
   * A refunded membership: claw back the refunded period's monthly grant, then
   * end the subscription (1A-core item 5).
   *
   * ORDER AND ATOMICITY ARE LOAD-BEARING.
   * - The REFUND Transaction (idempotency key) and the clawback commit together,
   *   so "row exists" ⇒ "already clawed back". The P2002 is caught OUTSIDE the
   *   interactive transaction: a unique violation aborts a Postgres transaction,
   *   so catching it inside (the pack branch's shape) would just fail the next
   *   statement.
   * - The expiry runs UNCONDITIONALLY, including after a P2002. It is
   *   idempotent, and skipping it on a retry is how a refund would be recorded
   *   but never revoke access.
   */
  private async handleSubscriptionRefund(
    event: RevenueCatEvent,
    userId: string,
    platform: PaymentPlatform,
    txKey: string | null,
  ): Promise<void> {
    // Fallback when RevenueCat omits transaction_id: original transaction +
    // purchase time identifies the refunded period, so two refund events for it
    // share one key (line-audit L3). `event.id` alone differs per event and would
    // let a second refund event claw back again.
    const refundKey = event.transaction_id
      ? `rc-refund:${event.transaction_id}`
      : `rc-refund:${event.original_transaction_id ?? 'no-orig'}:${event.purchased_at_ms ?? event.id}`;
    const existing = await this.findSubscriptionByTxKey(platform, txKey);
    // The refunded period's grant is keyed by the same value the granting
    // RENEWAL / INITIAL_PURCHASE used: purchased_at_ms. The row's
    // currentPeriodStart is only a fallback — every activation event rewrites it.
    const periodStart = event.purchased_at_ms
      ? new Date(event.purchased_at_ms)
      : (existing?.currentPeriodStart ?? null);
    const { amount, amountKnown } = this.refundAmount(event);

    // A refund of an OLDER period than the one the row currently holds (Apple can
    // refund a past renewal while the current period stays paid — line-audit
    // M2): claw back that period's grant, but do NOT end the current, paid
    // period. A human reviews it. Fail-safe: when in doubt, keep access.
    const refundsOlderPeriod =
      !!existing &&
      event.purchased_at_ms != null &&
      event.purchased_at_ms < existing.currentPeriodStart.getTime();

    let requested = 0;
    let clawedBack = 0;
    let alreadyProcessed = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.create({
          data: {
            userId,
            stripePaymentId: refundKey,
            amount,
            currency: 'USD',
            type: 'REFUND',
            description:
              `IAP subscription refund: ${existing?.planTier ?? 'unknown tier'}` +
              (amountKnown ? '' : ' (amount not provided)'),
            platform,
            ...this.environmentData(event),
          },
        });
        if (!periodStart) return;
        const log = await tx.monthlyCreditsLog.findUnique({
          where: { userId_periodStart: { userId, periodStart } },
        });
        // No log row → another subscription was governing that period; nothing
        // of THIS subscription's to claw back.
        if (!log || log.creditAmount <= 0) return;
        requested = log.creditAmount;
        const result = await this.entitlements.clawbackCredits(
          userId,
          log.creditAmount,
          `iap-sub-refund:${existing?.planTier ?? 'unknown'}:${refundKey}`,
          tx,
        );
        clawedBack = result.clawedBack;
      });
    } catch (err) {
      if (!this.isUniqueConstraintError(err)) throw err;
      alreadyProcessed = true;
      this.logger.log(`RC subscription refund ${refundKey} already processed — clawback skipped, expiry re-applied`);
    }

    if (refundsOlderPeriod) {
      Sentry.captureMessage('revenuecat.refund_needs_review', {
        level: 'warning',
        tags: { eventType: event.type, reason: 'older_period' },
        extra: { eventId: event.id, environment: event.environment, requested, clawedBack, alreadyProcessed },
      });
      this.logger.warn(
        `RC CANCELLATION (refund of an older period): user=${userId} clawedBack=${clawedBack}/${requested} — current period left ACTIVE for review`,
      );
      return;
    }

    const tier = await this.expireSubscription(userId, platform, txKey);

    Sentry.captureMessage('revenuecat.subscription_refunded', {
      level: 'warning',
      extra: {
        eventId: event.id,
        environment: event.environment,
        requested,
        clawedBack,
        alreadyProcessed,
        tierAfter: tier,
      },
    });
    this.logger.warn(
      `RC CANCELLATION (subscription refund): user=${userId} clawedBack=${clawedBack}/${requested} tier=${tier}`,
    );
  }

  /** EXPIRATION — the entitlement lapsed. Flip to EXPIRED + recompute tier. */
  private async handleExpiration(event: RevenueCatEvent): Promise<void> {
    // Before any DB write and before user resolution (see handleConsumablePurchase).
    if (!this.isIapStore(event.store)) {
      this.logger.warn(`RC ${event.type}: non-IAP store "${event.store}" — skipping`);
      return;
    }

    const userId = await this.resolveUserId(event);
    if (!userId) return;

    const platform = this.platformFromStore(event.store);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;
    const tier = await this.expireSubscription(userId, platform, txKey, event.expiration_at_ms);
    this.logger.log(`RC EXPIRATION: user=${userId} tier recomputed to ${tier}`);
  }

  /**
   * The ONE expiry path (EXPIRATION and subscription refunds): flip the row to
   * EXPIRED and recompute the tier — which drops only if no other active sub
   * remains. Idempotent.
   *
   * `expiredAtMs` (EXPIRATION only) is RECORDED as the period end when it is
   * later than the stored one (line-audit M1). The stale-activation guard
   * compares an incoming expiry against the stored period end; without this, a
   * RENEWAL for the period that just expired — whose first delivery failed and
   * is now retried or replayed — looked newer than the row and re-activated it.
   * A refund passes nothing: its "expiry" is the refund moment, which must not
   * shorten the record.
   */
  private async expireSubscription(
    userId: string,
    platform: PaymentPlatform,
    txKey: string | null,
    expiredAtMs?: number | null,
  ): Promise<SubscriptionTier> {
    const existing = await this.findSubscriptionByTxKey(platform, txKey);
    if (existing) {
      const recordExpiry =
        expiredAtMs != null && expiredAtMs > existing.currentPeriodEnd.getTime();
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: 'EXPIRED',
          ...(recordExpiry ? { currentPeriodEnd: new Date(expiredAtMs) } : {}),
        },
      });
    }
    const { tier } = await this.entitlements.syncUserTier(userId);
    return tier;
  }

  /**
   * TRANSFER — a store subscription's entitlements moved to a different
   * `app_user_id` (e.g. restore-purchases under a second account). Reassign the
   * Subscription row to the new user and recompute BOTH users' tiers so neither
   * is left with a stale tier.
   *
   * The RECIPIENT is resolved with the same rules as every other event, over
   * every entry of `transferred_to` (it can carry aliases and anonymous ids, so
   * `[0]` alone was not enough): known-deleted / anonymous-only → acknowledge;
   * never seen → throw (500, retried). The sender is best-effort, as before.
   */
  private async handleTransfer(event: RevenueCatEvent): Promise<void> {
    const fromClerkId = event.transferred_from?.[0];
    const fromUser = fromClerkId ? await this.findUserByClerkId(fromClerkId) : null;
    const toUserId = event.transferred_to?.length
      ? await this.resolveCandidates(
          event,
          event.transferred_to,
          'transfer_recipient',
          event.transferred_to.find((c) => !!c && !c.startsWith(RC_ANONYMOUS_PREFIX)),
        )
      : null;

    const platform = this.platformFromStore(event.store);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;

    if (toUserId) {
      if (txKey) {
        // Move the specific sub identified by its store tx key.
        const existing = await this.findSubscriptionByTxKey(platform, txKey);
        if (existing && existing.userId !== toUserId) {
          await this.prisma.subscription.update({
            where: { id: existing.id },
            data: { userId: toUserId },
          });
        }
      } else if (fromUser) {
        // No tx key on the event — move all of the from-user's IAP subs.
        await this.prisma.subscription.updateMany({
          where: { userId: fromUser.id, platform: { in: ['APPLE_IAP', 'GOOGLE_PLAY'] } },
          data: { userId: toUserId },
        });
      }
    }

    if (fromUser) await this.entitlements.syncUserTier(fromUser.id);
    if (toUserId) await this.entitlements.syncUserTier(toUserId);
    this.logger.log(
      `RC TRANSFER: from=${fromUser?.id ?? 'n/a'} to=${toUserId ?? 'n/a'} tier recomputed for both`,
    );
  }

  // ============================================================
  // Mapping helpers
  // ============================================================

  /**
   * Resolve our internal user id from the RC event's `app_user_id` (we set
   * `appUserID = clerkUserId` on the client), falling back to `aliases` /
   * `original_app_user_id`. See {@link resolveCandidates} for the outcomes.
   */
  private async resolveUserId(event: RevenueCatEvent): Promise<string | null> {
    return this.resolveCandidates(
      event,
      [event.app_user_id, ...(event.aliases ?? []), event.original_app_user_id],
      'app_user',
      event.app_user_id,
    );
  }

  /**
   * Resolve a set of RevenueCat ids to one of our users (1A-core item 3).
   * Outcomes, in this order:
   * 1. A candidate is a live user → its id.
   * 2. Only `$RCAnonymousID:` candidates → null (acknowledge). A LOG LINE, not a
   *    Sentry event: after a subscriber is deleted while an Apple subscription
   *    still bills, renewals may arrive under an anonymous id — routine, not an
   *    incident. No retry could ever resolve it.
   * 3. The PRIMARY id (`app_user_id`, or the first real transfer recipient)
   *    has a soft-deleted row (`deleted_<id>_…`) → null (acknowledge). Deleted
   *    accounts emit events for as long as the store subscription bills;
   *    retrying them is pointless. Decided on the primary only (line-audit L2):
   *    a deleted ALIAS must not swallow a real buyer whose own row does not
   *    exist yet — that case is the sign-up race, which a retry resolves.
   * 4. Never seen → throw → 500 → RevenueCat retries. A DB error in the deleted
   *    lookup also throws (it must never become a silent 200).
   */
  private async resolveCandidates(
    event: RevenueCatEvent,
    rawCandidates: Array<string | undefined | null>,
    role: 'app_user' | 'transfer_recipient',
    primary: string | undefined,
  ): Promise<string | null> {
    const candidates = rawCandidates.filter(
      (c): c is string => !!c && !c.startsWith(RC_ANONYMOUS_PREFIX),
    );

    for (const clerkUserId of candidates) {
      const user = await this.findUserByClerkId(clerkUserId);
      if (user) return user.id;
    }

    if (candidates.length === 0) {
      this.logger.warn(`RC ${event.type} ${event.id}: only anonymous ids (${role}) — acknowledged, nothing applied`);
      return null;
    }

    if (
      primary &&
      !primary.startsWith(RC_ANONYMOUS_PREFIX) &&
      (await findDeletedUserForClerkId(this.prisma, primary))
    ) {
      this.logger.log(`RC ${event.type} ${event.id}: ${role} belongs to a deleted account — acknowledged, nothing applied`);
      return null;
    }

    // Production → error (page). Sandbox/absent → warning: the likeliest cause
    // there is a build signed into a different Clerk instance than the one this
    // webhook serves, not lost revenue.
    Sentry.captureMessage('revenuecat.unknown_app_user', {
      level: event.environment === 'PRODUCTION' ? 'error' : 'warning',
      tags: { eventType: event.type, role },
      extra: {
        eventId: event.id,
        productId: event.product_id,
        store: event.store,
        environment: event.environment,
      },
    });
    throw new RevenueCatEventNotProcessableError(
      'unknown_app_user',
      `RC ${event.type} ${event.id}: no user for ${role} — not acknowledged, RevenueCat will retry`,
    );
  }

  /**
   * An event whose product maps to no plan / pack / tier. Loud (Sentry error)
   * and NOT acknowledged, so RevenueCat retries and a fixed mapping can still
   * apply it (1A-core item 3). Retries are bounded; after the last one, recovery
   * is manual — see docs/ops/incident-runbook.md.
   */
  private throwUnmappedProduct(
    event: RevenueCatEvent,
    kind: 'plan' | 'tier' | 'credit_package',
  ): never {
    Sentry.captureMessage('revenuecat.unmapped_product', {
      level: 'error',
      tags: { eventType: event.type, kind, productId: event.product_id ?? 'none' },
      extra: { eventId: event.id, store: event.store, environment: event.environment },
    });
    throw new RevenueCatEventNotProcessableError(
      'unmapped_product',
      `RC ${event.type} ${event.id}: product "${event.product_id}" maps to no ${kind} — not acknowledged, RevenueCat will retry`,
    );
  }

  /** Whether a refund for this store transaction has already been recorded. */
  private async isRefundRecorded(transactionId: string): Promise<boolean> {
    const row = await this.prisma.transaction.findUnique({
      where: { stripePaymentId: `rc-refund:${transactionId}` },
      select: { id: true },
    });
    return !!row;
  }

  /** Log + Sentry warning for an activation we deliberately did not apply. */
  private ignoreStaleActivation(
    event: RevenueCatEvent,
    reason: 'refund_already_recorded' | 'ended_period' | 'older_than_stored' | 'period_already_over',
  ): void {
    Sentry.captureMessage('revenuecat.stale_activation_ignored', {
      level: 'warning',
      tags: { eventType: event.type, reason },
      extra: { eventId: event.id, environment: event.environment, expirationAtMs: event.expiration_at_ms ?? null },
    });
    this.logger.warn(`RC ${event.type} ${event.id}: stale activation ignored (${reason}) — row not changed`);
  }

  /**
   * The amount recorded on a subscription REFUND row: RevenueCat's USD `price`
   * when it is a finite number (absolute — some refund events carry it
   * negative), otherwise 0 with the description saying so. Never an invented
   * figure.
   */
  private refundAmount(event: RevenueCatEvent): { amount: number; amountKnown: boolean } {
    const price = event.price;
    if (typeof price === 'number' && Number.isFinite(price)) {
      return { amount: Math.abs(price), amountKnown: true };
    }
    return { amount: 0, amountKnown: false };
  }

  private async findUserByClerkId(clerkUserId: string): Promise<{ id: string } | null> {
    return this.prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
  }

  /**
   * NOT filtered on `isActive` (1A-core item 2). By the time a store event
   * arrives Apple/Google has already charged the customer, and what is on sale
   * is decided by the RevenueCat offering — not by this flag. Filtering here
   * turned a plan switched off in the admin panel into lost renewals (and, for
   * packs, routed the refund of a deactivated pack into the subscription branch
   * where it was silently dropped). {@link warnIfInactiveSale} raises the signal
   * instead.
   */
  private async resolvePlan(productId: string | undefined) {
    if (!productId) return null;
    return this.prisma.plan.findFirst({
      where: {
        OR: [{ appleProductId: productId }, { googleProductId: productId }],
      },
    });
  }

  /** See {@link resolvePlan} — same reasoning, same absence of `isActive`. */
  private async resolveCreditPackage(productId: string | undefined) {
    if (!productId) return null;
    return this.prisma.creditPackage.findFirst({
      where: {
        OR: [{ appleProductId: productId }, { googleProductId: productId }],
      },
    });
  }

  /**
   * A NEW sale of a product we have switched off still goes through — the
   * money has moved — but it means the product is still in the RevenueCat
   * offering. Renewals of an existing subscription are expected and silent.
   */
  private warnIfInactiveSale(event: RevenueCatEvent, row: { isActive: boolean; slug: string }): void {
    if (row.isActive) return;
    if (!INACTIVE_SALE_EVENT_TYPES.has(event.type)) return;
    Sentry.captureMessage('revenuecat.inactive_product_purchased', {
      level: 'warning',
      tags: { productId: event.product_id ?? 'unknown', eventType: event.type },
      extra: { eventId: event.id, slug: row.slug, environment: event.environment },
    });
    this.logger.warn(
      `RC ${event.type}: product "${event.product_id}" (${row.slug}) is inactive but was sold — remove it from the RevenueCat offering`,
    );
  }

  private platformFromStore(store: string | undefined): PaymentPlatform {
    switch (store) {
      case 'PLAY_STORE':
        return 'GOOGLE_PLAY';
      case 'APP_STORE':
      case 'MAC_APP_STORE':
      default:
        return 'APPLE_IAP';
    }
  }

  /** The unique-column filter for a subscription's store transaction key. */
  private async findSubscriptionByTxKey(platform: PaymentPlatform, txKey: string | null) {
    if (!txKey) return null;
    const where =
      platform === 'GOOGLE_PLAY'
        ? { googlePurchaseToken: txKey }
        : { appleOriginalTxId: txKey };
    return this.prisma.subscription.findFirst({ where });
  }

  private txKeyColumn(
    platform: PaymentPlatform,
    txKey: string | null,
  ): { appleOriginalTxId?: string; googlePurchaseToken?: string } {
    if (!txKey) return {};
    return platform === 'GOOGLE_PLAY'
      ? { googlePurchaseToken: txKey }
      : { appleOriginalTxId: txKey };
  }

  /**
   * `environment` column value, spread into a write. Omitted entirely (not set
   * to null) when RevenueCat sends something unrecognised, so an update never
   * erases a value recorded by an earlier event.
   */
  private environmentData(event: RevenueCatEvent): { environment?: 'PRODUCTION' | 'SANDBOX' } {
    const environment = revenueCatEnvironment(event.environment);
    return environment ? { environment } : {};
  }

  /** True only for real IAP stores (Apple / Google) — not STRIPE/PROMOTIONAL/AMAZON. */
  private isIapStore(store: string | undefined): boolean {
    return store === 'APP_STORE' || store === 'MAC_APP_STORE' || store === 'PLAY_STORE';
  }

  /**
   * Delegates to the shared helper so P2002 detection has ONE implementation
   * across the payment services. Note this now also matches a real
   * `PrismaClientKnownRequestError` instance, which the local duck-typed-only
   * version already did in practice (that class exposes a `code` property).
   */
  private isUniqueConstraintError(error: unknown): boolean {
    return isUniqueConstraintViolation(error);
  }
}
