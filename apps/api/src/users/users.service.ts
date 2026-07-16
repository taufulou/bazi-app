import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReadingType } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateBirthProfileDto, UpdateBirthProfileDto } from './dto/create-birth-profile.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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

  /**
   * Permanently delete (anonymize) the current user's account. Apple 5.1.1(v)
   * requires an in-app account-deletion path.
   *
   * Order: guard active IAP subs (can't be cancelled server-side — the caller
   * must confirm they cancelled in the store) → cancel Stripe subs → delete the
   * RevenueCat subscriber → delete the Clerk user → anonymize the DB row
   * (financial records preserved for compliance, mirroring the Clerk
   * `user.deleted` webhook). Steps 2–4 are best-effort so a third-party hiccup
   * never blocks the anonymize.
   */
  async deleteAccount(
    clerkUserId: string,
    opts?: { acknowledgedIapCancellation?: boolean },
  ): Promise<{ deleted: true }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
      include: { subscriptions: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 1. Apple/Google subs cannot be cancelled from our backend — the user must
    // cancel in the store. Block until they acknowledge (the FE shows an
    // interstitial with a manage-subscription deep link).
    const activeIap = user.subscriptions.filter(
      (s) =>
        s.status === 'ACTIVE' && (s.platform === 'APPLE_IAP' || s.platform === 'GOOGLE_PLAY'),
    );
    if (activeIap.length > 0 && !opts?.acknowledgedIapCancellation) {
      throw new ForbiddenException({
        code: 'ACTIVE_IAP_SUBSCRIPTION',
        message: '請先於 App Store／Google Play 取消訂閱後再刪除帳號。',
        platforms: Array.from(new Set(activeIap.map((s) => s.platform))),
      });
    }

    // 2. Cancel active Stripe subs (best-effort).
    const activeStripe = user.subscriptions.filter(
      (s) => s.status === 'ACTIVE' && s.platform === 'STRIPE' && s.stripeSubscriptionId,
    );
    if (activeStripe.length > 0) {
      const stripe = this.getStripeClient();
      if (stripe) {
        for (const s of activeStripe) {
          try {
            await stripe.subscriptions.cancel(s.stripeSubscriptionId as string);
          } catch (err) {
            this.logger.error(
              `deleteAccount: failed to cancel Stripe sub ${s.stripeSubscriptionId}: ${err}`,
            );
          }
        }
      }
    }

    // 3. Delete the RevenueCat subscriber (best-effort).
    await this.deleteRevenueCatSubscriber(clerkUserId);

    // 4. Delete the Clerk user (best-effort — anonymize proceeds regardless).
    await this.deleteClerkUser(clerkUserId);

    // 5. Anonymize the DB row (synchronous; preserves financial records).
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: '[deleted]',
        avatarUrl: null,
        clerkUserId: `deleted_${clerkUserId}_${Date.now()}`,
        credits: 0,
        subscriptionTier: 'FREE',
      },
    });

    this.logger.warn(`Account deleted (anonymized): user ${user.id}`);
    return { deleted: true };
  }

  private getStripeClient(): Stripe | null {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      this.logger.warn('deleteAccount: STRIPE_SECRET_KEY not set — skipping Stripe cancel');
      return null;
    }
    return new Stripe(key);
  }

  private async deleteClerkUser(clerkUserId: string): Promise<void> {
    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('deleteAccount: CLERK_SECRET_KEY not set — skipping Clerk user delete');
      return;
    }
    try {
      const clerk = createClerkClient({ secretKey });
      await clerk.users.deleteUser(clerkUserId);
    } catch (err) {
      this.logger.error(`deleteAccount: failed to delete Clerk user ${clerkUserId}: ${err}`);
    }
  }

  private async deleteRevenueCatSubscriber(appUserId: string): Promise<void> {
    const apiKey = this.config.get<string>('RC_API_KEY');
    if (!apiKey) {
      this.logger.warn('deleteAccount: RC_API_KEY not set — skipping RevenueCat subscriber delete');
      return;
    }
    try {
      const res = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!res.ok && res.status !== 404) {
        this.logger.error(`deleteAccount: RevenueCat delete returned ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`deleteAccount: failed to delete RevenueCat subscriber ${appUserId}: ${err}`);
    }
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

    // 時辰未知: store birthTime as null and hourKnown=false (immutable after creation).
    const hourKnown = dto.hourKnown !== false; // default true
    return this.prisma.birthProfile.create({
      data: {
        userId: user.id,
        name: dto.name,
        birthDate: new Date(dto.birthDate),
        birthTime: hourKnown ? (dto.birthTime ?? null) : null,
        hourKnown,
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

    // D3 — hour state (hourKnown) is IMMUTABLE per profile (set at creation only;
    // to add/remove an hour the user creates a NEW profile). Enforce it here so an
    // edit can never (a) flip hourKnown, nor (b) write a birthTime onto a 3-pillar
    // (hour-unknown) profile — which would leave an inconsistent hourKnown=false +
    // birthTime!=null row that silently mis-renders downstream (BUG-2, QA 2026-06-15).
    delete (updateData as { hourKnown?: unknown }).hourKnown;
    if (!profile.hourKnown) {
      delete (updateData as { birthTime?: unknown }).birthTime;
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

  async getReadingHistory(clerkUserId: string, page = 1, limit = 20, type?: string) {
    limit = Math.min(Math.max(limit, 1), 100); // Clamp to 1-100
    const user = await this.ensureUser(clerkUserId);

    // Validate ?type= against the Prisma enum. Throws if user supplies an unknown string.
    if (type && !Object.values(ReadingType).includes(type as ReadingType)) {
      throw new BadRequestException(`Invalid reading type: ${type}`);
    }

    // Reading-only branch (LIFETIME, ANNUAL, CAREER, LOVE, HEALTH, ZWDS_*)
    if (type && type !== ReadingType.COMPATIBILITY) {
      const where = { userId: user.id, readingType: type as ReadingType };
      const [readings, total] = await Promise.all([
        this.prisma.baziReading.findMany({
          where,
          select: {
            id: true,
            readingType: true,
            creditsUsed: true,
            createdAt: true,
            targetYear: true,
            birthProfile: { select: { name: true, birthDate: true } },
          },
          // Secondary `id` sort key guards against ties on `createdAt` to the ms
          // (e.g. batch seeds) — without it, skip-based pagination could drop or
          // duplicate rows.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: (page - 1) * limit,
        }),
        this.prisma.baziReading.count({ where }),
      ]);

      const data = readings.map((r) => ({ ...r, isComparison: false }));
      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    // Comparison-only branch
    if (type === ReadingType.COMPATIBILITY) {
      const where = { userId: user.id };
      const [comparisons, total] = await Promise.all([
        this.prisma.baziComparison.findMany({
          where,
          select: {
            id: true,
            comparisonType: true,
            creditsUsed: true,
            createdAt: true,
            profileA: { select: { name: true, birthDate: true } },
            profileB: { select: { name: true, birthDate: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: (page - 1) * limit,
        }),
        this.prisma.baziComparison.count({ where }),
      ]);

      // Normalize to match the merged-path shape so any future consumer sees the same fields.
      const data = comparisons.map((c) => ({
        id: c.id,
        readingType: 'COMPATIBILITY',
        creditsUsed: c.creditsUsed,
        createdAt: c.createdAt,
        birthProfile: c.profileA,
        profileB: c.profileB,
        comparisonType: c.comparisonType,
        isComparison: true,
      }));
      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    // Legacy merged branch (no ?type= provided) — powers the unified /dashboard/readings page
    // TODO: This branch still fetches all rows per user and paginates in memory.
    // Fixing requires a two-table merge strategy (UNION / raw SQL / over-fetch+sort).
    // Deferred — impact is bounded because most users have <1000 readings total.
    const [readings, comparisons, readingCount, comparisonCount] = await Promise.all([
      this.prisma.baziReading.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          readingType: true,
          creditsUsed: true,
          createdAt: true,
          targetYear: true,
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

    const normalizedComparisons = comparisons.map((c) => ({
      id: c.id,
      readingType: 'COMPATIBILITY',
      creditsUsed: c.creditsUsed,
      createdAt: c.createdAt,
      birthProfile: c.profileA,
      profileB: c.profileB,
      comparisonType: c.comparisonType,
      isComparison: true,
    }));

    const merged = [
      ...readings.map((r) => ({ ...r, isComparison: false })),
      ...normalizedComparisons,
    ].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = readingCount + comparisonCount;
    const paged = merged.slice((page - 1) * limit, page * limit);

    return {
      data: paged,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
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
        data: { clerkUserId, credits: 3 },
      });
    }

    return user;
  }
}
