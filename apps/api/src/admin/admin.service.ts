import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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

  async updateService(id: string, data: Record<string, unknown>, adminUserId: string) {
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

  async updatePlan(id: string, data: Record<string, unknown>, adminUserId: string) {
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

  async updatePromptTemplate(id: string, data: Record<string, unknown>, adminUserId: string) {
    const template = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Prompt template not found');

    const updated = await this.prisma.promptTemplate.update({ where: { id }, data });

    await this.logAudit(adminUserId, 'update_prompt_template', 'prompt_template', id, template, updated);

    return updated;
  }

  // ============ Analytics (basic) ============

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

  // ============ Audit Log ============

  async getAuditLog(page = 1, limit = 50) {
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
