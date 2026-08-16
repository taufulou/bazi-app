/**
 * Section Unlock Service — Per-section unlock for AI reading sections (Stream 3).
 *
 * Allows users to unlock individual AI reading sections without buying a full reading.
 * Core 5 unlockable sections: personality, career, love, finance, health
 *
 * Unlock methods:
 * - CREDIT: Deduct credits (admin-configurable cost per reading type via Service.sectionUnlockCreditCost)
 * - AD_REWARD: Verified via AdRewardLog (future — mobile only)
 * - SUBSCRIPTION: Auto-unlocked for subscribers (checked in reading retrieval, not stored)
 *
 * Validation (per plan Issue #31):
 * 1. Reading exists
 * 2. Reading belongs to requesting user
 * 3. Reading has AI interpretation (not chart-only)
 * 4. Section key exists in the interpretation data
 * 5. Section key is one of the core 5
 * 6. Not already unlocked (unique constraint)
 *
 * All credit operations wrapped in $transaction (Issue #27, #D7).
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';

// ============================================================
// Constants
// ============================================================

/** Core 5 unlockable section keys */
const VALID_SECTION_KEYS = [
  'personality',
  'career',
  'love',
  'finance',
  'health',
] as const;

type SectionKey = (typeof VALID_SECTION_KEYS)[number];

/**
 * Valid reading types for section unlock.
 *
 * ⚠️ `'zwds'` stays on purpose, even though the ZWDS module was deleted. Two
 * already-paid `ZWDS_LIFETIME` readings still render, and dropping this would
 * make their sections permanently unlockable — the one outcome the deletion was
 * designed to avoid. It grants no ability to CREATE anything.
 */
const VALID_READING_TYPES = ['bazi', 'zwds'] as const;

type ReadingType = (typeof VALID_READING_TYPES)[number];

// ============================================================
// Service
// ============================================================

