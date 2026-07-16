import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PaymentPlatform, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from './entitlements.service';

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
   */
  verifyAuthHeader(authHeader: string | undefined): boolean {
    const secret = this.config.get<string>('RC_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('RC_WEBHOOK_SECRET not set — rejecting all RevenueCat webhooks');
      return false;
    }
    return authHeader === `Bearer ${secret}`;
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
    const userId = await this.resolveUserId(event);
    if (!userId) return;

    // Only real IAP stores create IAP subs. RC can proxy STRIPE (we handle
    // Stripe natively — skip to avoid double-handling) and send PROMOTIONAL /
    // AMAZON / RC_BILLING events; recording those as APPLE_IAP would wrongly
    // trip the account-deletion "cancel in App Store" interstitial.
    if (!this.isIapStore(event.store)) {
      this.logger.log(`RC ${event.type}: non-IAP store "${event.store}" — skipping`);
      return;
    }

    const plan = await this.resolvePlan(event.product_id);
    if (!plan) {
      this.logger.warn(`RC: no active Plan maps product "${event.product_id}" — skipping`);
      return;
    }
    const planTier = SLUG_TO_TIER[plan.slug];
    if (!planTier) {
      this.logger.warn(`RC: Plan "${plan.slug}" has no tier mapping — skipping`);
      return;
    }

    const platform = this.platformFromStore(event.store);
    const periodStart = event.purchased_at_ms ? new Date(event.purchased_at_ms) : new Date();
    const periodEnd = event.expiration_at_ms
      ? new Date(event.expiration_at_ms)
      : new Date(Date.now() + THIRTY_DAYS_MS);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;

    const existing = await this.findSubscriptionByTxKey(platform, txKey);
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
    const userId = await this.resolveUserId(event);
    if (!userId) return;

    const pkg = await this.resolveCreditPackage(event.product_id);
    if (!pkg) {
      this.logger.warn(`RC: no active CreditPackage maps product "${event.product_id}" — skipping`);
      return;
    }

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
   * CANCELLATION. Two cases:
   * - Consumable product (maps to a CreditPackage) = a REFUND → claw back credits
   *   (floored at 0) + Sentry alert.
   * - Subscription product = the user turned OFF auto-renew; they remain entitled
   *   until EXPIRATION. Record `cancelledAt` but keep the row ACTIVE (no tier drop).
   */
  private async handleCancellation(event: RevenueCatEvent): Promise<void> {
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

    // Subscription cancellation = auto-renew off; still entitled until expiration.
    const platform = this.platformFromStore(event.store);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;
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

  /** EXPIRATION — the entitlement lapsed. Flip to EXPIRED + recompute tier. */
  private async handleExpiration(event: RevenueCatEvent): Promise<void> {
    const userId = await this.resolveUserId(event);
    if (!userId) return;

    const platform = this.platformFromStore(event.store);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;
    const existing = await this.findSubscriptionByTxKey(platform, txKey);
    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'EXPIRED' },
      });
    }

    // Recompute — drops to a lower tier only if no other active sub remains.
    const { tier } = await this.entitlements.syncUserTier(userId);
    this.logger.log(`RC EXPIRATION: user=${userId} tier recomputed to ${tier}`);
  }

  /**
   * TRANSFER — a store subscription's entitlements moved to a different
   * `app_user_id` (e.g. restore-purchases under a second account). Reassign the
   * Subscription row to the new user and recompute BOTH users' tiers so neither
   * is left with a stale tier.
   */
  private async handleTransfer(event: RevenueCatEvent): Promise<void> {
    const toClerkId = event.transferred_to?.[0];
    const fromClerkId = event.transferred_from?.[0];
    const toUser = toClerkId ? await this.findUserByClerkId(toClerkId) : null;
    const fromUser = fromClerkId ? await this.findUserByClerkId(fromClerkId) : null;

    const platform = this.platformFromStore(event.store);
    const txKey = event.original_transaction_id ?? event.transaction_id ?? null;

    if (toUser) {
      if (txKey) {
        // Move the specific sub identified by its store tx key.
        const existing = await this.findSubscriptionByTxKey(platform, txKey);
        if (existing && existing.userId !== toUser.id) {
          await this.prisma.subscription.update({
            where: { id: existing.id },
            data: { userId: toUser.id },
          });
        }
      } else if (fromUser) {
        // No tx key on the event — move all of the from-user's IAP subs.
        await this.prisma.subscription.updateMany({
          where: { userId: fromUser.id, platform: { in: ['APPLE_IAP', 'GOOGLE_PLAY'] } },
          data: { userId: toUser.id },
        });
      }
    }

    if (fromUser) await this.entitlements.syncUserTier(fromUser.id);
    if (toUser) await this.entitlements.syncUserTier(toUser.id);
    this.logger.log(
      `RC TRANSFER: from=${fromUser?.id ?? 'n/a'} to=${toUser?.id ?? 'n/a'} tier recomputed for both`,
    );
  }

  // ============================================================
  // Mapping helpers
  // ============================================================

  /**
   * Resolve our internal user id from the RC event's `app_user_id` (we set
   * `appUserID = clerkUserId` on the client). Falls back to `aliases` /
   * `original_app_user_id`. Returns null (logged) if unknown.
   */
  private async resolveUserId(event: RevenueCatEvent): Promise<string | null> {
    const candidates = [
      event.app_user_id,
      ...(event.aliases ?? []),
      event.original_app_user_id,
    ].filter((c): c is string => !!c && !c.startsWith('$RCAnonymousID:'));

    for (const clerkUserId of candidates) {
      const user = await this.findUserByClerkId(clerkUserId);
      if (user) return user.id;
    }
    this.logger.warn(`RC: no user for app_user_id "${event.app_user_id}" — skipping event ${event.id}`);
    return null;
  }

  private async findUserByClerkId(clerkUserId: string): Promise<{ id: string } | null> {
    return this.prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
  }

  private async resolvePlan(productId: string | undefined) {
    if (!productId) return null;
    return this.prisma.plan.findFirst({
      where: {
        isActive: true,
        OR: [{ appleProductId: productId }, { googleProductId: productId }],
      },
    });
  }

  private async resolveCreditPackage(productId: string | undefined) {
    if (!productId) return null;
    return this.prisma.creditPackage.findFirst({
      where: {
        isActive: true,
        OR: [{ appleProductId: productId }, { googleProductId: productId }],
      },
    });
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

  /** True only for real IAP stores (Apple / Google) — not STRIPE/PROMOTIONAL/AMAZON. */
  private isIapStore(store: string | undefined): boolean {
    return store === 'APP_STORE' || store === 'MAC_APP_STORE' || store === 'PLAY_STORE';
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    );
  }
}
