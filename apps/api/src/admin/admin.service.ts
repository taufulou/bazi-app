import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';
import { UpdateGatewayDto } from './dto/update-gateway.dto';
import { AdjustCreditsDto } from './dto/adjust-credits.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';

// ---- Inlined from @repo/shared (NestJS cannot import @repo/shared at runtime — see CLAUDE.md) ----
// IMPORTANT: If you add new reading types to the Prisma enum, update BOTH
// this file AND packages/shared/src/constants.ts to keep them in sync.

type ReadingCostTier = 'comprehensive' | 'periodic' | 'daily' | 'qa' | 'unclassified';

const READING_TYPE_TIERS: Record<string, { tier: ReadingCostTier; label: string }> = {
  LIFETIME:           { tier: 'comprehensive', label: 'Bazi Lifetime' },
  CAREER:             { tier: 'comprehensive', label: 'Bazi Career' },
  LOVE:               { tier: 'comprehensive', label: 'Bazi Love' },
  HEALTH:             { tier: 'comprehensive', label: 'Bazi Health' },
  COMPATIBILITY:      { tier: 'comprehensive', label: 'Bazi Compatibility' },
  ZWDS_LIFETIME:      { tier: 'comprehensive', label: 'ZWDS Lifetime' },
  ZWDS_CAREER:        { tier: 'comprehensive', label: 'ZWDS Career' },
  ZWDS_LOVE:          { tier: 'comprehensive', label: 'ZWDS Love' },
  ZWDS_HEALTH:        { tier: 'comprehensive', label: 'ZWDS Health' },
  ZWDS_COMPATIBILITY: { tier: 'comprehensive', label: 'ZWDS Compatibility' },
  ZWDS_MAJOR_PERIOD:  { tier: 'comprehensive', label: 'ZWDS Major Period' },
  ANNUAL:             { tier: 'periodic', label: 'Bazi Annual' },
  ZWDS_ANNUAL:        { tier: 'periodic', label: 'ZWDS Annual' },
  ZWDS_MONTHLY:       { tier: 'periodic', label: 'ZWDS Monthly' },
  ZWDS_DAILY:         { tier: 'daily', label: 'ZWDS Daily' },
  ZWDS_QA:            { tier: 'qa', label: 'ZWDS Q&A' },
};

const TIER_ORDER: ReadingCostTier[] = [
  'comprehensive', 'periodic', 'daily', 'qa', 'unclassified',
];

