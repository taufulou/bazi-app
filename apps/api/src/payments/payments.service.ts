import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private prisma: PrismaService) {}

  // ============ Payment Gateways ============

  async getAvailableGateways(region?: string) {
    const where: Record<string, unknown> = { isActive: true };
    if (region) {
      where.region = region;
    }

    return this.prisma.paymentGateway.findMany({
      where,
      select: {
        id: true,
        provider: true,
        region: true,
        isActive: true,
      },
    });
  }

  // ============ Active Plans ============

  async getActivePlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        slug: true,
        nameZhTw: true,
        nameZhCn: true,
        priceMonthly: true,
        priceAnnual: true,
        currency: true,
        features: true,
        readingsPerMonth: true,
        monthlyCredits: true,
      },
    });
  }

  // ============ Credit Packages ============

  async getActiveCreditPackages() {
    return this.prisma.creditPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        slug: true,
        nameZhTw: true,
        nameZhCn: true,
        creditAmount: true,
        priceUsd: true,
        sortOrder: true,
      },
    });
  }

  // ============ Subscription Status ============

  async getSubscriptionStatus(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Find the most recent subscription that is still relevant
    // (ACTIVE or CANCELLED-but-not-yet-expired — user may want to reactivate)
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: { in: ['ACTIVE', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    // The STRIPE row the website's billing buttons act on (1B item 5), separate
    // from `activeSubscription` (newest row of any platform, for display): a user
    // holding a Stripe membership and a newer Apple one must keep the Stripe
    // controls. PAST_DUE included — that member needs the portal to fix the card.
    // CANCELLED only while its period runs: a stale CANCELLED row (lost
    // `subscription.deleted`, out-of-order `updated(canceled)`) would otherwise
    // offer a 重新啟用 that Stripe refuses.
    const stripeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: user.id,
        platform: 'STRIPE',
        OR: [
          { status: { in: ['ACTIVE', 'PAST_DUE'] } },
          { status: 'CANCELLED', currentPeriodEnd: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      subscriptionTier: user.subscriptionTier,
      credits: user.credits,
      stripeSubscription: stripeSubscription
        ? {
            planTier: stripeSubscription.planTier,
            platform: stripeSubscription.platform,
            currentPeriodStart: stripeSubscription.currentPeriodStart,
            currentPeriodEnd: stripeSubscription.currentPeriodEnd,
            status: stripeSubscription.status,
            cancelledAt: stripeSubscription.cancelledAt,
          }
        : null,
      activeSubscription: activeSubscription
        ? {
            planTier: activeSubscription.planTier,
            platform: activeSubscription.platform,
            currentPeriodStart: activeSubscription.currentPeriodStart,
            currentPeriodEnd: activeSubscription.currentPeriodEnd,
            status: activeSubscription.status,
            cancelledAt: activeSubscription.cancelledAt,
          }
        : null,
    };
  }

  // ============ Monthly Credits Status ============

  async getMonthlyCreditsStatus(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get active subscription for next reset date
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get the most recent monthly credit grant
    const latestGrant = await this.prisma.monthlyCreditsLog.findFirst({
      where: { userId: user.id },
      orderBy: { grantedAt: 'desc' },
    });

    return {
      currentPeriodCreditsGranted: latestGrant?.creditAmount ?? 0,
      creditsRemaining: user.credits,
      nextResetDate: activeSubscription?.currentPeriodEnd ?? null,
      lastGrantDate: latestGrant?.grantedAt ?? null,
      periodStart: latestGrant?.periodStart ?? null,
      periodEnd: latestGrant?.periodEnd ?? null,
    };
  }

  // ============ Transaction History ============

  async getTransactionHistory(clerkUserId: string, page = 1, limit = 20) {
    limit = Math.min(Math.max(limit, 1), 100); // Clamp to 1-100
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where: { userId: user.id } }),
    ]);

    return {
      data: transactions,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

}
