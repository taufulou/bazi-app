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
  ) {
    this.baziEngineUrl = this.configService.get<string>('BAZI_ENGINE_URL') || 'http://localhost:5000';
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

    // Call Python Bazi engine for calculation
    let calculationData: Prisma.InputJsonValue;
    try {
      calculationData = await this.callBaziEngine(profile, dto);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Bazi engine call failed: ${message}`);
      throw new InternalServerErrorException('Bazi calculation failed. Please try again.');
    }

    // Deduct credits or use free reading
    const creditsUsed = canUseFreeTrial ? 0 : service.creditCost;

    const [reading] = await this.prisma.$transaction([
      this.prisma.baziReading.create({
        data: {
          userId: user.id,
          birthProfileId: profile.id,
          readingType: dto.readingType,
          calculationData,
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
    let calculationData: Prisma.InputJsonValue;
    try {
      calculationData = await this.callBaziCompatibility(profileA, profileB, dto);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Bazi compatibility engine call failed: ${message}`);
      throw new InternalServerErrorException('Bazi compatibility calculation failed.');
    }

    const creditsUsed = canUseFreeTrial ? 0 : service.creditCost;

    const [comparison] = await this.prisma.$transaction([
      this.prisma.baziComparison.create({
        data: {
          userId: user.id,
          profileAId: profileA.id,
          profileBId: profileB.id,
          comparisonType: dto.comparisonType,
          calculationData,
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

    return response.json();
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

    return response.json();
  }
}
