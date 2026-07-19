/**
 * Stripe Service — Handles all Stripe payment operations.
 *
 * Responsibilities:
 * - Create checkout sessions (subscription + one-time)
 * - Manage subscriptions (cancel, reactivate)
 * - Handle Stripe webhook events
 * - Create customer portal sessions
 * - Validate promo codes
 */
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EntitlementsService } from './entitlements.service';
import { isUniqueConstraintViolation } from './prisma-errors';
import * as Sentry from '@sentry/nestjs';
import Stripe from 'stripe';

// ============================================================
// Types
// ============================================================

interface CreateCheckoutInput {
  clerkUserId: string;
  planSlug: string;       // 'basic', 'pro', 'master'
  billingCycle: 'monthly' | 'annual';
  promoCode?: string;
  successUrl: string;
  cancelUrl: string;
}

interface CreateOneTimeCheckoutInput {
  clerkUserId: string;
  serviceSlug: string;    // 'lifetime', 'annual', etc.
  promoCode?: string;
  successUrl: string;
  cancelUrl: string;
}

interface CreateCreditPackageCheckoutInput {
  clerkUserId: string;
  packageSlug: string;    // 'starter-5', 'value-12', etc.
  successUrl: string;
  cancelUrl: string;
}

// ============================================================
// Service
// ============================================================

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    // M6: provider-neutral tier recompute + credit grants. Replaces the
    // former direct ChatPaymentService dependency — chat-quota resnapshot now
    // happens inside EntitlementsService.syncUserTier.
    private readonly entitlements: EntitlementsService,
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe will not work');
    }
    this.stripe = new Stripe(secretKey || 'sk_test_placeholder');
  }

  // ============================================================
  // Checkout Sessions
  // ============================================================

  /**
   * Create a Stripe Checkout session for a subscription plan.
   */
  async createSubscriptionCheckout(input: CreateCheckoutInput): Promise<{ sessionId: string; url: string }> {
    const user = await this.findUserOrThrow(input.clerkUserId);

    // Look up the plan from DB
    const plan = await this.prisma.plan.findFirst({
      where: { slug: input.planSlug, isActive: true },
    });
    if (!plan) {
      throw new NotFoundException(`Plan "${input.planSlug}" not found or inactive`);
    }

    // Get or create Stripe customer
    const customerId = await this.getOrCreateStripeCustomer(user.id, user.clerkUserId, user.name);

    // Determine price
    const unitAmount = input.billingCycle === 'annual'
      ? Math.round(Number(plan.priceAnnual) * 100)
      : Math.round(Number(plan.priceMonthly) * 100);

    const interval = input.billingCycle === 'annual' ? 'year' : 'month';

    // Build session params
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: plan.currency.toLowerCase(),
            product_data: {
              name: plan.nameZhTw,
              description: `${plan.nameZhTw} — ${input.billingCycle === 'annual' ? '年繳' : '月繳'}`,
            },
            unit_amount: unitAmount,
            recurring: { interval },
          },
          quantity: 1,
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        clerkUserId: input.clerkUserId,
        planSlug: input.planSlug,
        billingCycle: input.billingCycle,
        internalUserId: user.id,
      },
      subscription_data: {
        metadata: {
          clerkUserId: input.clerkUserId,
          planSlug: input.planSlug,
          internalUserId: user.id,
        },
      },
    };

    // Apply promo code if provided
    if (input.promoCode) {
      const promoValidation = await this.validateAndGetStripeCoupon(input.promoCode, unitAmount);
      if (promoValidation) {
        sessionParams.discounts = [{ coupon: promoValidation.stripeCouponId }];
      }
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    this.logger.log(`Checkout session created: ${session.id} for user ${input.clerkUserId}`);

    return {
      sessionId: session.id,
      url: session.url || '',
    };
  }

  /**
   * Create a Stripe Checkout session for a one-time credit purchase.
   */
  async createOneTimeCheckout(input: CreateOneTimeCheckoutInput): Promise<{ sessionId: string; url: string }> {
    const user = await this.findUserOrThrow(input.clerkUserId);

    const service = await this.prisma.service.findFirst({
      where: { slug: input.serviceSlug, isActive: true },
    });
    if (!service) {
      throw new NotFoundException(`Service "${input.serviceSlug}" not found or inactive`);
    }

    const customerId = await this.getOrCreateStripeCustomer(user.id, user.clerkUserId, user.name);

    // Credit cost in cents (e.g., 1 credit = $1.99)
    const unitAmount = service.creditCost * 100; // creditCost is stored in cents

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: service.nameZhTw,
              description: `${service.nameZhTw} — 單次解讀`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        clerkUserId: input.clerkUserId,
        serviceSlug: input.serviceSlug,
        type: 'one_time',
        internalUserId: user.id,
      },
    });

    return {
      sessionId: session.id,
      url: session.url || '',
    };
  }

  /**
   * Create a Stripe Checkout session for a credit package purchase.
   */
  async createCreditPackageCheckout(input: CreateCreditPackageCheckoutInput): Promise<{ sessionId: string; url: string }> {
    const user = await this.findUserOrThrow(input.clerkUserId);

    const pkg = await this.prisma.creditPackage.findFirst({
      where: { slug: input.packageSlug, isActive: true },
    });
    if (!pkg) {
      throw new NotFoundException(`Credit package "${input.packageSlug}" not found or inactive`);
    }

    const customerId = await this.getOrCreateStripeCustomer(user.id, user.clerkUserId, user.name);

    const unitAmount = Math.round(Number(pkg.priceUsd) * 100);

    // Validate Stripe metadata total size < 500 chars
    const metadata = {
      clerkUserId: input.clerkUserId,
      type: 'credit_package',
      creditPackageId: pkg.id,
      creditAmount: String(pkg.creditAmount),
      packageSlug: pkg.slug,
      internalUserId: user.id,
    };
    const metadataStr = JSON.stringify(metadata);
    if (metadataStr.length > 500) {
      throw new BadRequestException('Checkout metadata too large');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: pkg.nameZhTw,
              description: `${pkg.nameZhTw} — ${pkg.creditAmount} 點`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
    });

    this.logger.log(`Credit package checkout created: ${session.id} for user ${input.clerkUserId}, package ${pkg.slug}`);

    return {
      sessionId: session.id,
      url: session.url || '',
    };
  }

  /**
   * Create a Stripe Customer Portal session for managing subscriptions.
   */
  async createPortalSession(clerkUserId: string, returnUrl: string): Promise<{ url: string }> {
    const user = await this.findUserOrThrow(clerkUserId);

    const customerId = await this.getStripeCustomerId(user.id);
    if (!customerId) {
      throw new BadRequestException('No payment history found. Please subscribe first.');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  // ============================================================
  // Subscription Management
  // ============================================================

  /**
   * Cancel a user's active subscription (at period end).
   */
  async cancelSubscription(clerkUserId: string): Promise<{ success: boolean; endsAt: string }> {
    const user = await this.findUserOrThrow(clerkUserId);

    const subscription = await this.prisma.subscription.findFirst({
      where: { userId: user.id, status: 'ACTIVE', platform: 'STRIPE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new NotFoundException('No active Stripe subscription found');
    }

    // Cancel at end of billing period (not immediately)
    const updated = await this.stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    // Update our DB
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        cancelledAt: new Date(),
        status: 'CANCELLED',
      },
    });

    // In clover API, period dates are on subscription items
    const firstItem = updated.items?.data?.[0];
    const periodEnd = firstItem?.current_period_end || Math.floor(Date.now() / 1000);
    this.logger.log(`Subscription cancelled for user ${clerkUserId}: ends at ${new Date(periodEnd * 1000).toISOString()}`);

    return {
      success: true,
      endsAt: new Date(periodEnd * 1000).toISOString(),
    };
  }

  /**
   * Reactivate a cancelled subscription (before period ends).
   */
  async reactivateSubscription(clerkUserId: string): Promise<{ success: boolean }> {
    const user = await this.findUserOrThrow(clerkUserId);

    const subscription = await this.prisma.subscription.findFirst({
      where: { userId: user.id, status: 'CANCELLED', platform: 'STRIPE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new NotFoundException('No cancelled subscription found to reactivate');
    }

    await this.stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        cancelledAt: null,
        status: 'ACTIVE',
      },
    });

    return { success: true };
  }

  /**
   * Upgrade (or downgrade) a user's subscription to a different plan.
   * Uses Stripe subscription item replacement with proration.
   */
  async upgradeSubscription(
    clerkUserId: string,
    planSlug: string,
    billingCycle: 'monthly' | 'annual',
  ): Promise<{ success: boolean; newTier: string }> {
    this.logger.log(`[upgrade] Starting upgrade for user=${clerkUserId} plan=${planSlug} cycle=${billingCycle}`);

    const user = await this.findUserOrThrow(clerkUserId);
    this.logger.log(`[upgrade] Found user id=${user.id}`);

    // Validate target plan
    const plan = await this.prisma.plan.findFirst({
      where: { slug: planSlug, isActive: true },
    });
    if (!plan) {
      throw new NotFoundException(`Plan "${planSlug}" not found or inactive`);
    }
    this.logger.log(`[upgrade] Found plan: ${plan.slug}, priceMonthly=${plan.priceMonthly}, priceAnnual=${plan.priceAnnual}, currency=${plan.currency}`);

    // Find active subscription
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId: user.id, status: { in: ['ACTIVE', 'CANCELLED'] }, platform: 'STRIPE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new NotFoundException('No active Stripe subscription found');
    }
    this.logger.log(`[upgrade] Found subscription: ${subscription.stripeSubscriptionId}, status=${subscription.status}`);

    // Calculate new price
    const unitAmount = billingCycle === 'annual'
      ? Math.round(Number(plan.priceAnnual) * 100)
      : Math.round(Number(plan.priceMonthly) * 100);
    const interval = billingCycle === 'annual' ? 'year' : 'month';
    this.logger.log(`[upgrade] unitAmount=${unitAmount}, interval=${interval}`);

    // Retrieve the Stripe subscription to get current item
    const stripeSub = await this.stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const currentItem = stripeSub.items.data[0];
    if (!currentItem) {
      throw new BadRequestException('Subscription has no items');
    }
    this.logger.log(`[upgrade] Current item id=${currentItem.id}, product=${currentItem.price.product}`);

    // Create (or reuse) a Stripe product for the target plan, then update subscription.
    // Checkout creates ad-hoc products via product_data, but subscription.update only
    // accepts a product ID string. We create a product per plan on-demand.
    const newTier = this.planSlugToTier(planSlug);
    this.logger.log(`[upgrade] Updating Stripe subscription to tier=${newTier}...`);

    try {
      // Ensure the current product is active, or create a new one for this plan
      const currentProduct = currentItem.price.product as string;
      let productId = currentProduct;

      // Check if current product is active; if not, create a new one
      try {
        const product = await this.stripe.products.retrieve(currentProduct);
        if (!product.active) {
          this.logger.log(`[upgrade] Product ${currentProduct} is inactive, creating new product...`);
          const newProduct = await this.stripe.products.create({
            name: plan.nameZhTw,
            description: `${plan.nameZhTw} — ${billingCycle === 'annual' ? '年繳' : '月繳'}`,
          });
          productId = newProduct.id;
          this.logger.log(`[upgrade] Created new product ${productId}`);
        }
      } catch {
        // Product doesn't exist, create a new one
        const newProduct = await this.stripe.products.create({
          name: plan.nameZhTw,
          description: `${plan.nameZhTw} — ${billingCycle === 'annual' ? '年繳' : '月繳'}`,
        });
        productId = newProduct.id;
        this.logger.log(`[upgrade] Created new product ${productId} (previous not found)`);
      }

      await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [
          {
            id: currentItem.id,
            price_data: {
              currency: plan.currency.toLowerCase(),
              product: productId,
              unit_amount: unitAmount,
              recurring: { interval: interval as 'month' | 'year' },
            },
          },
        ],
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false, // Ensure reactivated if was pending cancel
        metadata: {
          ...stripeSub.metadata,
          planSlug,
        },
      });
    } catch (stripeError: unknown) {
      const errMsg = stripeError instanceof Error ? stripeError.message : String(stripeError);
      this.logger.error(`[upgrade] Stripe API error: ${errMsg}`);
      throw new BadRequestException(`Stripe upgrade failed: ${errMsg}`);
    }

    this.logger.log(`[upgrade] Stripe updated successfully, updating DB...`);

    // Immediately update DB (webhook will also fire, but this gives instant UI feedback)
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planTier: newTier,
        status: 'ACTIVE',
        cancelledAt: null,
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { subscriptionTier: newTier },
    });

    this.logger.log(`Subscription ${subscription.stripeSubscriptionId} upgraded to ${newTier} for user ${clerkUserId}`);

    return { success: true, newTier };
  }

  // ============================================================
  // Webhook Handlers
  // ============================================================

  /**
   * Verify and parse a Stripe webhook event.
   */
  verifyWebhookSignature(payload: Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new BadRequestException('Stripe webhook secret not configured');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  /**
   * Handle checkout.session.completed — subscription or one-time payment.
   */
  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const clerkUserId = session.metadata?.clerkUserId;
    const internalUserId = session.metadata?.internalUserId;

    if (!clerkUserId || !internalUserId) {
      this.logger.warn(`Checkout completed but missing metadata: ${session.id}`);
      return;
    }

    if (session.mode === 'subscription') {
      await this.handleSubscriptionCreated(session, internalUserId);
    } else if (session.mode === 'payment') {
      await this.handleOneTimePayment(session, internalUserId);
    }
  }

  /**
   * Handle subscription lifecycle events from Stripe.
   */
  async handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
    const internalUserId = sub.metadata?.internalUserId;
    const planSlug = sub.metadata?.planSlug;

    if (!internalUserId) {
      this.logger.warn(`Subscription updated but missing metadata: ${sub.id}`);
      return;
    }

    const planTier = this.planSlugToTier(planSlug || 'basic');
    const status = this.mapStripeStatus(sub.status);

    // In the clover API version, current_period_start/end are on subscription items, not the subscription itself
    const firstItem = sub.items?.data?.[0];
    const periodStart = firstItem?.current_period_start;
    const periodEnd = firstItem?.current_period_end;

    // Update subscription in DB
    const existing = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: sub.id },
    });

    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status,
          planTier,
          ...(periodStart && { currentPeriodStart: new Date(periodStart * 1000) }),
          ...(periodEnd && { currentPeriodEnd: new Date(periodEnd * 1000) }),
          cancelledAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
        },
      });
    } else if (sub.status === 'active' || sub.status === 'trialing') {
      // This event beat `checkout.session.completed` (Stripe does not guarantee
      // ordering, and we don't subscribe to `customer.subscription.created`).
      // Create the row from the event so syncUserTier below sees the subscription
      // the user just paid for — otherwise it computes FREE from an empty set and
      // silently un-subscribes them, resnapshotting chat quota to the FREE cap.
      //
      // Gate on the RAW Stripe status, NOT mapStripeStatus(): that maps unknown
      // values — including `incomplete`, i.e. payment pending / SCA required /
      // card declined — to 'ACTIVE' via `map[status] || 'ACTIVE'`. Gating on the
      // mapped value would create an ACTIVE row and grant a paid tier to someone
      // who has not paid.
      try {
        await this.prisma.subscription.create({
          data: {
            userId: internalUserId,
            stripeSubscriptionId: sub.id,
            planTier,
            status: 'ACTIVE',
            platform: 'STRIPE',
            currentPeriodStart: periodStart ? new Date(periodStart * 1000) : new Date(),
            currentPeriodEnd: periodEnd
              ? new Date(periodEnd * 1000)
              : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            cancelledAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
          },
        });
      } catch (err) {
        // A concurrent checkout.session.completed won the race; its upsert owns
        // the row. Fall through to syncUserTier either way.
        if (!isUniqueConstraintViolation(err)) throw err;
        this.logger.warn(
          `Subscription ${sub.id} was created concurrently by checkout — continuing to tier sync`,
        );
      }
    } else {
      // No local row AND the event is not a paid state. There is nothing to
      // reflect, and calling syncUserTier here would downgrade a user whose
      // checkout is still in flight. Leave the tier untouched.
      this.logger.warn(
        `Subscription ${sub.id} updated (stripe status=${sub.status}) with no local row — skipping tier sync`,
      );
      return;
    }

    // Recompute the user's effective tier from ALL active subscriptions across
    // providers (M6) — never blind-downgrades a user who still holds an Apple/
    // Google sub. The `status`/`planTier` above are already persisted on the
    // Subscription row that syncUserTier reads; it also resnapshots chat quota.
    await this.entitlements.syncUserTier(internalUserId);

    this.logger.log(`Subscription ${sub.id} updated: status=${status}, tier=${planTier}`);
  }

  /**
   * Handle subscription deletion (expired or fully cancelled).
   */
  async handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
    const internalUserId = sub.metadata?.internalUserId;

    if (!internalUserId) return;

    // Mark subscription as expired
    const existing = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: sub.id },
    });

    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'EXPIRED' },
      });
    }

    // Recompute effective tier from remaining active subs (M6) — only drops to
    // FREE when NO active subscription remains (cross-provider safe). Also
    // resnapshots chat quota.
    const { tier } = await this.entitlements.syncUserTier(internalUserId);

    this.logger.log(`Subscription ${sub.id} deleted — user ${internalUserId} tier recomputed to ${tier}`);
  }

  /**
   * Handle invoice payment succeeded — record transaction.
   *
   * In the Stripe clover API version:
   * - Subscription is accessed via invoice.parent?.subscription_details?.subscription
   * - payment_intent is no longer a direct property; use invoice.id as payment reference
   */
  async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    // In clover API, subscription is accessed via parent.subscription_details
    const subDetails = invoice.parent?.subscription_details;
    const subscriptionId = subDetails
      ? (typeof subDetails.subscription === 'string'
          ? subDetails.subscription
          : subDetails.subscription?.id)
      : null;

    if (!subscriptionId) return;

    const sub = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (!sub) return;

    // Dunning recovery. handleInvoiceFailed sets PAST_DUE (and syncUserTier drops a
    // Stripe-only user to FREE). On recovery Stripe emits invoice.payment_succeeded
    // and customer.subscription.updated in NO guaranteed order — if the invoice
    // lands first the row is still PAST_DUE, so the governing-subscription gate in
    // grantMonthlyCreditsForSubscription (which queries status:'ACTIVE' only) skips
    // the grant. Nothing retries: no MonthlyCreditsLog row is written, and
    // customer.subscription.updated only calls syncUserTier, which never grants.
    // The customer pays and receives nothing for that period.
    //
    // PAST_DUE ONLY. A broader `!== 'ACTIVE'` would also resurrect CANCELLED/EXPIRED
    // subscriptions from a late or retried invoice, a $0 coupon invoice, or a
    // post-cancel proration — and nothing would flip them back, because
    // customer.subscription.deleted has already been consumed.
    if (sub.status === 'PAST_DUE') {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE' },
      });
      await this.entitlements.syncUserTier(sub.userId);
      this.logger.log(`Subscription ${sub.id} reactivated from PAST_DUE by paid invoice ${invoice.id}`);
    }

    // Record the transaction (use invoice.id as payment reference since payment_intent is no longer a direct property)
    //
    // P2002-tolerant: stripePaymentId is @unique, so a REDELIVERED invoice collides
    // here — and because this write precedes the credit grant, an escaping P2002
    // made the controller 500, which made Stripe retry, which hit the same P2002.
    // The Redis idempotency key is only set on success, so that loop never broke.
    // A conflict just means we already recorded this invoice: continue to the grant,
    // which has its own MonthlyCreditsLog dedup.
    try {
      await this.prisma.transaction.create({
        data: {
          userId: sub.userId,
          stripePaymentId: invoice.id,
          amount: this.formatStripeAmount(invoice.amount_paid || 0, invoice.currency || 'usd'),
          currency: (invoice.currency || 'usd').toUpperCase(),
          type: 'SUBSCRIPTION',
          description: `Subscription payment — ${invoice.lines?.data?.[0]?.description || 'renewal'}`,
          platform: 'STRIPE',
        },
      });
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
      this.logger.log(`Invoice ${invoice.id} already recorded — continuing to credit grant`);
    }

    // Grant monthly credits for the new billing period (renewal)
    // Extract period dates from invoice line items (Stripe clover API)
    const lineItem = invoice.lines?.data?.[0];
    if (lineItem) {
      const periodStart = lineItem.period?.start
        ? new Date(lineItem.period.start * 1000)
        : new Date();
      const periodEnd = lineItem.period?.end
        ? new Date(lineItem.period.end * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Grant this renewal's monthly credits — only if this sub is the
      // GOVERNING active sub (cross-provider dedup, M6). Uses the invoice's
      // period so the MonthlyCreditsLog idempotency key matches the new period.
      await this.entitlements.grantMonthlyCreditsForSubscription(sub.userId, sub, {
        periodStart,
        periodEnd,
      });
    }
  }

  /**
   * Handle invoice payment failed — mark subscription as past due.
   */
  async handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
    // In clover API, subscription is accessed via parent.subscription_details
    const subDetails = invoice.parent?.subscription_details;
    const subscriptionId = subDetails
      ? (typeof subDetails.subscription === 'string'
          ? subDetails.subscription
          : subDetails.subscription?.id)
      : null;

    if (!subscriptionId) return;

    const existing = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'PAST_DUE' },
      });

      // Recompute effective tier — PAST_DUE drops out of the active set, so a
      // Stripe-only user falls to FREE while a user still covered by another
      // active provider sub keeps that tier (M6, cross-provider safe). Also
      // resnapshots chat quota (the pre-M6 path skipped this — now consistent
      // with the updated/deleted handlers).
      await this.entitlements.syncUserTier(existing.userId);
    }
  }

  // NOTE (M6): grantMonthlyCredits moved verbatim to EntitlementsService.
  // Renewals/creation now grant via entitlements.grantMonthlyCreditsForSubscription
  // (cross-provider governing-sub gate). test/monthly-credits.spec.ts follows it.

  // ============================================================
  // Private Helpers
  // ============================================================

  private async findUserOrThrow(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Get or create a Stripe customer for the user.
   * Stores the Stripe customer ID in the user's metadata.
   */
  private async getOrCreateStripeCustomer(
    userId: string,
    clerkUserId: string,
    name: string | null,
  ): Promise<string> {
    // Search Stripe by metadata for our user
    const searchResult = await this.stripe.customers.search({
      query: `metadata['clerkUserId']:'${clerkUserId}'`,
    });

    if (searchResult.data.length > 0) {
      return searchResult.data[0].id;
    }

    // Create new customer
    const customer = await this.stripe.customers.create({
      name: name || undefined,
      metadata: {
        clerkUserId,
        internalUserId: userId,
      },
    });

    this.logger.log(`Created Stripe customer ${customer.id} for user ${clerkUserId}`);
    return customer.id;
  }

  private async getStripeCustomerId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) return null;

    const searchResult = await this.stripe.customers.search({
      query: `metadata['clerkUserId']:'${user.clerkUserId}'`,
    });

    return searchResult.data.length > 0 ? searchResult.data[0].id : null;
  }

  private async handleSubscriptionCreated(
    session: Stripe.Checkout.Session,
    userId: string,
  ): Promise<void> {
    const planSlug = session.metadata?.planSlug || 'basic';
    const planTier = this.planSlugToTier(planSlug);
    const stripeSubId = typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription)?.id;

    if (!stripeSubId) {
      this.logger.error('No subscription ID in checkout session');
      return;
    }

    // Retrieve the full subscription to get period dates
    const stripeSub = await this.stripe.subscriptions.retrieve(stripeSubId);

    // In clover API, period dates are on subscription items, not the subscription itself
    const firstItem = stripeSub.items?.data?.[0];
    const periodStart = firstItem?.current_period_start
      ? new Date(firstItem.current_period_start * 1000)
      : new Date();
    const periodEnd = firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // default: 30 days from now

    // UPSERT, not create: `customer.subscription.updated` can arrive before this
    // handler (we don't subscribe to `customer.subscription.created`, so checkout
    // is our only create path) and may have written a provisional row first — see
    // handleSubscriptionUpdated. A bare create would throw P2002 here, and because
    // the Transaction write and the initial credit grant both come AFTER this
    // statement, the user would pay and receive ZERO credits, with Stripe retrying
    // the same failure for ~3 days.
    //
    // Deliberately NOT setting `status` in the update branch: on the happy path the
    // provisional row is already ACTIVE so it would be a no-op, but if this handler
    // 500s for an unrelated reason its Redis idempotency key is never set and Stripe
    // retries — and if the user cancelled in between, forcing ACTIVE would resurrect
    // a CANCELLED/EXPIRED subscription. Checkout stays authoritative for tier+period.
    try {
      await this.prisma.subscription.upsert({
        where: { stripeSubscriptionId: stripeSubId },
        create: {
          userId,
          stripeSubscriptionId: stripeSubId,
          planTier,
          status: 'ACTIVE',
          platform: 'STRIPE',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
        update: {
          planTier,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      });
    } catch (err) {
      // Prisma compiles this upsert to a native INSERT ... ON CONFLICT DO UPDATE
      // (single unique field in `where`, no nested writes), so it is atomic against
      // a concurrent insert. That is an optimization with preconditions, though — if
      // it ever falls back to find-then-write, a truly concurrent delivery yields
      // P2002 from the upsert itself, on the one path that MUST reach the Transaction
      // write and the credit grant below. Tolerate it: a conflict means the row exists.
      if (!isUniqueConstraintViolation(err)) throw err;
      this.logger.warn(
        `Subscription ${stripeSubId} already existed on upsert (concurrent delivery) — continuing`,
      );
    }

    // Recompute the user's effective tier from ALL active subs (M6) + resnapshot
    // chat quota. For a Stripe-only user this yields `planTier`; if they already
    // hold a higher Apple/Google sub, that higher tier is preserved.
    await this.entitlements.syncUserTier(userId);

    // Record the transaction.
    //
    // P2002-tolerant for the same reason as handleInvoicePaid: stripePaymentId is
    // @unique, and this write sits BETWEEN syncUserTier and the initial credit
    // grant. Making the subscription upsert above retry-safe was not enough on its
    // own — if any later step threw a transient error, the Redis idempotency key
    // was never set, Stripe retried, and this line then threw P2002 on every
    // retry, so `grantMonthlyCreditsForGoverningSub` below was never reached
    // again. The user ends up correctly tiered and ACTIVE (so the damage is
    // invisible at a glance) but never receives their initial credits, and even
    // manually resending the event replays the same collision.
    //
    // Continuing on conflict is safe HERE specifically because the grant that
    // follows is itself idempotent via the MonthlyCreditsLog unique key, so it
    // cannot double-grant. Do NOT copy this shape onto a raw credit increment
    // (see handleOneTimePayment) — there, continuing past the conflict would
    // hand out the credits twice.
    try {
      await this.prisma.transaction.create({
        data: {
          userId,
          stripePaymentId: session.payment_intent as string,
          amount: this.formatStripeAmount(session.amount_total || 0, session.currency || 'usd'),
          currency: (session.currency || 'usd').toUpperCase(),
          type: 'SUBSCRIPTION',
          description: `New subscription: ${planSlug}`,
          platform: 'STRIPE',
        },
      });
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
      this.logger.log(
        `Checkout payment ${session.payment_intent} already recorded — continuing to credit grant`,
      );
    }

    // Grant initial monthly credits for the user's GOVERNING active sub (M6
    // cross-provider dedup). Idempotent via MonthlyCreditsLog — a user who
    // already holds an earlier/higher governing sub granted this period won't
    // double-grant on this purchase.
    await this.entitlements.grantMonthlyCreditsForGoverningSub(userId);

    this.logger.log(`Subscription created for user ${userId}: ${planSlug} (${planTier})`);
  }

  private async handleOneTimePayment(
    session: Stripe.Checkout.Session,
    userId: string,
  ): Promise<void> {
    const metadata = session.metadata;

    if (metadata?.type === 'credit_package') {
      // Credit package purchase — grant credits from package
      const creditPackageId = metadata.creditPackageId;
      const creditAmount = parseInt(metadata.creditAmount || '0', 10);

      if (creditPackageId && creditAmount > 0) {
        // Verify package still exists and is active
        const pkg = await this.prisma.creditPackage.findUnique({
          where: { id: creditPackageId },
        });

        const actualAmount = (pkg && pkg.isActive) ? pkg.creditAmount : creditAmount;

        // ATOMIC: the Transaction row and the credit grant commit together or
        // not at all. Previously these were two independent writes, so if the
        // first committed and the second threw, the controller 500'd, the Redis
        // idempotency key was never set, Stripe retried, and this line then threw
        // P2002 on EVERY retry — the increment was never reached again and the
        // customer was left having paid for nothing.
        //
        // Catch-and-continue (as used on the invoice/checkout paths) is NOT an
        // option here: those are followed by a MonthlyCreditsLog-deduped grant,
        // whereas this is a raw increment. Continuing past the conflict would
        // turn "zero credits" into "double credits".
        //
        // With the two writes atomic, "row exists" now implies "credits granted",
        // which is what makes skipping on conflict safe.
        const idemKey = this.oneTimeIdempotencyKey(session);
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.transaction.create({
              data: {
                userId,
                stripePaymentId: idemKey,
                amount: this.formatStripeAmount(session.amount_total || 0, session.currency || 'usd'),
                currency: (session.currency || 'usd').toUpperCase(),
                type: 'CREDIT_PURCHASE',
                description: `Credit package: ${metadata.packageSlug || 'unknown'} (${actualAmount} credits)`,
                platform: 'STRIPE',
              },
            });
            await this.entitlements.grantCredits(
              userId,
              actualAmount,
              `stripe-credit-pack:${metadata.packageSlug || 'unknown'}:${idemKey}`,
              tx,
            );
          });
        } catch (err) {
          // A timeout (P2028) or any other error rethrows here: the whole unit
          // rolled back, so there is no partial state, and the retry is correct.
          if (!isUniqueConstraintViolation(err)) throw err;
          this.logger.log(`One-time payment ${idemKey} already processed — idempotent skip`);
          return;
        }

        this.logger.log(`Credit package purchased for user ${userId}: ${metadata.packageSlug} (+${actualAmount} credits)`);
      } else {
        // The customer WAS charged, but this session's metadata cannot produce a
        // grant. Previously this fell out of the function and returned 200, which
        // set the Redis idempotency key and stopped Stripe retrying — so the
        // purchase vanished with no row, no log and no error. That is the same
        // outcome as the race above and rather likelier, since it needs only a
        // data-shape mistake.
        //
        // Throw instead. It is not that a retry will fix malformed metadata —
        // it won't — but that acknowledging would POISON the recovery path:
        // the idempotency key makes a manual "Resend event" from the Stripe
        // dashboard a silent no-op for 48h. Failing keeps the event replayable
        // while a human fixes the underlying data.
        //
        // The upstream guard against the likeliest cause (a package saved with
        // creditAmount 0) is the @Min(1) validation on the admin routes, which
        // deliberately shipped before this.
        this.logger.error(
          `Credit-package session ${session.id} has unusable metadata ` +
            `(creditPackageId=${creditPackageId}, creditAmount=${metadata.creditAmount}) — ` +
            `customer was charged; refusing to ack so the event stays replayable`,
        );
        Sentry.captureMessage('stripe.credit_package_metadata_unusable', {
          level: 'error',
          extra: { sessionId: session.id, userId, metadata },
        });
        throw new Error(`Unusable credit_package metadata on session ${session.id}`);
      }
    } else {
      // Legacy: single reading purchase, increment by 1.
      // Same atomic treatment as the credit-package branch above. This branch
      // needs no metadata guard: the amount is hardcoded and an undefined
      // serviceSlug is already tolerated, so there is nothing here to malform.
      const serviceSlug = metadata?.serviceSlug;
      const idemKey = this.oneTimeIdempotencyKey(session);

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.transaction.create({
            data: {
              userId,
              stripePaymentId: idemKey,
              amount: this.formatStripeAmount(session.amount_total || 0, session.currency || 'usd'),
              currency: (session.currency || 'usd').toUpperCase(),
              type: 'ONE_TIME',
              description: serviceSlug ? `One-time reading: ${serviceSlug}` : 'One-time purchase',
              platform: 'STRIPE',
            },
          });
          await this.entitlements.grantCredits(
            userId,
            1,
            `stripe-one-time:${serviceSlug || 'purchase'}:${idemKey}`,
            tx,
          );
        });
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        this.logger.log(`One-time payment ${idemKey} already processed — idempotent skip`);
        return;
      }

      this.logger.log(`One-time payment recorded for user ${userId}: ${serviceSlug}`);
    }
  }

  /**
   * Idempotency key for a one-time checkout, stored in the UNIQUE
   * `Transaction.stripePaymentId`.
   *
   * Falls back to `session.id` because `payment_intent` can be absent, and a
   * UNIQUE constraint on a NULLable column permits unlimited NULLs — which would
   * silently disable the very guard this key exists to provide. `session.id` is
   * stable across retries of the same event and cannot collide with a real
   * payment_intent (disjoint `cs_` / `pi_` prefixes).
   *
   * The column is already polymorphic in practice: it also holds invoice ids and
   * the RevenueCat `rc-purchase:` / `rc-refund:` keys.
   */
  private oneTimeIdempotencyKey(session: Stripe.Checkout.Session): string {
    return (session.payment_intent as string | null) ?? session.id;
  }

  private async validateAndGetStripeCoupon(
    promoCode: string,
    _amountCents: number,
  ): Promise<{ stripeCouponId: string } | null> {
    // Validate promo code in our DB
    const promo = await this.prisma.promoCode.findFirst({
      where: {
        code: promoCode.toUpperCase(),
        isActive: true,
        validFrom: { lte: new Date() },
        validUntil: { gte: new Date() },
      },
    });

    if (!promo || promo.currentUses >= promo.maxUses) {
      return null;
    }

    // Atomically claim a use — prevents race condition where concurrent requests exceed maxUses
    const claimed = await this.prisma.promoCode.updateMany({
      where: {
        id: promo.id,
        currentUses: { lt: promo.maxUses },
        isActive: true,
      },
      data: { currentUses: { increment: 1 } },
    });

    if (claimed.count === 0) {
      return null; // Race condition: another request used the last slot
    }

    // Create a corresponding Stripe coupon (or reuse if already created)
    try {
      const couponId = `promo_${promo.code}`;

      // Try to retrieve existing coupon
      try {
        const existing = await this.stripe.coupons.retrieve(couponId);
        if (existing) {
          return { stripeCouponId: existing.id };
        }
      } catch {
        // Coupon doesn't exist, create it
      }

      const couponParams: Stripe.CouponCreateParams = {
        id: couponId,
        name: `Promo: ${promo.code}`,
        duration: 'once',
      };

      if (promo.discountType === 'PERCENTAGE') {
        couponParams.percent_off = Number(promo.discountValue);
      } else {
        couponParams.amount_off = Math.round(Number(promo.discountValue) * 100);
        couponParams.currency = 'usd';
      }

      const coupon = await this.stripe.coupons.create(couponParams);

      return { stripeCouponId: coupon.id };
    } catch (error) {
      // Rollback the usage count if Stripe coupon creation fails
      await this.prisma.promoCode.update({
        where: { id: promo.id },
        data: { currentUses: { decrement: 1 } },
      }).catch((e) => this.logger.error(`Failed to rollback promo use: ${e}`));
      this.logger.error(`Failed to create Stripe coupon for promo ${promoCode}: ${error}`);
      return null;
    }
  }

  private planSlugToTier(slug: string): 'FREE' | 'BASIC' | 'PRO' | 'MASTER' {
    const map: Record<string, 'FREE' | 'BASIC' | 'PRO' | 'MASTER'> = {
      basic: 'BASIC',
      pro: 'PRO',
      master: 'MASTER',
    };
    return map[slug] || 'FREE';
  }

  private mapStripeStatus(status: string): 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE' {
    const map: Record<string, 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE'> = {
      active: 'ACTIVE',
      canceled: 'CANCELLED',
      incomplete_expired: 'EXPIRED',
      past_due: 'PAST_DUE',
      unpaid: 'PAST_DUE',
    };
    return map[status] || 'ACTIVE';
  }

  // ============================================================
  // Invoice History
  // ============================================================

  /** Stripe zero-decimal currencies — amounts are NOT in cents.
   *  Full list from Stripe docs: https://docs.stripe.com/currencies#zero-decimal */
  private static readonly ZERO_DECIMAL_CURRENCIES = new Set([
    'bif','clp','djf','gnf','isk','jpy','kmf','krw','mga','pyg',
    'rwf','twd','ugx','vnd','vuv','xaf','xof','xpf',
  ]);

  /** Convert Stripe smallest-unit amount to human-readable amount */
  private formatStripeAmount(amount: number, currency: string): number {
    if (StripeService.ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())) {
      return amount; // JPY 1000 stays 1000, TWD 999 stays 999
    }
    return amount / 100; // USD 999 becomes 9.99
  }

  /** Validate that a URL is a legitimate Stripe-hosted URL */
  private validateStripeUrl(url: string | null): string | null {
    if (!url) return null;
    if (!/^https:\/\/[a-z-]+\.stripe\.com\//.test(url)) {
      this.logger.warn(`Invalid Stripe URL rejected: ${url}`);
      return null;
    }
    return url;
  }

  /**
   * Get Stripe invoice history for a user.
   * Returns empty array for free users with no Stripe customer.
   * Results cached in Redis for 5 minutes.
   */
  async getInvoices(clerkUserId: string, limit = 10): Promise<InvoiceItem[]> {
    const user = await this.findUserOrThrow(clerkUserId);
    const customerId = await this.getStripeCustomerId(user.id);
    if (!customerId) return []; // Free user, no Stripe customer

    const cacheKey = `invoices:${clerkUserId}:${limit}`;
    return this.redis.getOrSet<InvoiceItem[]>(cacheKey, 300, async () => {
      try {
        const invoices = await this.stripe.invoices.list({
          customer: customerId,
          limit: Math.min(limit, 24),
        });

        return invoices.data.map((inv) => ({
          id: inv.id,
          number: inv.number || null,
          date: new Date((inv.created || 0) * 1000).toISOString(),
          amountDue: this.formatStripeAmount(inv.amount_due || 0, inv.currency || 'usd'),
          amountPaid: this.formatStripeAmount(inv.amount_paid || 0, inv.currency || 'usd'),
          currency: (inv.currency || 'usd').toUpperCase(),
          status: inv.status || 'unknown',
          description: inv.lines?.data?.[0]?.description || inv.description || null,
          hostedInvoiceUrl: this.validateStripeUrl(inv.hosted_invoice_url || null),
          invoicePdf: this.validateStripeUrl(inv.invoice_pdf || null),
        }));
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(`[getInvoices] Stripe API error for user ${clerkUserId}: ${errMsg}`);
        throw new BadRequestException('無法取得帳單記錄，請稍後再試');
      }
    });
  }
}

// ============================================================
// Exported Types
// ============================================================

export interface InvoiceItem {
  id: string;
  number: string | null;
  date: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  description: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}
