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

  // ============ Subscription Status ============

  async getSubscriptionStatus(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      subscriptionTier: user.subscriptionTier,
      credits: user.credits,
      freeReadingUsed: user.freeReadingUsed,
      activeSubscription: activeSubscription
        ? {
            planTier: activeSubscription.planTier,
            platform: activeSubscription.platform,
            currentPeriodEnd: activeSubscription.currentPeriodEnd,
            status: activeSubscription.status,
          }
        : null,
    };
  }

  // ============ Transaction History ============

  async getTransactionHistory(clerkUserId: string, page = 1, limit = 20) {
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

  // ============ Placeholder for Phase 2 ============
  // Stripe checkout session creation
  // Stripe webhook handling
  // Apple IAP verification
  // Google Play verification
  // Credit purchase flow
}
