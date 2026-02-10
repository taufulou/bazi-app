import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIService } from '../ai/ai.service';
import {
  CreateZwdsReadingDto,
  CreateZwdsComparisonDto,
  ZwdsChartPreviewDto,
  ZwdsHoroscopeDto,
} from './dto/create-zwds-reading.dto';
import { ZwdsChartData, ZwdsPalace, ZwdsStar } from './zwds.types';
import { Prisma, ReadingType } from '@prisma/client';

@Injectable()
export class ZwdsService {
  private readonly logger = new Logger(ZwdsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private aiService: AIService,
  ) {}

  // ============================================================
  // Chart Generation (iztro)
  // ============================================================

  /**
   * Generate a ZWDS chart from birth profile data using iztro.
   */
  async generateChart(
    solarDate: string,
    birthTime: string,
    gender: string,
    targetDate?: string,
  ): Promise<ZwdsChartData> {
    const { astro } = await import('iztro');

    // Map birth time (HH:MM) to iztro time index (0-12)
    const timeIndex = this.birthTimeToIndex(birthTime);

    // Map gender to iztro format
    const iztroGender = gender.toLowerCase() === 'male' ? '男' : '女';

    let astrolabe: any;
    try {
      astrolabe = astro.astrolabeBySolarDate(solarDate, timeIndex, iztroGender, true, 'zh-TW');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`iztro chart generation failed: ${message}`);
      throw new InternalServerErrorException('ZWDS chart generation failed. Please check birth data.');
    }

    // Transform iztro output to our standardized schema
    const chartData: ZwdsChartData = {
      solarDate: astrolabe.solarDate,
      lunarDate: astrolabe.lunarDate,
      chineseDate: astrolabe.chineseDate,
      birthTime: astrolabe.time,
      timeRange: astrolabe.timeRange,
      gender: iztroGender,
      zodiac: astrolabe.zodiac,
      sign: astrolabe.sign,
      fiveElementsClass: astrolabe.fiveElementsClass,
      soulPalaceBranch: astrolabe.earthlyBranchOfSoulPalace,
      bodyPalaceBranch: astrolabe.earthlyBranchOfBodyPalace,
      soulStar: astrolabe.soul,
      bodyStar: astrolabe.body,
      palaces: this.transformPalaces(astrolabe.palaces),
    };

    // Add horoscope data if target date provided
    if (targetDate) {
      try {
        const horoscope = astrolabe.horoscope(targetDate);
        chartData.horoscope = {
          decadal: {
            name: horoscope.decadal.name,
            stem: horoscope.decadal.heavenlyStem,
            branch: horoscope.decadal.earthlyBranch,
            mutagen: horoscope.decadal.mutagen || [],
          },
          yearly: {
            name: horoscope.yearly.name,
            stem: horoscope.yearly.heavenlyStem,
            branch: horoscope.yearly.earthlyBranch,
            mutagen: horoscope.yearly.mutagen || [],
          },
          monthly: horoscope.monthly ? {
            name: horoscope.monthly.name,
            stem: horoscope.monthly.heavenlyStem,
            branch: horoscope.monthly.earthlyBranch,
            mutagen: horoscope.monthly.mutagen || [],
          } : undefined,
          daily: horoscope.daily ? {
            name: horoscope.daily.name,
            stem: horoscope.daily.heavenlyStem,
            branch: horoscope.daily.earthlyBranch,
            mutagen: horoscope.daily.mutagen || [],
          } : undefined,
        };
      } catch (err: unknown) {
        this.logger.warn(`Horoscope generation failed for date ${targetDate}: ${err}`);
        // Don't fail the whole chart, just skip horoscope
      }
    }

