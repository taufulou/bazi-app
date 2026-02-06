import {
  Injectable,
  NotFoundException,
  BadRequestException,
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

    // Deduct credits or use free reading
    const creditsUsed = canUseFreeTrial ? 0 : service.creditCost;

    const [reading] = await this.prisma.$transaction([
      this.prisma.baziReading.create({
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
      }),
      // Deduct credits or mark free reading used
      ...(canUseFreeTrial
        ? [
            this.prisma.user.update({
              where: { id: user.id },
              data: { freeReadingUsed: true },
            }),
          ]
        : [
            this.prisma.user.update({
              where: { id: user.id },
              data: { credits: { decrement: service.creditCost } },
            }),
          ]),
    ]);

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
      include: {
        birthProfile: true,
      },
    });

    if (!reading) {
      throw new NotFoundException('Reading not found');
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

    const canUseFreeTrial = !user.freeReadingUsed;
    const hasEnoughCredits = user.credits >= service.creditCost;

    if (!canUseFreeTrial && !hasEnoughCredits) {
      throw new BadRequestException(
        `Insufficient credits. This comparison requires ${service.creditCost} credits.`,
      );
    }

    // Call Bazi engine for compatibility calculation
    let calculationData: Record<string, unknown>;
    try {
      calculationData = await this.callBaziCompatibility(profileA, profileB, dto) as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Bazi compatibility engine call failed: ${message}`);
      throw new InternalServerErrorException('Bazi compatibility calculation failed.');
    }

    // Generate AI interpretation for compatibility
    let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
    let aiProvider: string | undefined = undefined;
    let aiModel: string | undefined = undefined;
    let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

    try {
      const enrichedData = {
        ...calculationData,
        comparisonType: dto.comparisonType.toLowerCase(),
      };

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

    const creditsUsed = canUseFreeTrial ? 0 : service.creditCost;

    const [comparison] = await this.prisma.$transaction([
      this.prisma.baziComparison.create({
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
        },
      }),
      ...(canUseFreeTrial
        ? [
            this.prisma.user.update({
              where: { id: user.id },
              data: { freeReadingUsed: true },
            }),
          ]
        : [
            this.prisma.user.update({
              where: { id: user.id },
              data: { credits: { decrement: service.creditCost } },
            }),
          ]),
    ]);

    return comparison;
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
        timezone: profile.birthTimezone,
        longitude: profile.birthLongitude,
        latitude: profile.birthLatitude,
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
    profileA: { birthDate: Date; birthTime: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    profileB: { birthDate: Date; birthTime: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    dto: CreateComparisonDto,
  ): Promise<Prisma.InputJsonValue> {
    const response = await fetch(`${this.baziEngineUrl}/compatibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_a: {
          birth_date: profileA.birthDate.toISOString().split('T')[0],
          birth_time: profileA.birthTime,
          timezone: profileA.birthTimezone,
          longitude: profileA.birthLongitude,
          latitude: profileA.birthLatitude,
          gender: profileA.gender.toLowerCase(),
        },
        person_b: {
          birth_date: profileB.birthDate.toISOString().split('T')[0],
          birth_time: profileB.birthTime,
          timezone: profileB.birthTimezone,
          longitude: profileB.birthLongitude,
          latitude: profileB.birthLatitude,
          gender: profileB.gender.toLowerCase(),
        },
        comparison_type: dto.comparisonType.toLowerCase(),
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