@Injectable()
export class SectionUnlockService {
  private readonly logger = new Logger(SectionUnlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Kill switch shared with AdsService — see the `ad_reward` branch in `unlockSection`.
   * Read per-call so the flag is flip-and-restart, not a code change.
   */
  private adRewardsEnabled(): boolean {
    return this.config.get<string>('ADS_REWARDS_ENABLED') === '1';
  }

  /**
   * Feature switch for per-section unlocking as a whole (F3, owner decision
   * 2026-08-13: "disable it").
   *
   * WHY: unlock rows grant nothing. `SectionUnlock` is read only by
   * `getUnlockedSections` (metadata), `getReadingWithSectionAccess` (dead — no
   * caller anywhere in src/), and admin stats. Neither `getReading` nor the
   * reading SSE stream joins the table, so an unlock changes nothing a user can
   * observe — while the `credit` method debits real credits for it. Selling an
   * inert row is worse than not selling it, so the endpoint refuses until the
   * feature is actually wired into content delivery.
   *
   * Safe to disable: zero client callers (verified across apps/web + apps/mobile
   * — only the admin monetization page reads aggregate stats, via a different
   * admin endpoint) and **zero rows in section_unlocks at the time of the
   * change**, so nobody has ever paid for one and there is no refund liability.
   *
   * To re-enable, the delivery path must consult the table first: join
   * `SectionUnlock` in `getReading` and in `emitStaticSections`, and fix the
   * dead owner-check at `bazi.service.ts:554` so unpaid states actually receive
   * previews (F2). Then set SECTION_UNLOCK_ENABLED=1. The flag alone sells the
   * inert row again.
   */
  private sectionUnlockEnabled(): boolean {
    return this.config.get<string>('SECTION_UNLOCK_ENABLED') === '1';
  }

  /**
   * Get all unlocked sections for a reading.
   */
  async getUnlockedSections(
    clerkUserId: string,
    readingId: string,
  ): Promise<{ sections: string[]; isSubscriber: boolean }> {
    const user = await this.findUserOrThrow(clerkUserId);
    const isSubscriber = user.subscriptionTier !== 'FREE';

    const unlocks = await this.prisma.sectionUnlock.findMany({
      where: {
        userId: user.id,
        readingId,
        isRefunded: false,
      },
      select: { sectionKey: true },
    });

    return {
      sections: unlocks.map((u) => u.sectionKey),
      isSubscriber,
    };
  }

  /**
   * Unlock a specific section of a reading.
   *
   * @param clerkUserId - Clerk user ID from JWT
   * @param readingId - ID of the BaziReading or ZWDS reading
   * @param readingType - "bazi" or "zwds"
   * @param sectionKey - One of the core 5 section keys
   * @param method - "credit" or "ad_reward"
   */
  async unlockSection(
    clerkUserId: string,
    readingId: string,
    readingType: string,
    sectionKey: string,
    method: 'credit' | 'ad_reward',
  ): Promise<{ success: boolean; sectionKey: string; creditsUsed: number }> {
    // ---- Feature switch (F3) — checked FIRST, before any validation ----
    // Ahead of everything else so a disabled deployment charges nobody and
    // leaks no oracle (not even which section keys or reading types are valid).
    // Outranks ADS_REWARDS_ENABLED: with the feature off, BOTH methods refuse.
    if (!this.sectionUnlockEnabled()) {
      this.logger.warn(
        `Section unlock REJECTED (SECTION_UNLOCK_ENABLED is off): ` +
        `user=${clerkUserId}, reading=${readingId}, section=${sectionKey}, method=${method}`,
      );
      throw new BadRequestException({
        code: 'SECTION_UNLOCK_DISABLED',
        message: '單章節解鎖功能目前未開放。',
      });
    }

    // ---- Validate reading type ----
    if (!VALID_READING_TYPES.includes(readingType as ReadingType)) {
      throw new BadRequestException(
        `Invalid reading type "${readingType}". Must be one of: ${VALID_READING_TYPES.join(', ')}`,
      );
    }

    // ---- Validate section key ----
    if (!VALID_SECTION_KEYS.includes(sectionKey as SectionKey)) {
      throw new BadRequestException(
        `Invalid section key "${sectionKey}". Must be one of: ${VALID_SECTION_KEYS.join(', ')}`,
      );
    }

    // ---- Find user ----
    const user = await this.findUserOrThrow(clerkUserId);

    // ---- Validate reading exists and belongs to user ----
    const reading = await this.prisma.baziReading.findUnique({
      where: { id: readingId },
      select: {
        id: true,
        userId: true,
        aiInterpretation: true,
        readingType: true,
      },
    });

    if (!reading) {
      throw new NotFoundException(`Reading "${readingId}" not found`);
    }

    // ---- Verify ownership ----
    if (reading.userId !== user.id) {
      throw new ForbiddenException('You do not have access to this reading');
    }

    // ---- Verify reading has AI interpretation ----
    if (!reading.aiInterpretation) {
      throw new BadRequestException(
        'This reading does not have AI interpretation (chart-only). Cannot unlock sections.',
      );
    }

    // ---- Verify section exists in interpretation data ----
    const interpretation = reading.aiInterpretation as Record<string, unknown>;
    const sections = interpretation.sections as Record<string, unknown> | undefined;

    if (!sections || !(sectionKey in sections)) {
      throw new BadRequestException(
        `Section "${sectionKey}" does not exist in this reading's interpretation`,
      );
    }

    // ---- Check if already unlocked ----
    const existingUnlock = await this.prisma.sectionUnlock.findUnique({
      where: {
        userId_readingId_sectionKey: {
          userId: user.id,
          readingId,
          sectionKey,
        },
      },
    });

    if (existingUnlock && !existingUnlock.isRefunded) {
      // Already unlocked — return success idempotently
      return {
        success: true,
        sectionKey,
        creditsUsed: 0,
      };
    }

    // ---- Determine unlock cost ----
    let creditsUsed = 0;

    if (method === 'credit') {
      // Look up the service's sectionUnlockCreditCost (admin-configurable)
      const readingTypeStr = reading.readingType;
      const service = await this.prisma.service.findFirst({
        where: { type: readingTypeStr, isActive: true },
        select: { sectionUnlockCreditCost: true },
      });

      const cost = service?.sectionUnlockCreditCost ?? 1; // Default to 1 credit

      // ---- Atomic credit deduction + unlock creation in $transaction ----
      await this.prisma.$transaction(async (tx) => {
        await this.creditsService.deductCredits(
          user.id,
          cost,
          `section-unlock:${readingType}.${sectionKey}`,
          { readingId, tx },
        );

        await tx.sectionUnlock.create({
          data: {
            userId: user.id,
            readingId,
            readingType: readingType as string,
            sectionKey,
            unlockMethod: 'CREDIT',
            creditsUsed: cost,
          },
        });
      });

      creditsUsed = cost;
    } else if (method === 'ad_reward') {
      // ⚠️ FREE-UNLOCK VECTOR — disabled by default (`ADS_REWARDS_ENABLED`, default '0').
      //
      // This branch grants a paid section for `creditsUsed: 0` and verifies
      // NOTHING: no AdRewardLog lookup, no AdMob SSV, no proof an ad was ever
      // shown. Any authenticated user could unlock every paid section of every
      // reading they own with one POST. No client calls it today (verified: zero
      // `ad_reward` references in apps/web + apps/mobile), so the gate is
      // behaviour-preserving for real traffic.
      //
      // The DTO deliberately still ACCEPTS `method: 'ad_reward'` (see
      // UnlockSectionDto) — a static `@IsIn` decorator cannot be env-toggled, so
      // rejecting there would make the flag a lie and re-enabling a code change.
      // Enforcement belongs here, where the flag can actually govern it.
      //
      // To re-enable, BOTH must land: (1) AdMob SSV wired into AdsService.claimReward
      // so an AdRewardLog row proves a real view, and (2) this branch consuming an
      // unconsumed log row scoped to (userId, readingId, sectionKey) — the schema
      // already carries those fields. Then set ADS_REWARDS_ENABLED=1.
      if (!this.adRewardsEnabled()) {
        this.logger.warn(
          `Ad-reward unlock REJECTED (ADS_REWARDS_ENABLED is off): ` +
          `user=${user.id}, reading=${readingId}, section=${sectionKey}`,
        );
        throw new BadRequestException({
          code: 'ADS_REWARDS_DISABLED',
          message: '廣告解鎖功能目前未開放，請使用點數解鎖。',
        });
      }

      await this.prisma.sectionUnlock.create({
        data: {
          userId: user.id,
          readingId,
          readingType: readingType as string,
          sectionKey,
          unlockMethod: 'AD_REWARD',
          creditsUsed: 0,
        },
      });
    }

    this.logger.log(
      `Section unlocked: user=${user.id}, reading=${readingId}, ` +
      `section=${sectionKey}, method=${method}, credits=${creditsUsed}`,
    );

    return {
      success: true,
      sectionKey,
      creditsUsed,
    };
  }

  /**
   * Get a reading with section access information.
   * Subscribers get all sections with .full; non-subscribers get .preview for locked sections.
   */
  async getReadingWithSectionAccess(
    clerkUserId: string,
    readingId: string,
  ): Promise<{
    isSubscriber: boolean;
    unlockedSections: string[];
    allSections: string[];
  }> {
    const user = await this.findUserOrThrow(clerkUserId);
    const isSubscriber = user.subscriptionTier !== 'FREE';

    // Get the reading
    const reading = await this.prisma.baziReading.findUnique({
      where: { id: readingId },
      select: {
        userId: true,
        aiInterpretation: true,
      },
    });

    if (!reading) {
      throw new NotFoundException(`Reading "${readingId}" not found`);
    }

    if (reading.userId !== user.id) {
      throw new ForbiddenException('You do not have access to this reading');
    }

    // Get all section keys from interpretation
    const interpretation = reading.aiInterpretation as Record<string, unknown> | null;
    const sections = interpretation?.sections as Record<string, unknown> | undefined;
    const allSections = sections ? Object.keys(sections) : [];

    if (isSubscriber) {
      // Subscribers see all sections
      return {
        isSubscriber: true,
        unlockedSections: allSections,
        allSections,
      };
    }

    // Non-subscriber: check which sections are unlocked
    const unlocks = await this.prisma.sectionUnlock.findMany({
      where: {
        userId: user.id,
        readingId,
        isRefunded: false,
      },
      select: { sectionKey: true },
    });

    return {
      isSubscriber: false,
      unlockedSections: unlocks.map((u) => u.sectionKey),
      allSections,
    };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private async findUserOrThrow(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