    return chartData;
  }

  /**
   * Transform iztro palace array to our standardized format.
   */
  private transformPalaces(iztoPalaces: any[]): ZwdsPalace[] {
    return iztoPalaces.map((palace: any, index: number) => ({
      name: palace.name,
      index,
      isBodyPalace: palace.isBodyPalace || false,
      heavenlyStem: palace.heavenlyStem,
      earthlyBranch: palace.earthlyBranch,
      majorStars: this.transformStars(palace.majorStars || [], 'major'),
      minorStars: this.transformStars(palace.minorStars || [], 'minor'),
      adjectiveStars: this.transformStars(palace.adjectiveStars || [], 'adjective'),
      changsheng12: palace.changsheng12 || '',
      decadal: {
        startAge: palace.decadal?.range?.[0] ?? 0,
        endAge: palace.decadal?.range?.[1] ?? 0,
        stem: palace.decadal?.heavenlyStem || '',
        branch: palace.decadal?.earthlyBranch || '',
      },
      ages: palace.ages || [],
    }));
  }

  /**
   * Transform iztro star array to our format.
   */
  private transformStars(stars: any[], type: 'major' | 'minor' | 'adjective'): ZwdsStar[] {
    return stars.map((star: any) => ({
      name: star.name,
      type,
      brightness: star.brightness || undefined,
      mutagen: star.mutagen || undefined,
    }));
  }

  /**
   * Convert HH:MM birth time to iztro time index (0-12).
   * 0=早子時(23:00-00:59), 1=丑時(01:00-02:59), ... 12=晚子時(23:00-00:59)
   */
  birthTimeToIndex(birthTime: string): number {
    const [hours] = birthTime.split(':').map(Number);
    if (hours === 23) return 12; // Late 子時
    if (hours >= 0 && hours < 1) return 0; // Early 子時
    return Math.floor((hours + 1) / 2);
  }

  // ============================================================
  // Readings (Chart + AI Interpretation)
  // ============================================================

  async createReading(clerkUserId: string, dto: CreateZwdsReadingDto) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate ZWDS reading type
    const validZwdsTypes: ReadingType[] = [
      ReadingType.ZWDS_LIFETIME,
      ReadingType.ZWDS_ANNUAL,
      ReadingType.ZWDS_CAREER,
      ReadingType.ZWDS_LOVE,
      ReadingType.ZWDS_HEALTH,
    ];

    if (!validZwdsTypes.includes(dto.readingType)) {
      throw new BadRequestException('Invalid ZWDS reading type');
    }

    // Annual reading requires targetYear
    if (dto.readingType === ReadingType.ZWDS_ANNUAL && !dto.targetYear) {
      throw new BadRequestException('Target year is required for annual readings');
    }

    // Validate birth profile belongs to user
    const profile = await this.prisma.birthProfile.findFirst({
      where: { id: dto.birthProfileId, userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    // Check credits / free reading
    const service = await this.prisma.service.findFirst({
      where: { type: dto.readingType, isActive: true },
    });

    if (!service) {
      throw new BadRequestException('This ZWDS reading type is not currently available');
    }

    const canUseFreeTrial = !user.freeReadingUsed;
    const hasEnoughCredits = user.credits >= service.creditCost;

    if (!canUseFreeTrial && !hasEnoughCredits) {
      throw new BadRequestException(
        `Insufficient credits. This reading requires ${service.creditCost} credits. ` +
        `You have ${user.credits} credits.`,
      );
    }

    // Generate birth data hash for cache lookup
    const birthDataHash = this.aiService.generateBirthDataHash(
      profile.birthDate.toISOString().split('T')[0],
      profile.birthTime,
      profile.birthCity,
      profile.gender.toLowerCase(),
      dto.readingType,
      dto.targetYear,
    );

    // Check cache
    const cachedInterpretation = await this.aiService.getCachedInterpretation(
      birthDataHash,
      dto.readingType,
    );

    // Generate ZWDS chart
    const solarDate = this.formatSolarDate(profile.birthDate);
    const targetDate = dto.targetYear ? `${dto.targetYear}-1-1` : undefined;
    let chartData: ZwdsChartData;
    try {
      chartData = await this.generateChart(
        solarDate,
        profile.birthTime,
        profile.gender.toLowerCase(),
        targetDate,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`ZWDS chart generation failed: ${message}`);
      throw new InternalServerErrorException('ZWDS calculation failed. Please try again.');
    }

    // Generate AI interpretation (or use cache)
    let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
    let aiProvider: string | undefined = undefined;
    let aiModel: string | undefined = undefined;
    let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

    if (cachedInterpretation) {
      this.logger.log(`Cache hit for ZWDS reading ${birthDataHash}`);
      aiInterpretation = cachedInterpretation as unknown as Prisma.InputJsonValue;
      aiProvider = 'CLAUDE';
      aiModel = 'cached';
    } else {
      try {
        const enrichedData = {
          ...chartData,
          system: 'zwds',
          gender: profile.gender.toLowerCase(),
          birthDate: profile.birthDate.toISOString().split('T')[0],
          birthTime: profile.birthTime,
          targetYear: dto.targetYear,
        };

        const aiResult = await this.aiService.generateInterpretation(
          enrichedData as any,
          dto.readingType,
          user.id,
        );

        aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
        aiProvider = aiResult.provider;
        aiModel = aiResult.model;
        tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;

        // Cache asynchronously
        this.aiService.cacheInterpretation(
          birthDataHash,
          dto.readingType,
          chartData as any,
          aiResult.interpretation,
        ).catch((err) => this.logger.error(`Cache write failed: ${err}`));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(`AI interpretation failed for ZWDS: ${message}`);
        // Graceful degradation — return chart without AI
      }
    }

    // Deduct credits atomically
    const creditsUsed = canUseFreeTrial ? 0 : service.creditCost;

    const reading = await this.prisma.$transaction(async (tx) => {
      if (canUseFreeTrial) {
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
            `Insufficient credits. This reading requires ${service.creditCost} credits.`,
          );
        }
      }

      return tx.baziReading.create({
        data: {
          userId: user.id,
          birthProfileId: profile.id,
          readingType: dto.readingType,
          calculationData: chartData as unknown as Prisma.InputJsonValue,
          aiInterpretation,
          aiProvider: aiProvider as any,
          aiModel,
          tokenUsage,
          creditsUsed,
          targetYear: dto.targetYear,
        },
      });
    });

    return reading;
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
      include: { birthProfile: true },
    });

    if (!reading) {
      throw new NotFoundException('Reading not found');
    }

    // Server-side paywall: non-subscribers only get preview
    const isSubscriber = user.subscriptionTier !== 'FREE';
    const isOwnerReading = reading.creditsUsed > 0 || reading.userId === user.id;

    if (isSubscriber || isOwnerReading) {
      return reading;
    }

    // Strip full text, keep only preview
    if (reading.aiInterpretation && typeof reading.aiInterpretation === 'object') {
      const interpretation = reading.aiInterpretation as Record<string, unknown>;
      const sections = interpretation.sections as Record<string, { preview: string; full: string }> | undefined;
      if (sections) {
        const previewOnly: Record<string, { preview: string; full: string }> = {};
        for (const [key, section] of Object.entries(sections)) {
          previewOnly[key] = { preview: section.preview, full: section.preview };
        }
        return {
          ...reading,
          aiInterpretation: { ...interpretation, sections: previewOnly },
        };
      }
    }

    return reading;
  }

  // ============================================================
  // Chart Preview (free — no AI)
  // ============================================================

  async getChartPreview(clerkUserId: string, dto: ZwdsChartPreviewDto) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = await this.prisma.birthProfile.findFirst({
      where: { id: dto.birthProfileId, userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    const solarDate = this.formatSolarDate(profile.birthDate);
    return this.generateChart(solarDate, profile.birthTime, profile.gender.toLowerCase());
  }

  // ============================================================
  // Horoscope (大限/流年/流月 for a date)
  // ============================================================

  async getHoroscope(clerkUserId: string, dto: ZwdsHoroscopeDto) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = await this.prisma.birthProfile.findFirst({
      where: { id: dto.birthProfileId, userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    const solarDate = this.formatSolarDate(profile.birthDate);
    return this.generateChart(solarDate, profile.birthTime, profile.gender.toLowerCase(), dto.targetDate);
  }

  // ============================================================
  // Compatibility
  // ============================================================

  async createComparison(clerkUserId: string, dto: CreateZwdsComparisonDto) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [profileA, profileB] = await Promise.all([
      this.prisma.birthProfile.findFirst({ where: { id: dto.profileAId, userId: user.id } }),
      this.prisma.birthProfile.findFirst({ where: { id: dto.profileBId, userId: user.id } }),
    ]);

    if (!profileA || !profileB) {
      throw new NotFoundException('One or both birth profiles not found');
    }

    // Check credits
    const service = await this.prisma.service.findFirst({
      where: { type: ReadingType.ZWDS_COMPATIBILITY, isActive: true },
    });

    if (!service) {
      throw new BadRequestException('ZWDS compatibility is not currently available');
    }

    const canUseFreeTrial = !user.freeReadingUsed;
    const hasEnoughCredits = user.credits >= service.creditCost;

    if (!canUseFreeTrial && !hasEnoughCredits) {
      throw new BadRequestException(
        `Insufficient credits. This comparison requires ${service.creditCost} credits.`,
      );
    }

    // Generate both charts
    let chartA: ZwdsChartData;
    let chartB: ZwdsChartData;
    try {
      [chartA, chartB] = await Promise.all([
        this.generateChart(
          this.formatSolarDate(profileA.birthDate),
          profileA.birthTime,
          profileA.gender.toLowerCase(),
        ),
        this.generateChart(
          this.formatSolarDate(profileB.birthDate),
          profileB.birthTime,
          profileB.gender.toLowerCase(),
        ),
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`ZWDS compatibility chart generation failed: ${message}`);
      throw new InternalServerErrorException('ZWDS compatibility calculation failed.');
    }

    const calculationData = { chartA, chartB };

    // Generate AI interpretation
    let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
    let aiProvider: string | undefined = undefined;
    let aiModel: string | undefined = undefined;
    let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

    try {
      const enrichedData = {
        ...calculationData,
        system: 'zwds',
        comparisonType: dto.comparisonType.toLowerCase(),
      };

      const aiResult = await this.aiService.generateInterpretation(
        enrichedData as any,
        ReadingType.ZWDS_COMPATIBILITY,
        user.id,
      );

      aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
      aiProvider = aiResult.provider;
      aiModel = aiResult.model;
      tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`AI ZWDS compatibility interpretation failed: ${message}`);
    }

    const creditsUsed = canUseFreeTrial ? 0 : service.creditCost;

    const comparison = await this.prisma.$transaction(async (tx) => {
      if (canUseFreeTrial) {
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
          calculationData: calculationData as unknown as Prisma.InputJsonValue,
          aiInterpretation,
          aiProvider: aiProvider as any,
          aiModel,
          tokenUsage,
          creditsUsed,
        },
      });
    });

    return comparison;
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Format a Date object to iztro's expected solar date format (YYYY-M-D).
   * iztro does NOT want zero-padded months/days.
   */
  private formatSolarDate(date: Date): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}-${month}-${day}`;
  }
}