const TIER_LABELS: Record<ReadingCostTier, string> = {
  comprehensive: 'Comprehensive',
  periodic: 'Periodic',
  daily: 'Daily',
  qa: 'Q&A',
  unclassified: 'Unclassified',
};

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

  // ============================================================
  // Chat aggregate metrics (Phase 1.10)
  //
  // Returns aggregate-only metrics — no message contents, no user-specific
  // drill-down. PDPA-compliant for Phase 1; drill-down deferred to Phase 2
  // with audit log + TOS update per the plan.
  // ============================================================

  /** Mirrors CHAT_SESSION_HARD_CAP_MESSAGES from chat-payment.service.ts /
   *  @repo/shared. Inlined here to avoid cross-module imports (NestJS
   *  cannot import @repo/shared at runtime — see CLAUDE.md). Keep in sync. */
  private static readonly CHAT_SESSION_HARD_CAP_MESSAGES = 30;

  /** Anthropic pricing constants for Claude Sonnet 4.x at 1h TTL ephemeral
   *  cache (per the plan's cost analysis). USD per million tokens.
   *  - Cache write at 1h TTL: 2× regular input rate ($3 × 2 = $6)
   *  - Cache read: 0.1× regular input rate ($3 × 0.1 = $0.30)
   *  - Regular input: $3
   *  - Output: $15
   *  Update if Anthropic pricing or model changes. */
  private static readonly USD_PER_MTOK_CACHE_WRITE_1H = 6;
  private static readonly USD_PER_MTOK_CACHE_READ = 0.3;
  private static readonly USD_PER_MTOK_INPUT_REGULAR = 3;
  private static readonly USD_PER_MTOK_OUTPUT = 15;

  async getChatAggregate() {
    const now = new Date();
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startOfMonthUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    // Run all aggregations in parallel.
    const [
      totalSessions,
      sessionsLast7Days,
      sessionsLast24Hours,
      sessionsAtHardCap,
      sessionsExtendedAgg,
      messageAggregates,
      messagesByRole,
      refundedMessages,
      validatorAggregates,
      tokenAggregates,
      llmJudgeBreakdown,
      monthlyUsageByTier,
      sessionsLast7DaysWithMessages,
    ] = await Promise.all([
      // Sessions
      this.prisma.chatSession.count(),
      this.prisma.chatSession.count({ where: { startedAt: { gte: since7d } } }),
      this.prisma.chatSession.count({ where: { startedAt: { gte: since24h } } }),
      this.prisma.chatSession.count({
        where: {
          messageCount: { gte: AdminService.CHAT_SESSION_HARD_CAP_MESSAGES },
        },
      }),
      this.prisma.chatSession.aggregate({
        _sum: { creditExtensions: true },
        _count: { id: true },
        where: { creditExtensions: { gt: 0 } },
      }),
      this.prisma.chatSession.aggregate({
        _avg: { messageCount: true },
      }),
      // Messages by role (all roles tracked, then split below).
      this.prisma.chatMessage.groupBy({
        by: ['role'],
        _count: { id: true },
      }),
      // Refunded messages — refundedAt IS NOT NULL captures all refund cases.
      this.prisma.chatMessage.count({ where: { refundedAt: { not: null } } }),
      // Validator stats: bannedPhraseStripped + citationAutoPrepended.
      this.prisma.chatMessage.aggregate({
        _count: { id: true },
        where: {
          OR: [
            { bannedPhraseStripped: true },
            { citationAutoPrepended: true },
          ],
        },
      }),
      // Cache token totals (Phase 1.6).
      this.prisma.chatMessage.aggregate({
        _sum: {
          cacheReadTokens: true,
          cacheCreationTokens: true,
          tokensInput: true,
          tokensOutput: true,
        },
      }),
      // LLM-judge verdict breakdown (5% sampling in prod).
      this.prisma.chatMessage.groupBy({
        by: ['llmJudgeVerdict'],
        _count: { id: true },
        where: { llmJudgeVerdict: { not: null } },
      }),
      // Monthly usage by subscription tier (current month).
      this.prisma.chatMonthlyUsage.groupBy({
        by: ['subscriptionTier'],
        _sum: { chatsUsed: true },
        _count: { id: true },
        where: { periodStart: startOfMonthUTC },
      }),
      // Phase 1.11 — sessions started in last 7 days with their message
      // token counts, for per-bucket avg-cost computation. We bucket in
      // JS by messageCount (1-10 / 11-20 / 21-30) — Prisma's groupBy
      // doesn't support custom range bucketing. 7-day window keeps the
      // result set bounded; if scale grows beyond ~10k sessions/week,
      // move to a daily cron that materializes the buckets.
      this.prisma.chatSession.findMany({
        where: { startedAt: { gte: since7d } },
        select: {
          messageCount: true,
          messages: {
            select: {
              cacheReadTokens: true,
              cacheCreationTokens: true,
              tokensInput: true,
              tokensOutput: true,
            },
          },
        },
      }),
    ]);
    // NOTE: contextDriftedSessions metric was removed in the Phase 1.10
    // post-ship audit — `CONTEXT_VERSION_DRIFTED` is never persisted on
    // ChatMessage rows (drift is checked BEFORE message creation in both
    // sync and stream paths), so the previous query always returned 0.
    // Tracking deferred to Phase 2 — needs either a new schema field
    // (e.g. ChatSession.driftDetectedAt) or admin-side current-version
    // lookup via injected ChatContextService.

    // Split message counts by role (groupBy returns an array of buckets).
    const userMessages = messagesByRole.find((r) => r.role === 'USER')?._count.id ?? 0;
    const assistantMessages =
      messagesByRole.find((r) => r.role === 'ASSISTANT')?._count.id ?? 0;
    const systemMessages =
      messagesByRole.find((r) => r.role === 'SYSTEM')?._count.id ?? 0;
    const totalMessages = userMessages + assistantMessages + systemMessages;

    // Refund rate = refunded user messages / total user messages. Refunds
    // are issued one-per-failed-turn (refundLastMessage in
    // chat-payment.service.ts), so one user message gets refundedAt set per
    // refund event.
    const refundRate =
      userMessages > 0 ? refundedMessages / userMessages : 0;

    // Validator counts.
    const validatorTotal = validatorAggregates._count.id;

    // LLM-judge verdicts.
    const llmJudgePass =
      llmJudgeBreakdown.find((b) => b.llmJudgeVerdict === 'pass')?._count.id ?? 0;
    const llmJudgeFail =
      llmJudgeBreakdown.find((b) => b.llmJudgeVerdict === 'fail')?._count.id ?? 0;
    const llmJudgeSampled = llmJudgePass + llmJudgeFail;
    const llmJudgeFailRate =
      llmJudgeSampled > 0 ? llmJudgeFail / llmJudgeSampled : 0;

    // Cache hit rate = cacheRead / (cacheRead + cacheCreation).
    const cacheRead = tokenAggregates._sum.cacheReadTokens ?? 0;
    const cacheCreation = tokenAggregates._sum.cacheCreationTokens ?? 0;
    const cacheTotal = cacheRead + cacheCreation;
    const cacheHitRate = cacheTotal > 0 ? cacheRead / cacheTotal : 0;

    // Phase 1.11 — bucket 7-day sessions by messageCount and compute avg
    // per-session cost in each bucket. Per the plan's cost watchdog
    // section: alert thresholds vary by bucket (long sessions cost more
    // because history tokens scale with each turn).
    type Bucket = '1-10' | '11-20' | '21-30';
    const bucketsAccum: Record<Bucket, { count: number; totalCostUsd: number }> = {
      '1-10': { count: 0, totalCostUsd: 0 },
      '11-20': { count: 0, totalCostUsd: 0 },
      '21-30': { count: 0, totalCostUsd: 0 },
    };
    for (const session of sessionsLast7DaysWithMessages) {
      // Skip sessions with no messages — they contribute no cost data.
      if (session.messageCount === 0 || session.messages.length === 0) continue;
      let costUsd = 0;
      for (const m of session.messages) {
        costUsd +=
          ((m.cacheCreationTokens ?? 0) *
            AdminService.USD_PER_MTOK_CACHE_WRITE_1H) /
          1_000_000;
        costUsd +=
          ((m.cacheReadTokens ?? 0) * AdminService.USD_PER_MTOK_CACHE_READ) /
          1_000_000;
        costUsd +=
          ((m.tokensInput ?? 0) * AdminService.USD_PER_MTOK_INPUT_REGULAR) /
          1_000_000;
        costUsd +=
          ((m.tokensOutput ?? 0) * AdminService.USD_PER_MTOK_OUTPUT) /
          1_000_000;
      }
      const bucket: Bucket =
        session.messageCount <= 10
          ? '1-10'
          : session.messageCount <= 20
            ? '11-20'
            : '21-30';
      bucketsAccum[bucket].count += 1;
      bucketsAccum[bucket].totalCostUsd += costUsd;
    }
    const costByBucket = (Object.keys(bucketsAccum) as Bucket[]).map(
      (range) => {
        const b = bucketsAccum[range];
        return {
          range,
          sessionCount: b.count,
          avgCostUsd: b.count > 0 ? b.totalCostUsd / b.count : 0,
          totalCostUsd: b.totalCostUsd,
        };
      },
    );

    return {
      generatedAt: now.toISOString(),
      sessions: {
        total: totalSessions,
        last7Days: sessionsLast7Days,
        last24Hours: sessionsLast24Hours,
        atHardCap: sessionsAtHardCap,
        extended: sessionsExtendedAgg._count.id,
        avgMessagesPerSession: messageAggregates._avg.messageCount ?? 0,
      },
      messages: {
        total: totalMessages,
        user: userMessages,
        assistant: assistantMessages,
        system: systemMessages,
        refunded: refundedMessages,
        refundRate,
      },
      validators: {
        bannedPhraseOrCitationAutoFixed: validatorTotal,
        llmJudgeSampled,
        llmJudgeFail,
        llmJudgeFailRate,
      },
      tokens: {
        totalInput: tokenAggregates._sum.tokensInput ?? 0,
        totalOutput: tokenAggregates._sum.tokensOutput ?? 0,
        totalCacheRead: cacheRead,
        totalCacheCreation: cacheCreation,
        cacheHitRate,
      },
      monthly: {
        periodStart: startOfMonthUTC.toISOString(),
        byTier: monthlyUsageByTier.map((t) => ({
          tier: t.subscriptionTier,
          activeUsers: t._count.id,
          totalChatsUsed: t._sum.chatsUsed ?? 0,
        })),
      },
      extensions: {
        sessionsExtendedCount: sessionsExtendedAgg._count.id,
        totalCreditsSpent: sessionsExtendedAgg._sum.creditExtensions ?? 0,
      },
      // Phase 1.11 — 7-day rolling cost breakdown by session-length bucket.
      costByBucket: {
        windowDays: 7,
        buckets: costByBucket,
      },
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

  // ============ Credit Packages Management ============

  async listCreditPackages() {
    return this.prisma.creditPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async createCreditPackage(
    data: { slug: string; nameZhTw: string; nameZhCn: string; creditAmount: number; priceUsd: number; isActive?: boolean; sortOrder?: number },
    adminUserId: string,
  ) {
    const existing = await this.prisma.creditPackage.findUnique({ where: { slug: data.slug } });
    if (existing) throw new BadRequestException(`Credit package with slug "${data.slug}" already exists`);

    const pkg = await this.prisma.creditPackage.create({
      data: {
        slug: data.slug,
        nameZhTw: data.nameZhTw,
        nameZhCn: data.nameZhCn,
        creditAmount: data.creditAmount,
        priceUsd: data.priceUsd,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    await this.logAudit(adminUserId, 'create_credit_package', 'credit_package', pkg.id, null, pkg);
    await this.redis.del('credit_packages:active');

    return pkg;
  }

  async updateCreditPackage(
    id: string,
    data: { nameZhTw?: string; nameZhCn?: string; creditAmount?: number; priceUsd?: number; isActive?: boolean; sortOrder?: number },
    adminUserId: string,
  ) {
    const pkg = await this.prisma.creditPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Credit package not found');

    const updated = await this.prisma.creditPackage.update({ where: { id }, data });

    await this.logAudit(adminUserId, 'update_credit_package', 'credit_package', id, pkg, updated);
    await this.redis.del('credit_packages:active');

    return updated;
  }

  // ============ Monetization Analytics ============

  async getMonetizationAnalytics(days = 30) {
    days = Math.max(1, Math.min(365, days));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const [
        // Credit package purchases
        creditPackagePurchases,
        // Ad reward claims
        adRewardClaims,
        adRewardDaily,
        // Section unlock stats
        sectionUnlockStats,
        // Subscription metrics
        activeSubscriptions,
        newSubscriptions,
        cancelledSubscriptions,
        // Conversion funnel
        totalUsers,
        usersWithReadings,
        // Revenue breakdown
        revenueByType,
      ] = await Promise.all([
        // Credit package purchases (from transactions with type=CREDIT_PURCHASE)
        this.prisma.$queryRaw<Array<{
          description: string | null;
          total_revenue: number;
          count: bigint;
          avg_amount: number;
        }>>`
          SELECT
            description,
            SUM(amount)::float as total_revenue,
            COUNT(*) as count,
            AVG(amount)::float as avg_amount
          FROM transactions
          WHERE type = 'CREDIT_PURCHASE' AND created_at >= ${sinceDate}
          GROUP BY description
          ORDER BY total_revenue DESC
        `,

        // Ad reward claims by type
        this.prisma.adRewardLog.groupBy({
          by: ['rewardType'],
          where: { createdAt: { gte: sinceDate } },
          _count: { id: true },
          _sum: { creditsGranted: true },
        }),

        // Ad reward daily trend
        this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
          SELECT DATE_TRUNC('day', created_at) as day, COUNT(*) as count
          FROM ad_reward_logs
          WHERE created_at >= ${sinceDate}
          GROUP BY DATE_TRUNC('day', created_at)
          ORDER BY day ASC
        `,

        // Section unlock stats by sectionKey
        this.prisma.sectionUnlock.groupBy({
          by: ['sectionKey'],
          where: { createdAt: { gte: sinceDate } },
          _count: { id: true },
        }),

        // Active subscriptions by tier
        this.prisma.subscription.groupBy({
          by: ['planTier'],
          where: { status: 'ACTIVE' },
          _count: { id: true },
        }),

        // New subscriptions in period
        this.prisma.subscription.count({
          where: { createdAt: { gte: sinceDate } },
        }),

        // Cancelled subscriptions in period
        this.prisma.subscription.count({
          where: { cancelledAt: { gte: sinceDate } },
        }),

        // Total users (funnel)
        this.prisma.user.count(),

        // Users with at least 1 reading (funnel)
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT user_id) as count FROM bazi_readings
        `,

        // Revenue breakdown by transaction type
        this.prisma.$queryRaw<Array<{
          type: string;
          total: number;
          count: bigint;
        }>>`
          SELECT type, SUM(amount)::float as total, COUNT(*) as count
          FROM transactions
          WHERE created_at >= ${sinceDate} AND type != 'REFUND'
          GROUP BY type
          ORDER BY total DESC
        `,
      ]);

      // Count users who purchased credits (funnel)
      const creditPurchasers = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT user_id) as count
        FROM transactions
        WHERE type = 'CREDIT_PURCHASE'
      `;

      // Count subscribers (funnel)
      const subscriberCount = await this.prisma.subscription.count({
        where: { status: 'ACTIVE' },
      });

      return {
        days,

        // Credit package purchases
        creditPackagePurchases: creditPackagePurchases.map((p) => ({
          description: p.description || 'Unknown',
          totalRevenue: p.total_revenue || 0,
          count: Number(p.count),
          avgAmount: p.avg_amount || 0,
        })),

        // Ad reward claims
        adRewardClaims: adRewardClaims.map((a) => ({
          rewardType: a.rewardType,
          count: a._count.id,
          creditsGranted: a._sum.creditsGranted || 0,
        })),
        adRewardDailyTrend: adRewardDaily.map((d) => ({
          date: d.day,
          count: Number(d.count),
        })),

        // Section unlock popularity
        sectionUnlockStats: sectionUnlockStats
          .map((s) => ({
            sectionKey: s.sectionKey,
            count: s._count.id,
          }))
          .sort((a, b) => b.count - a.count),

        // Subscription metrics
        activeSubscriptionsByTier: activeSubscriptions.map((s) => ({
          tier: s.planTier,
          count: s._count.id,
        })),
        newSubscriptions,
        cancelledSubscriptions,

        // Conversion funnel
        conversionFunnel: {
          totalUsers,
          usersWithReadings: Number(usersWithReadings[0]?.count || 0),
          creditPurchasers: Number(creditPurchasers[0]?.count || 0),
          subscribers: subscriberCount,
        },

        // Revenue breakdown
        revenueByType: revenueByType.map((r) => ({
          type: r.type,
          total: r.total || 0,
          count: Number(r.count),
        })),
      };
    } catch (err) {
      this.logger.error(`Failed to fetch monetization analytics: ${err instanceof Error ? err.message : err}`);
      return {
        days,
        creditPackagePurchases: [],
        adRewardClaims: [],
        adRewardDailyTrend: [],
        sectionUnlockStats: [],
        activeSubscriptionsByTier: [],
        newSubscriptions: 0,
        cancelledSubscriptions: 0,
        conversionFunnel: {
          totalUsers: 0,
          usersWithReadings: 0,
          creditPurchasers: 0,
          subscribers: 0,
        },
        revenueByType: [],
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
