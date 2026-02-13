import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { READING_TYPE_TIERS, TIER_ORDER, TIER_LABELS, type ReadingCostTier } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';
import { UpdateGatewayDto } from './dto/update-gateway.dto';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ============ Services Management ============

  async listServices() {
    return this.prisma.service.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async updateService(id: string, data: UpdateServiceDto, adminUserId: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Service not found');

    const updated = await this.prisma.service.update({ where: { id }, data });

    await this.logAudit(adminUserId, 'update_service', 'service', id, service, updated);
    await this.redis.del('services:active');

    return updated;
  }

  // ============ Plans Management ============

  async listPlans() {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async updatePlan(id: string, data: UpdatePlanDto, adminUserId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');

    const updated = await this.prisma.plan.update({ where: { id }, data });

    await this.logAudit(adminUserId, 'update_plan', 'plan', id, plan, updated);
    await this.redis.del('plans:active');

    return updated;
  }

  // ============ Promo Codes ============

  async listPromoCodes() {
    return this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createPromoCode(data: CreatePromoCodeDto, adminUserId: string) {
    const promo = await this.prisma.promoCode.create({
      data: {
        code: data.code,
        discountType: data.discountType,
        discountValue: data.discountValue,
        maxUses: data.maxUses,
        validFrom: new Date(data.validFrom),
        validUntil: new Date(data.validUntil),
        isActive: data.isActive ?? true,
      },
    });

    await this.logAudit(adminUserId, 'create_promo_code', 'promo_code', promo.id, null, promo);

    return promo;
  }

  async updatePromoCode(id: string, data: UpdatePromoCodeDto, adminUserId: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Promo code not found');

    const updateData: Record<string, unknown> = {};
    if (data.discountType !== undefined) updateData.discountType = data.discountType;
    if (data.discountValue !== undefined) updateData.discountValue = data.discountValue;
    if (data.maxUses !== undefined) updateData.maxUses = data.maxUses;
    if (data.validFrom !== undefined) updateData.validFrom = new Date(data.validFrom);
    if (data.validUntil !== undefined) updateData.validUntil = new Date(data.validUntil);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updated = await this.prisma.promoCode.update({ where: { id }, data: updateData });

    await this.logAudit(adminUserId, 'update_promo_code', 'promo_code', id, promo, updated);

    return updated;
  }

  async validatePromoCode(code: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { code } });

    if (!promo) throw new NotFoundException('Promo code not found');

    const now = new Date();
    const isValid =
      promo.isActive &&
      promo.currentUses < promo.maxUses &&
      now >= promo.validFrom &&
      now <= promo.validUntil;

    return {
      valid: isValid,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      ...(isValid ? {} : { reason: 'Promo code is expired or fully redeemed' }),
    };
  }

  // ============ Prompt Templates ============

  async listPromptTemplates() {
    return this.prisma.promptTemplate.findMany({
      orderBy: [{ readingType: 'asc' }, { aiProvider: 'asc' }, { version: 'desc' }],
    });
  }

  async updatePromptTemplate(id: string, data: UpdatePromptTemplateDto, adminUserId: string) {
    const template = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Prompt template not found');

    const updated = await this.prisma.promptTemplate.update({ where: { id }, data });

    await this.logAudit(adminUserId, 'update_prompt_template', 'prompt_template', id, template, updated);

    return updated;
  }

  // ============ Payment Gateways ============

  async listGateways() {
    return this.prisma.paymentGateway.findMany({
      orderBy: [{ region: 'asc' }, { provider: 'asc' }],
    });
  }

  async updateGateway(id: string, data: UpdateGatewayDto, adminUserId: string) {
    const gateway = await this.prisma.paymentGateway.findUnique({ where: { id } });
    if (!gateway) throw new NotFoundException('Payment gateway not found');

    const updateData: Record<string, unknown> = {};
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.config !== undefined) updateData.config = data.config;

    const updated = await this.prisma.paymentGateway.update({ where: { id }, data: updateData });

    await this.logAudit(adminUserId, 'update_gateway', 'payment_gateway', id, gateway, updated);

    return updated;
  }

  // ============ User Management ============

  async listUsers(page = 1, limit = 20, search?: string) {
    limit = Math.min(Math.max(limit, 1), 100); // Clamp to 1-100
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { clerkUserId: search },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              baziReadings: true,
              subscriptions: true,
              transactions: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' } },
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            amount: true,
            currency: true,
            type: true,
            description: true,
            platform: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            baziReadings: true,
            baziComparisons: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async adjustUserCredits(userId: string, data: AdjustCreditsDto, adminUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const newCredits = user.credits + data.amount;
    if (newCredits < 0) {
      throw new BadRequestException(
        `Cannot adjust: user has ${user.credits} credits, adjustment of ${data.amount} would result in ${newCredits}`,
      );
    }

    // Atomic transaction: update credits + create audit log
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { credits: newCredits },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'adjust_credits',
          entityType: 'user',
          entityId: userId,
          oldValue: { credits: user.credits } as Prisma.InputJsonValue,
          newValue: { credits: newCredits, amount: data.amount, reason: data.reason } as Prisma.InputJsonValue,
        },
      }),
    ]);

    return updated;
  }

  // ============ Analytics ============

  async getDashboardStats() {
    const [
      totalUsers,
      totalReadings,
      totalComparisons,
      recentUsers,
      readingsByType,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.baziReading.count(),
      this.prisma.baziComparison.count(),
      this.prisma.user.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.baziReading.groupBy({
        by: ['readingType'],
        _count: { id: true },
      }),
    ]);

    return {
      totalUsers,
      totalReadings,
      totalComparisons,
      recentUsers7d: recentUsers,
      readingsByType: readingsByType.map((r) => ({
        type: r.readingType,
        count: r._count.id,
      })),
    };
  }

  async getAICosts(days = 30) {
    // Clamp days to 1-365
    days = Math.max(1, Math.min(365, days));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const [summary, costByProvider, dailyCosts, costByReadingType] = await Promise.all([
        // Summary stats
        this.prisma.aIUsageLog.aggregate({
          where: { createdAt: { gte: sinceDate } },
          _sum: { inputTokens: true, outputTokens: true },
          _count: { id: true },
        }),
        // Cost by provider using raw SQL for Decimal aggregation
        this.prisma.$queryRaw<Array<{
          ai_provider: string;
          total_cost: number;
          count: bigint;
          avg_cost: number;
          total_input_tokens: bigint;
          total_output_tokens: bigint;
        }>>`
          SELECT
            ai_provider,
            SUM(cost_usd)::float as total_cost,
            COUNT(*) as count,
            AVG(cost_usd)::float as avg_cost,
            SUM(input_tokens)::bigint as total_input_tokens,
            SUM(output_tokens)::bigint as total_output_tokens
          FROM ai_usage_log
          WHERE created_at >= ${sinceDate}
          GROUP BY ai_provider
          ORDER BY total_cost DESC
        `,
        // Daily costs using DATE_TRUNC
        this.prisma.$queryRaw<Array<{ day: Date; total_cost: number; count: bigint }>>`
          SELECT DATE_TRUNC('day', created_at) as day, SUM(cost_usd)::float as total_cost, COUNT(*) as count
          FROM ai_usage_log
          WHERE created_at >= ${sinceDate}
          GROUP BY DATE_TRUNC('day', created_at)
          ORDER BY day ASC
        `,
        // Cost by reading type
        this.prisma.$queryRaw<Array<{
          reading_type: string | null;
          total_cost: number;
          count: bigint;
          avg_cost: number;
          avg_input_tokens: number;
          avg_output_tokens: number;
          total_input_tokens: bigint;
          total_output_tokens: bigint;
          avg_latency_ms: number;
          cache_hit_count: bigint;
        }>>`
          SELECT
            reading_type,
            SUM(cost_usd)::float as total_cost,
            COUNT(*) as count,
            AVG(cost_usd)::float as avg_cost,
            AVG(input_tokens)::float as avg_input_tokens,
            AVG(output_tokens)::float as avg_output_tokens,
            SUM(input_tokens)::bigint as total_input_tokens,
            SUM(output_tokens)::bigint as total_output_tokens,
            AVG(latency_ms)::float as avg_latency_ms,
            SUM(CASE WHEN is_cache_hit THEN 1 ELSE 0 END)::bigint as cache_hit_count
          FROM ai_usage_log
          WHERE created_at >= ${sinceDate}
          GROUP BY reading_type
          ORDER BY total_cost DESC
        `,
      ]);

      // Calculate totals and cache hit rate
      const totalCost = costByProvider.reduce((sum, p) => sum + (p.total_cost || 0), 0);
      const totalCount = summary._count.id;

      const cacheHits = await this.prisma.aIUsageLog.count({
        where: { createdAt: { gte: sinceDate }, isCacheHit: true },
      });

      // Build costByReadingType array
      const costByReadingTypeResult = costByReadingType.map((r) => {
        const readingType = r.reading_type || 'UNCLASSIFIED';
        const count = Number(r.count);
        return {
          readingType,
          totalCost: r.total_cost || 0,
          count,
          avgCost: r.avg_cost || 0,
          avgInputTokens: Math.round(r.avg_input_tokens || 0),
          avgOutputTokens: Math.round(r.avg_output_tokens || 0),
          totalInputTokens: Number(r.total_input_tokens || 0),
          totalOutputTokens: Number(r.total_output_tokens || 0),
          avgLatencyMs: Math.round(r.avg_latency_ms || 0),
          cacheHitRate: count > 0 ? Number(r.cache_hit_count || 0) / count : 0,
        };
      });

      // Aggregate into tiers
      const tierMap = new Map<ReadingCostTier, {
        readingTypes: string[];
        totalCost: number;
        count: number;
      }>();

      for (const row of costByReadingTypeResult) {
        const tierInfo = READING_TYPE_TIERS[row.readingType];
        const tier: ReadingCostTier = tierInfo?.tier || 'unclassified';

        const existing = tierMap.get(tier);
        if (existing) {
          existing.readingTypes.push(row.readingType);
          existing.totalCost += row.totalCost;
          existing.count += row.count;
        } else {
          tierMap.set(tier, {
            readingTypes: [row.readingType],
            totalCost: row.totalCost,
            count: row.count,
          });
        }
      }

      const costByTier = TIER_ORDER
        .filter((tier) => tierMap.has(tier))
        .map((tier) => {
          const data = tierMap.get(tier)!;
          return {
            tier,
            label: TIER_LABELS[tier],
            readingTypes: data.readingTypes,
            totalCost: data.totalCost,
            count: data.count,
            avgCost: data.count > 0 ? data.totalCost / data.count : 0,
          };
        });

      return {
        days,
        totalCost: totalCost,
        avgCostPerReading: totalCount > 0 ? totalCost / totalCount : 0,
        totalTokens: (summary._sum.inputTokens || 0) + (summary._sum.outputTokens || 0),
        totalInputTokens: summary._sum.inputTokens || 0,
        totalOutputTokens: summary._sum.outputTokens || 0,
        totalRequests: totalCount,
        cacheHitRate: totalCount > 0 ? cacheHits / totalCount : 0,
        costByProvider: costByProvider.map((p) => ({
          provider: p.ai_provider,
          totalCost: p.total_cost || 0,
          count: Number(p.count),
          avgCost: p.avg_cost || 0,
          totalInputTokens: Number(p.total_input_tokens || 0),
          totalOutputTokens: Number(p.total_output_tokens || 0),
        })),
        costByReadingType: costByReadingTypeResult,
        costByTier,
        dailyCosts: dailyCosts.map((d) => ({
          date: d.day,
          totalCost: d.total_cost || 0,
          count: Number(d.count),
        })),
      };
    } catch (err) {
      this.logger.error(`Failed to fetch AI costs: ${err instanceof Error ? err.message : err}`);
      return {
        days,
        totalCost: 0,
        avgCostPerReading: 0,
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequests: 0,
        cacheHitRate: 0,
        costByProvider: [],
        costByReadingType: [],
        costByTier: [],
        dailyCosts: [],
      };
    }
  }

  async getRevenue() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    try {
      const [totalRevenue, monthlyRevenue, activeSubscriptions] = await Promise.all([
        // Total revenue last 30 days
        this.prisma.$queryRaw<Array<{ total: number }>>`
          SELECT COALESCE(SUM(amount), 0)::float as total
          FROM transactions
          WHERE created_at >= ${thirtyDaysAgo} AND type != 'REFUND'
        `,
        // Revenue by month
        this.prisma.$queryRaw<Array<{ month: Date; total: number; count: bigint }>>`
          SELECT DATE_TRUNC('month', created_at) as month, SUM(amount)::float as total, COUNT(*) as count
          FROM transactions
          WHERE type != 'REFUND'
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month DESC
          LIMIT 12
        `,
        // Active subscriptions by tier
        this.prisma.subscription.groupBy({
          by: ['planTier'],
          where: { status: 'ACTIVE' },
          _count: { id: true },
        }),
      ]);

      return {
        totalRevenue30d: totalRevenue[0]?.total || 0,
        monthlyRevenue: monthlyRevenue.map((m) => ({
          month: m.month,
          total: m.total || 0,
          count: Number(m.count),
        })),
        activeSubscriptions: activeSubscriptions.map((s) => ({
          tier: s.planTier,
          count: s._count.id,
        })),
      };
    } catch (err) {
      this.logger.error(`Failed to fetch revenue: ${err instanceof Error ? err.message : err}`);
      return {
        totalRevenue30d: 0,
        monthlyRevenue: [],
        activeSubscriptions: [],
      };
    }
  }

  // ============ Audit Log ============

  async getAuditLog(page = 1, limit = 50) {
    limit = Math.min(Math.max(limit, 1), 100); // Clamp to 1-100
    const [logs, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminAuditLog.count(),
    ]);

    return {
      data: logs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private async logAudit(
    adminUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        entityType,
        entityId,
        oldValue: oldValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
      },
    });
  }
}
