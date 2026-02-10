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

  // ============================================================
  // Free Reading Tracking
  // ============================================================

  /**
   * Check if user can use a free reading.
   */
  async canUseFreeReading(clerkUserId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) return false;
    return !user.freeReadingUsed;
  }

  /**
   * Mark free reading as used.
   */
  async markFreeReadingUsed(clerkUserId: string): Promise<void> {
    await this.prisma.user.update({
      where: { clerkUserId },
      data: { freeReadingUsed: true },
    });
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
    }

    // Update user's subscription tier
    await this.prisma.user.update({
      where: { id: internalUserId },
      data: {
        subscriptionTier: status === 'ACTIVE' ? planTier : 'FREE',
      },
    });

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

    // Downgrade user to FREE
    await this.prisma.user.update({
      where: { id: internalUserId },
      data: { subscriptionTier: 'FREE' },
    });

    this.logger.log(`Subscription ${sub.id} deleted — user ${internalUserId} downgraded to FREE`);
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

    // Record the transaction (use invoice.id as payment reference since payment_intent is no longer a direct property)
    await this.prisma.transaction.create({
      data: {
        userId: sub.userId,
        stripePaymentId: invoice.id,
        amount: (invoice.amount_paid || 0) / 100,
        currency: (invoice.currency || 'usd').toUpperCase(),
        type: 'SUBSCRIPTION',
        description: `Subscription payment — ${invoice.lines?.data?.[0]?.description || 'renewal'}`,
        platform: 'STRIPE',
      },
    });
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

      // Update user tier to reflect payment issue
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: { subscriptionTier: 'FREE' },
      });
    }
  }

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

    // Create subscription record
    await this.prisma.subscription.create({
      data: {
        userId,
        stripeSubscriptionId: stripeSubId,
        planTier,
        status: 'ACTIVE',
        platform: 'STRIPE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });

    // Update user's subscription tier
    await this.prisma.user.update({
      where: { id: userId },
      data: { subscriptionTier: planTier },
    });

    // Record the transaction
    await this.prisma.transaction.create({
      data: {
        userId,
        stripePaymentId: session.payment_intent as string,
        amount: (session.amount_total || 0) / 100,
        currency: (session.currency || 'usd').toUpperCase(),
        type: 'SUBSCRIPTION',
        description: `New subscription: ${planSlug}`,
        platform: 'STRIPE',
      },
    });

    this.logger.log(`Subscription created for user ${userId}: ${planSlug} (${planTier})`);
  }

  private async handleOneTimePayment(
    session: Stripe.Checkout.Session,
    userId: string,
  ): Promise<void> {
    const serviceSlug = session.metadata?.serviceSlug;

    // Record the transaction
    await this.prisma.transaction.create({
      data: {
        userId,
        stripePaymentId: session.payment_intent as string,
        amount: (session.amount_total || 0) / 100,
        currency: (session.currency || 'usd').toUpperCase(),
        type: 'ONE_TIME',
        description: serviceSlug ? `One-time reading: ${serviceSlug}` : 'One-time purchase',
        platform: 'STRIPE',
      },
    });

    // Add credits to user (1 credit per reading purchase)
    await this.prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: 1 } },
    });

    this.logger.log(`One-time payment recorded for user ${userId}: ${serviceSlug}`);
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
}
