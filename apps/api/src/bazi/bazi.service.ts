import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIService } from '../ai/ai.service';
import { CreateReadingDto, CreateComparisonDto } from './dto/create-reading.dto';
import { Prisma, ReadingType } from '@prisma/client';

@Injectable()
export class BaziService {
  private readonly logger = new Logger(BaziService.name);
  private readonly baziEngineUrl: string;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private configService: ConfigService,
    private aiService: AIService,
  ) {
    this.baziEngineUrl = this.configService.get<string>('BAZI_ENGINE_URL') || 'http://localhost:5001';
  }

  // ============ Services Catalog ============

  async getServices() {
    return this.redis.getOrSet('services:active', 3600, async () => {
      return this.prisma.service.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  async getPlans() {
    return this.redis.getOrSet('plans:active', 3600, async () => {
      return this.prisma.plan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  // ============ Readings ============

  async createReading(clerkUserId: string, dto: CreateReadingDto) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate birth profile belongs to user
    const profile = await this.prisma.birthProfile.findFirst({
      where: { id: dto.birthProfileId, userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    // Validate annual reading requires targetYear
    if (dto.readingType === ReadingType.ANNUAL && !dto.targetYear) {
      throw new BadRequestException('Target year is required for annual readings');
    }

    // Check credits / free reading
    const service = await this.prisma.service.findFirst({
      where: { type: dto.readingType, isActive: true },
    });

    if (!service) {
      throw new BadRequestException('This reading type is not currently available');
    }

    // Master tier bypass — truly unlimited, skip credit system entirely
    const isMaster = user.subscriptionTier === 'MASTER';
    const canUseFreeTrial = !isMaster && !user.freeReadingUsed;
    const hasEnoughCredits = user.credits >= service.creditCost;

    if (!isMaster && !canUseFreeTrial && !hasEnoughCredits) {
      throw new BadRequestException(
        `Insufficient credits. This reading requires ${service.creditCost} credits. ` +
        `You have ${user.credits} credits.`,
      );
    }

    // Acquire distributed lock to prevent concurrent reading creation exploit
    const lockKey = `reading:create:${user.id}`;
    const lockAcquired = await this.redis.acquireLock(lockKey, 30);
    if (!lockAcquired) {
      throw new ConflictException('A reading is already being created. Please wait.');
    }

    try {
      return await this._executeCreateReading(user, profile, dto, service, isMaster, canUseFreeTrial);
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  /**
   * Internal: executes reading creation within distributed lock.
   * Separated to keep createReading() clean and testable.
   */
  private async _executeCreateReading(
    user: { id: string; credits: number; freeReadingUsed: boolean; subscriptionTier: string },
    profile: { id: string; birthDate: Date; birthTime: string; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    dto: CreateReadingDto,
    service: { creditCost: number; type: string },
    isMaster: boolean,
    canUseFreeTrial: boolean,
  ) {
    // Generate birth data hash for cache lookup
    const birthDataHash = this.aiService.generateBirthDataHash(
      profile.birthDate.toISOString().split('T')[0],
      profile.birthTime,
      profile.birthCity,
      profile.gender.toLowerCase(),
      dto.readingType,
      dto.targetYear,
    );

    // Check cache for existing interpretation
    const cachedInterpretation = await this.aiService.getCachedInterpretation(
      birthDataHash,
      dto.readingType,
    );

    // Call Python Bazi engine for calculation
    let calculationData: Record<string, unknown>;
    try {
      calculationData = await this.callBaziEngine(profile, dto) as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Bazi engine call failed: ${message}`);
      throw new InternalServerErrorException('Bazi calculation failed. Please try again.');
    }

    // Generate AI interpretation (or use cache)
    let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
    let aiProvider: string | undefined = undefined;
    let aiModel: string | undefined = undefined;
    let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

    if (cachedInterpretation) {
      this.logger.log(`Cache hit for reading ${birthDataHash}`);
      aiInterpretation = cachedInterpretation as unknown as Prisma.InputJsonValue;
      aiProvider = 'CLAUDE'; // Original provider unknown for cached results
      aiModel = 'cached';
    } else {
      try {
        // Add birth info to calculation data for prompt interpolation
        const enrichedData = {
          ...calculationData,
          gender: profile.gender.toLowerCase(),
          birthDate: profile.birthDate.toISOString().split('T')[0],
          birthTime: profile.birthTime,
          targetYear: dto.targetYear,
        };

        const aiResult = await this.aiService.generateInterpretation(
          enrichedData,
          dto.readingType,
          user.id,
        );

        aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
        aiProvider = aiResult.provider;
        aiModel = aiResult.model;
        tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;

        // Cache the result asynchronously
        this.aiService.cacheInterpretation(
          birthDataHash,
          dto.readingType,
          calculationData,
          aiResult.interpretation,
        ).catch((err) => this.logger.error(`Cache write failed: ${err}`));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(`AI interpretation failed: ${message}`);
        // Don't fail the reading — return calculation without AI
        // The frontend can request AI interpretation later
      }
    }

    // Cache hit: no credit deduction (user already paid for this interpretation)
    // Master tier: no credit deduction at all (creditsUsed: 0)
    // Free trial: claim free reading (creditsUsed: 0)
    // Regular: deduct service.creditCost credits
    const fromCache = !!cachedInterpretation;
    const creditsUsed = (fromCache || isMaster || canUseFreeTrial) ? 0 : service.creditCost;

    const reading = await this.prisma.$transaction(async (tx) => {
      if (fromCache || isMaster) {
        // Cache hit or Master tier: no credit deduction
        // Just proceed to create reading
      } else if (canUseFreeTrial) {
        // Atomically claim the free reading — only succeeds if not already used
        const updated = await tx.user.updateMany({
          where: { id: user.id, freeReadingUsed: false },
          data: { freeReadingUsed: true },
        });
        if (updated.count === 0) {
          throw new BadRequestException('Free reading already used');
        }
      } else {
        // Atomically deduct credits — only succeeds if user has enough
        const updated = await tx.user.updateMany({
          where: { id: user.id, credits: { gte: service.creditCost } },
          data: { credits: { decrement: service.creditCost } },
        });
        if (updated.count === 0) {
          throw new BadRequestException(
            `Insufficient credits. This reading requires ${service.creditCost} credits.`,
          );
        }
      }

      return tx.baziReading.create({
        data: {
          userId: user.id,
          birthProfileId: profile.id,
          readingType: dto.readingType,
          calculationData: calculationData as Prisma.InputJsonValue,
          aiInterpretation,
          aiProvider: aiProvider as any,
          aiModel,
          tokenUsage,
          creditsUsed,
          targetYear: dto.targetYear,
        },
      });
    });

    return { ...reading, fromCache };
  }

  async getReading(clerkUserId: string, readingId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const reading = await this.prisma.baziReading.findFirst({
      where: { id: readingId, userId: user.id },
      include: {
        birthProfile: true,
      },
    });

    if (!reading) {
      throw new NotFoundException('Reading not found');
    }

    // Server-side paywall: non-subscribers only get preview sections
    const isSubscriber = user.subscriptionTier !== 'FREE';
    const isOwnerReading = reading.creditsUsed > 0 || reading.userId === user.id;

    // If user paid for this reading (credits or free trial) OR is a subscriber, return full
    if (isSubscriber || isOwnerReading) {
      return reading;
    }

    // Strip full text, keep only preview for non-subscribers
    if (reading.aiInterpretation && typeof reading.aiInterpretation === 'object') {
      const interpretation = reading.aiInterpretation as Record<string, unknown>;
      const sections = interpretation.sections as Record<string, { preview: string; full: string }> | undefined;
      if (sections) {
        const previewOnly: Record<string, { preview: string; full: string }> = {};
        for (const [key, section] of Object.entries(sections)) {
          previewOnly[key] = { preview: section.preview, full: section.preview }; // full = preview only
        }
        return {
          ...reading,
          aiInterpretation: {
            ...interpretation,
            sections: previewOnly,
          },
        };
      }
    }

    return reading;
  }

  // ============ Comparisons ============

  async createComparison(clerkUserId: string, dto: CreateComparisonDto) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate both profiles belong to user
    const [profileA, profileB] = await Promise.all([
      this.prisma.birthProfile.findFirst({
        where: { id: dto.profileAId, userId: user.id },
      }),
      this.prisma.birthProfile.findFirst({
        where: { id: dto.profileBId, userId: user.id },
      }),
    ]);

    if (!profileA || !profileB) {
      throw new NotFoundException('One or both birth profiles not found');
    }

    // Check credits
    const service = await this.prisma.service.findFirst({
      where: { type: ReadingType.COMPATIBILITY, isActive: true },
    });

    if (!service) {
      throw new BadRequestException('Compatibility comparison is not currently available');
    }

    // Master tier bypass — truly unlimited
    const isMaster = user.subscriptionTier === 'MASTER';
    const canUseFreeTrial = !isMaster && !user.freeReadingUsed;
    const hasEnoughCredits = user.credits >= service.creditCost;

    if (!isMaster && !canUseFreeTrial && !hasEnoughCredits) {
      throw new BadRequestException(
        `Insufficient credits. This comparison requires ${service.creditCost} credits.`,
      );
    }

    // Acquire distributed lock to prevent concurrent exploit
    const lockKey = `reading:create:${user.id}`;
    const lockAcquired = await this.redis.acquireLock(lockKey, 30);
    if (!lockAcquired) {
      throw new ConflictException('A reading is already being created. Please wait.');
    }

    try {
      // Call Bazi engine for compatibility calculation
      let calculationData: Record<string, unknown>;
      try {
        calculationData = await this.callBaziCompatibility(profileA, profileB, dto) as Record<string, unknown>;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(`Bazi compatibility engine call failed: ${message}`);
        throw new InternalServerErrorException('Bazi compatibility calculation failed.');
      }

      // Generate AI interpretation for compatibility (skip when skipAI=true for progressive loading)
      let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
      let aiProvider: string | undefined = undefined;
      let aiModel: string | undefined = undefined;
      let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

      if (!dto.skipAI) {
        try {
          // Enrich with comparison type and gender for prompt interpolation
          const enrichedData: Record<string, unknown> = {
            ...calculationData,
            comparisonType: dto.comparisonType.toLowerCase(),
            genderA: profileA.gender.toLowerCase(),
            genderB: profileB.gender.toLowerCase(),
          };

          // Attach gender to chart data for interpolateChartFields
          const eChartA = enrichedData['chartA'] as Record<string, unknown> | undefined;
          const eChartB = enrichedData['chartB'] as Record<string, unknown> | undefined;
          if (eChartA) eChartA['gender'] = profileA.gender.toLowerCase();
          if (eChartB) eChartB['gender'] = profileB.gender.toLowerCase();

          const aiResult = await this.aiService.generateInterpretation(
            enrichedData,
            ReadingType.COMPATIBILITY,
            user.id,
          );

          aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
          aiProvider = aiResult.provider;
          aiModel = aiResult.model;
          tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(`AI compatibility interpretation failed: ${message}`);
        }
      }

      // Master tier: creditsUsed = 0; Free trial: creditsUsed = 0; Regular: service.creditCost
      const creditsUsed = (isMaster || canUseFreeTrial) ? 0 : service.creditCost;

      // Atomic transaction to prevent double-spend
      const comparison = await this.prisma.$transaction(async (tx) => {
        if (isMaster) {
          // Master tier: no credit deduction
        } else if (canUseFreeTrial) {
          const updated = await tx.user.updateMany({
            where: { id: user.id, freeReadingUsed: false },
            data: { freeReadingUsed: true },
          });
          if (updated.count === 0) {
            throw new BadRequestException('Free reading already used');
          }
        } else {
          const updated = await tx.user.updateMany({
            where: { id: user.id, credits: { gte: service.creditCost } },
            data: { credits: { decrement: service.creditCost } },
          });
          if (updated.count === 0) {
            throw new BadRequestException(
              `Insufficient credits. This comparison requires ${service.creditCost} credits.`,
            );
          }
        }

        return tx.baziComparison.create({
          data: {
            userId: user.id,
            profileAId: profileA.id,
            profileBId: profileB.id,
            comparisonType: dto.comparisonType,
            calculationData: calculationData as Prisma.InputJsonValue,
            aiInterpretation,
            aiProvider: aiProvider as any,
            aiModel,
            tokenUsage,
            creditsUsed,
            lastCalculatedYear: new Date().getFullYear(),
          },
        });
      });

      return this.flattenComparisonResponse(comparison);
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  async getComparison(clerkUserId: string, comparisonId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const comparison = await this.prisma.baziComparison.findFirst({
      where: { id: comparisonId, userId: user.id },
      include: {
        profileA: true,
        profileB: true,
      },
    });

    if (!comparison) {
      throw new NotFoundException('Comparison not found');
    }

    // Server-side paywall: non-subscribers only get preview sections
    const isSubscriber = user.subscriptionTier !== 'FREE';
    const isOwnerReading = comparison.creditsUsed > 0 || comparison.userId === user.id;

    if (isSubscriber || isOwnerReading) {
      return this.flattenComparisonResponse(comparison);
    }

    // Strip full text, keep only preview for non-subscribers
    if (comparison.aiInterpretation && typeof comparison.aiInterpretation === 'object') {
      const interpretation = comparison.aiInterpretation as Record<string, unknown>;
      const sections = interpretation.sections as Record<string, { preview: string; full: string }> | undefined;
      if (sections) {
        const previewOnly: Record<string, { preview: string; full: string }> = {};
        for (const [key, section] of Object.entries(sections)) {
          previewOnly[key] = { preview: section.preview, full: section.preview };
        }
        return this.flattenComparisonResponse({
          ...comparison,
          aiInterpretation: {
            ...interpretation,
            sections: previewOnly,
          },
        });
      }
    }

    return this.flattenComparisonResponse(comparison);
  }

  async getComparisonHistory(clerkUserId: string, page = 1, limit = 20) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.baziComparison.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          comparisonType: true,
          creditsUsed: true,
          createdAt: true,
          profileA: {
            select: { name: true, birthDate: true },
          },
          profileB: {
            select: { name: true, birthDate: true },
          },
        },
      }),
      this.prisma.baziComparison.count({
        where: { userId: user.id },
      }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ============ Recalculate Comparison ============

  async recalculateComparison(clerkUserId: string, comparisonId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) throw new NotFoundException('User not found');

    const comparison = await this.prisma.baziComparison.findFirst({
      where: { id: comparisonId, userId: user.id },
      include: { profileA: true, profileB: true },
    });
    if (!comparison) throw new NotFoundException('Comparison not found');

    const currentYear = new Date().getFullYear();

    // Check if already up-to-date
    if (comparison.lastCalculatedYear === currentYear) {
      throw new BadRequestException('此合盤分析已是最新年份');
    }

    // Charge 1 credit (unless Master tier)
    const recalcCost = 1;
    const isMaster = user.subscriptionTier === 'MASTER';

    if (!isMaster && user.credits < recalcCost) {
      throw new BadRequestException(
        `Insufficient credits. Re-calculation requires ${recalcCost} credit.`,
      );
    }

    // Re-call Python engine with new current_year
    const profileA = comparison.profileA;
    const profileB = comparison.profileB;
    const dto = { comparisonType: comparison.comparisonType } as CreateComparisonDto;

    let calculationData: Record<string, unknown>;
    try {
      calculationData = await this.callBaziCompatibility(profileA, profileB, dto) as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Bazi recalculation engine call failed: ${message}`);
      throw new InternalServerErrorException('Bazi re-calculation failed.');
    }

    // Re-generate AI interpretation
    let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
    let aiProvider: string | undefined = undefined;
    let aiModel: string | undefined = undefined;
    let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

    try {
      const enrichedData: Record<string, unknown> = {
        ...calculationData,
        comparisonType: comparison.comparisonType.toLowerCase(),
        genderA: profileA.gender.toLowerCase(),
        genderB: profileB.gender.toLowerCase(),
      };

      const eChartA = enrichedData['chartA'] as Record<string, unknown> | undefined;
      const eChartB = enrichedData['chartB'] as Record<string, unknown> | undefined;
      if (eChartA) eChartA['gender'] = profileA.gender.toLowerCase();
      if (eChartB) eChartB['gender'] = profileB.gender.toLowerCase();

      const aiResult = await this.aiService.generateInterpretation(
        enrichedData,
        ReadingType.COMPATIBILITY,
        user.id,
      );

      aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
      aiProvider = aiResult.provider;
      aiModel = aiResult.model;
      tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`AI re-interpretation failed: ${message}`);
    }

    // Atomic update: deduct credit + update comparison
    const updated = await this.prisma.$transaction(async (tx) => {
      if (!isMaster) {
        const deducted = await tx.user.updateMany({
          where: { id: user.id, credits: { gte: recalcCost } },
          data: { credits: { decrement: recalcCost } },
        });
        if (deducted.count === 0) {
          throw new BadRequestException('Insufficient credits');
        }
      }

      return tx.baziComparison.update({
        where: { id: comparisonId },
        data: {
          calculationData: calculationData as Prisma.InputJsonValue,
          aiInterpretation,
          aiProvider: aiProvider as any,
          aiModel,
          tokenUsage,
          lastCalculatedYear: currentYear,
        },
        include: { profileA: true, profileB: true },
      });
    });

    return this.flattenComparisonResponse(updated);
  }

  // ============ Generate AI for Existing Comparison ============

  /**
   * Generate AI interpretation for a comparison that was created with skipAI=true.
   * Idempotent: returns cached AI if already generated.
   * Uses distributed lock to prevent concurrent AI generation for the same comparison.
   * No credits are charged (already deducted during createComparison).
   */
  async generateComparisonAI(clerkUserId: string, comparisonId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) throw new NotFoundException('User not found');

    const comparison = await this.prisma.baziComparison.findFirst({
      where: { id: comparisonId, userId: user.id },
      include: { profileA: true, profileB: true },
    });
    if (!comparison) throw new NotFoundException('Comparison not found');

    // If AI already exists, return immediately (idempotent)
    if (comparison.aiInterpretation) {
      return this.flattenComparisonResponse(comparison);
    }

    // Acquire distributed lock to prevent concurrent AI generation
    const lockKey = `ai:generate:comparison:${comparisonId}`;
    const lockAcquired = await this.redis.acquireLock(lockKey, 60);
    if (!lockAcquired) {
      // Another request is already generating AI — poll until done (max 30s)
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const check = await this.prisma.baziComparison.findUnique({
          where: { id: comparisonId },
          select: { aiInterpretation: true },
        });
        if (check?.aiInterpretation) break;
      }
      const fresh = await this.prisma.baziComparison.findFirst({
        where: { id: comparisonId, userId: user.id },
        include: { profileA: true, profileB: true },
      });
      return this.flattenComparisonResponse(fresh || comparison);
    }

    try {
      // Double-check AI after acquiring lock (another request may have completed)
      const freshCheck = await this.prisma.baziComparison.findUnique({
        where: { id: comparisonId },
        select: { aiInterpretation: true },
      });
      if (freshCheck?.aiInterpretation) {
        const full = await this.prisma.baziComparison.findFirst({
          where: { id: comparisonId, userId: user.id },
          include: { profileA: true, profileB: true },
        });
        return this.flattenComparisonResponse(full!);
      }

      // Reconstruct enriched data from stored calculationData
      const calcData = comparison.calculationData as Record<string, unknown>;
      const enrichedData: Record<string, unknown> = {
        ...calcData,
        comparisonType: comparison.comparisonType.toLowerCase(),
        genderA: comparison.profileA.gender.toLowerCase(),
        genderB: comparison.profileB.gender.toLowerCase(),
      };

      // Attach gender to chart data for interpolateChartFields
      const eChartA = enrichedData['chartA'] as Record<string, unknown> | undefined;
      const eChartB = enrichedData['chartB'] as Record<string, unknown> | undefined;
      if (eChartA) eChartA['gender'] = comparison.profileA.gender.toLowerCase();
      if (eChartB) eChartB['gender'] = comparison.profileB.gender.toLowerCase();

      // Call AI service (same pattern as createComparison)
      let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
      let aiProvider: string | undefined = undefined;
      let aiModel: string | undefined = undefined;
      let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

      try {
        const aiResult = await this.aiService.generateInterpretation(
          enrichedData,
          ReadingType.COMPATIBILITY,
          user.id,
        );

        aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
        aiProvider = aiResult.provider;
        aiModel = aiResult.model;
        tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(
          `AI compatibility generation failed for comparison ${comparisonId}: ${message}`,
        );
        // Return comparison as-is (no AI)
        return this.flattenComparisonResponse(comparison);
      }

      // Update comparison with AI data — ownership-safe via updateMany
      await this.prisma.baziComparison.updateMany({
        where: { id: comparisonId, userId: user.id },
        data: {
          aiInterpretation: aiInterpretation as any,
          aiProvider: aiProvider as any,
          aiModel,
          tokenUsage,
        },
      });

      // Fetch updated record for response
      const updated = await this.prisma.baziComparison.findFirst({
        where: { id: comparisonId, userId: user.id },
        include: { profileA: true, profileB: true },
      });
      return this.flattenComparisonResponse(updated!);
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  // ============ Response Transformation ============

  /**
   * Flatten compatibility fields into `calculationData` top level
   * so the frontend receives the expected shape:
   *   { adjustedScore, knockoutConditions, timingSync, dimensionScores, ... }
   *
   * Handles two engine output formats:
   * 1. Enhanced (8-dimension): { chartA, chartB, compatibilityEnhanced: { adjustedScore, dimensionScores, ... } }
   * 2. Legacy (simple):        { chartA, chartB, compatibility: { overallScore, ... } }
   */
  private flattenComparisonResponse<T extends { calculationData: unknown }>(comparison: T): T {
    const calcData = comparison.calculationData as Record<string, unknown> | null;
    if (!calcData) return comparison;

    // Try enhanced first (8-dimension system)
    const enhanced = calcData['compatibilityEnhanced'] as Record<string, unknown> | undefined;
    if (enhanced) {
      return {
        ...comparison,
        calculationData: {
          ...enhanced,
          chartA: calcData['chartA'],
          chartB: calcData['chartB'],
          compatibilityPreAnalysis: calcData['compatibilityPreAnalysis'],
          comparisonType: enhanced['comparisonType'] || calcData['comparisonType'],
        },
      };
    }

    // Fall back to legacy compatibility format
    const legacy = calcData['compatibility'] as Record<string, unknown> | undefined;
    if (legacy) {
      return {
        ...comparison,
        calculationData: {
          ...legacy,
          // Map legacy fields to expected frontend fields
          adjustedScore: legacy['overallScore'],
          overallScore: legacy['overallScore'],
          label: legacy['levelZh'] || legacy['level'] || '',
          labelDescription: '',
          chartA: calcData['chartA'],
          chartB: calcData['chartB'],
          compatibilityPreAnalysis: calcData['compatibilityPreAnalysis'],
          comparisonType: legacy['comparisonType'] || calcData['comparisonType'],
        },
      };
    }

    return comparison; // Already flat or unrecognized
  }

  // ============ Engine Communication ============

  private async callBaziEngine(
    profile: { birthDate: Date; birthTime: string; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    dto: CreateReadingDto,
  ): Promise<Prisma.InputJsonValue> {
    const response = await fetch(`${this.baziEngineUrl}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        birth_date: profile.birthDate.toISOString().split('T')[0],
        birth_time: profile.birthTime,
        birth_city: profile.birthCity,
        birth_timezone: profile.birthTimezone,
        birth_longitude: profile.birthLongitude,
        birth_latitude: profile.birthLatitude,
        gender: profile.gender.toLowerCase(),
        reading_type: dto.readingType.toLowerCase(),
        target_year: dto.targetYear,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Bazi engine returned ${response.status}`);
    }

    const result = await response.json();
    // The engine returns { status, data, calculationTimeMs }
    return result.data || result;
  }

  private async callBaziCompatibility(
    profileA: { birthDate: Date; birthTime: string; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    profileB: { birthDate: Date; birthTime: string; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    dto: CreateComparisonDto,
  ): Promise<Prisma.InputJsonValue> {
    const response = await fetch(`${this.baziEngineUrl}/compatibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_a: {
          birth_date: profileA.birthDate.toISOString().split('T')[0],
          birth_time: profileA.birthTime,
          birth_city: profileA.birthCity,
          birth_timezone: profileA.birthTimezone,
          birth_longitude: profileA.birthLongitude,
          birth_latitude: profileA.birthLatitude,
          gender: profileA.gender.toLowerCase(),
        },
        profile_b: {
          birth_date: profileB.birthDate.toISOString().split('T')[0],
          birth_time: profileB.birthTime,
          birth_city: profileB.birthCity,
          birth_timezone: profileB.birthTimezone,
          birth_longitude: profileB.birthLongitude,
          birth_latitude: profileB.birthLatitude,
          gender: profileB.gender.toLowerCase(),
        },
        comparison_type: dto.comparisonType.toLowerCase(),
        current_year: new Date().getFullYear(),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Bazi engine returned ${response.status}`);
    }

    const result = await response.json();
    return result.data || result;
  }
}
