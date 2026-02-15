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
import { PrismaService } from '../prisma/prisma.service';

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

/** Valid reading types for section unlock */
const VALID_READING_TYPES = ['bazi', 'zwds'] as const;

type ReadingType = (typeof VALID_READING_TYPES)[number];

// ============================================================
// Service
// ============================================================

@Injectable()
export class SectionUnlockService {
  private readonly logger = new Logger(SectionUnlockService.name);

  constructor(private readonly prisma: PrismaService) {}

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
        // Deduct credits — uses updateMany with WHERE credits >= cost to prevent going negative
        const updated = await tx.user.updateMany({
          where: { id: user.id, credits: { gte: cost } },
          data: { credits: { decrement: cost } },
        });

        if (updated.count === 0) {
          throw new BadRequestException(
            `Insufficient credits. Section unlock costs ${cost} credit(s), but you have ${user.credits}.`,
          );
        }

        // Create section unlock record
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
      // For ad_reward: verify that a recent valid ad claim exists for this section
      // V1 (web): ad rewards are mock-only, just create the unlock
      // V2 (mobile): will verify via AdMob SSV callback

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
