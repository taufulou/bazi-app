import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateBirthProfileDto, UpdateBirthProfileDto } from './dto/create-birth-profile.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  // ============ User Profile ============

  async findByClerkId(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
      include: {
        birthProfiles: {
          orderBy: { createdAt: 'desc' },
        },
        subscriptions: {
          where: { status: 'ACTIVE' },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(clerkUserId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { clerkUserId },
      data: dto,
    });
  }

  // ============ Birth Profiles ============

  async getBirthProfiles(clerkUserId: string) {
    const user = await this.ensureUser(clerkUserId);
    return this.prisma.birthProfile.findMany({
      where: { userId: user.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createBirthProfile(clerkUserId: string, dto: CreateBirthProfileDto) {
    const user = await this.ensureUser(clerkUserId);

    // If this is set as primary, unset other primaries
    if (dto.isPrimary) {
      await this.prisma.birthProfile.updateMany({
        where: { userId: user.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return this.prisma.birthProfile.create({
      data: {
        userId: user.id,
        name: dto.name,
        birthDate: new Date(dto.birthDate),
        birthTime: dto.birthTime,
        birthCity: dto.birthCity,
        birthTimezone: dto.birthTimezone,
        birthLongitude: dto.birthLongitude,
        birthLatitude: dto.birthLatitude,
        gender: dto.gender,
        relationshipTag: dto.relationshipTag || 'SELF',
        isPrimary: dto.isPrimary || false,
      },
    });
  }

  async updateBirthProfile(clerkUserId: string, profileId: string, dto: UpdateBirthProfileDto) {
    const user = await this.ensureUser(clerkUserId);

    const profile = await this.prisma.birthProfile.findFirst({
      where: { id: profileId, userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    // If setting as primary, unset other primaries
    if (dto.isPrimary) {
      await this.prisma.birthProfile.updateMany({
        where: { userId: user.id, isPrimary: true, id: { not: profileId } },
        data: { isPrimary: false },
      });
    }

    const updateData: Record<string, unknown> = { ...dto };
    if (dto.birthDate) {
      updateData.birthDate = new Date(dto.birthDate);
    }

    return this.prisma.birthProfile.update({
      where: { id: profileId },
      data: updateData,
    });
  }

  async deleteBirthProfile(clerkUserId: string, profileId: string) {
    const user = await this.ensureUser(clerkUserId);

    const profile = await this.prisma.birthProfile.findFirst({
      where: { id: profileId, userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    await this.prisma.birthProfile.delete({
      where: { id: profileId },
    });

    return { deleted: true };
  }

  async getBirthProfile(clerkUserId: string, profileId: string) {
    const user = await this.ensureUser(clerkUserId);

    const profile = await this.prisma.birthProfile.findFirst({
      where: { id: profileId, userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Birth profile not found');
    }

    return profile;
  }

  // ============ Reading History ============

  async getReadingHistory(clerkUserId: string, page = 1, limit = 20) {
    limit = Math.min(Math.max(limit, 1), 100); // Clamp to 1-100
    const user = await this.ensureUser(clerkUserId);

    // Fetch both individual readings and comparisons
    const [readings, comparisons, readingCount, comparisonCount] = await Promise.all([
      this.prisma.baziReading.findMany({
        where: { userId: user.id },
        include: {
          birthProfile: { select: { name: true, birthDate: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.baziComparison.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          comparisonType: true,
          creditsUsed: true,
          createdAt: true,
          profileA: { select: { name: true, birthDate: true } },
          profileB: { select: { name: true, birthDate: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.baziReading.count({ where: { userId: user.id } }),
      this.prisma.baziComparison.count({ where: { userId: user.id } }),
    ]);

    // Normalize comparisons into the same shape as readings
    const normalizedComparisons = comparisons.map((c) => ({
      id: c.id,
      readingType: 'COMPATIBILITY',
      creditsUsed: c.creditsUsed,
      createdAt: c.createdAt,
      birthProfile: c.profileA,    // Primary person
      profileB: c.profileB,        // Second person (extra field for comparisons)
      comparisonType: c.comparisonType,
      isComparison: true,
    }));

    // Merge and sort by date descending
    const merged = [
      ...readings.map((r) => ({ ...r, isComparison: false })),
      ...normalizedComparisons,
    ].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Paginate the merged list
    const total = readingCount + comparisonCount;
    const paged = merged.slice((page - 1) * limit, page * limit);

    return {
      data: paged,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ============ Internal Helpers ============

  private async ensureUser(clerkUserId: string) {
    let user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });

    if (!user) {
      // Auto-create user record if not found (e.g., webhook not configured)
      this.logger.warn(`User ${clerkUserId} not in DB — auto-creating`);
      user = await this.prisma.user.create({
        data: { clerkUserId },
      });
    }

    return user;
  }
}
