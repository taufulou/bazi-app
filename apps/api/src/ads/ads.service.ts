/**
 * Ads Service — Rewarded video ad backend infrastructure (Stream 4).
 *
 * Daily limit: 5 rewarded ad views per user.
 * Counter: Redis atomic INCR on key `ad:daily:{userId}:{YYYY-MM-DD}` with 24h TTL.
 *
 * Reward types:
 * - CREDIT: Watch ad → earn 1 free credit
 * - SECTION_UNLOCK: Watch ad → unlock 1 section of a reading
 * - DAILY_HOROSCOPE: Watch ad → view daily ZWDS horoscope (future)
 *
 * V1 (web): Trust client callback (mock ads). No server-side ad completion verification.
 * V2 (mobile): Verify via AdMob SSV (Server-Side Verification) callback URL.
 *
 * All credit operations wrapped in $transaction (Issue #7, #D7).
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// ============================================================
// Constants
// ============================================================

/** Maximum rewarded ad views per user per day */
const MAX_DAILY_AD_VIEWS = 5;

/** Redis key TTL in seconds (24 hours) */
const DAILY_COUNTER_TTL = 86400;

/** Credits granted per ad view (for CREDIT reward type) */
const CREDITS_PER_AD_VIEW = 1;

// Inline ad reward type strings (no @repo/shared import — see CLAUDE.md)
type AdRewardType = 'CREDIT' | 'SECTION_UNLOCK' | 'DAILY_HOROSCOPE';

// ============================================================
// Service
// ============================================================

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Get ad configuration (public endpoint).
   * Returns ad unit IDs, reward types, and daily limits.
   */
  getAdConfig(): {
    adUnitIds: { rewarded: string };
    maxDailyViews: number;
    rewardTypes: string[];
    creditsPerAdView: number;
  } {
    return {
      adUnitIds: {
        // Placeholder — real AdMob unit IDs configured in mobile app
        rewarded: 'ca-app-pub-XXXXX/YYYYY',
      },
      maxDailyViews: MAX_DAILY_AD_VIEWS,
      rewardTypes: ['CREDIT', 'SECTION_UNLOCK', 'DAILY_HOROSCOPE'],
      creditsPerAdView: CREDITS_PER_AD_VIEW,
    };
  }

  /**
   * Get remaining daily ad views for a user.
   * Uses Redis atomic counter: `ad:daily:{userId}:{YYYY-MM-DD}`
   */
  async getRemainingViews(clerkUserId: string): Promise<{
    remainingDailyViews: number;
    maxDailyViews: number;
    viewsUsedToday: number;
  }> {
    const user = await this.findUserOrThrow(clerkUserId);
    const key = this.getDailyKey(user.id);
    const count = await this.redis.getRateLimit(key);

    return {
      remainingDailyViews: Math.max(0, MAX_DAILY_AD_VIEWS - count),
      maxDailyViews: MAX_DAILY_AD_VIEWS,
      viewsUsedToday: count,
    };
  }

  /**
   * Claim a reward after ad completion.
   *
   * Flow:
   * 1. Check daily limit via Redis atomic INCR
   * 2. If CREDIT: increment user.credits + create AdRewardLog
   * 3. If SECTION_UNLOCK: create AdRewardLog (section unlock handled by SectionUnlockService)
   * 4. If DAILY_HOROSCOPE: create AdRewardLog (access checked separately)
   *
   * @param clerkUserId - Clerk user ID from JWT
   * @param rewardType - Type of reward to claim
   * @param adPlacementId - Ad network placement ID (for verification in V2)
   * @param readingId - Reading ID (required for SECTION_UNLOCK)
   * @param sectionKey - Section key (required for SECTION_UNLOCK)
   */
  async claimReward(
    clerkUserId: string,
    rewardType: string,
    adPlacementId?: string,
    readingId?: string,
    sectionKey?: string,
  ): Promise<{
    success: boolean;
    creditsGranted: number;
    remainingDailyViews: number;
  }> {
    // ---- Validate reward type ----
    const validTypes: AdRewardType[] = ['CREDIT', 'SECTION_UNLOCK', 'DAILY_HOROSCOPE'];
    if (!validTypes.includes(rewardType as AdRewardType)) {
      throw new BadRequestException(
        `Invalid reward type "${rewardType}". Must be one of: ${validTypes.join(', ')}`,
      );
    }

    // ---- Validate SECTION_UNLOCK requires readingId and sectionKey ----
    if (rewardType === 'SECTION_UNLOCK') {
      if (!readingId) {
        throw new BadRequestException('readingId is required for SECTION_UNLOCK reward type');
      }
      if (!sectionKey) {
        throw new BadRequestException('sectionKey is required for SECTION_UNLOCK reward type');
      }
    }

    // ---- Find user ----
    const user = await this.findUserOrThrow(clerkUserId);

    // ---- Check daily limit via Redis atomic INCR ----
    const key = this.getDailyKey(user.id);
    const newCount = await this.redis.incrementRateLimit(key, DAILY_COUNTER_TTL);

    if (newCount > MAX_DAILY_AD_VIEWS) {
      this.logger.warn(
        `Daily ad limit reached for user ${user.id}: ${newCount}/${MAX_DAILY_AD_VIEWS}`,
      );
      throw new BadRequestException(
        `Daily ad limit reached (${MAX_DAILY_AD_VIEWS} views per day). Please try again tomorrow.`,
      );
    }

    // ---- Process reward ----
    let creditsGranted = 0;

    if (rewardType === 'CREDIT') {
      // Atomically increment credits + create log
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { credits: { increment: CREDITS_PER_AD_VIEW } },
        });

        await tx.adRewardLog.create({
          data: {
            userId: user.id,
            rewardType: 'CREDIT',
            adNetworkId: adPlacementId || null,
            creditsGranted: CREDITS_PER_AD_VIEW,
          },
        });
      });

      creditsGranted = CREDITS_PER_AD_VIEW;

      this.logger.log(
        `Ad reward claimed: user=${user.id}, type=CREDIT, credits=${CREDITS_PER_AD_VIEW}, daily=${newCount}/${MAX_DAILY_AD_VIEWS}`,
      );
    } else if (rewardType === 'SECTION_UNLOCK') {
      // Create ad reward log (section unlock itself handled by SectionUnlockService)
      await this.prisma.adRewardLog.create({
        data: {
          userId: user.id,
          rewardType: 'SECTION_UNLOCK',
          adNetworkId: adPlacementId || null,
          creditsGranted: 0,
          sectionKey: sectionKey || null,
          readingId: readingId || null,
        },
      });

      this.logger.log(
        `Ad reward claimed: user=${user.id}, type=SECTION_UNLOCK, reading=${readingId}, section=${sectionKey}, daily=${newCount}/${MAX_DAILY_AD_VIEWS}`,
      );
    } else if (rewardType === 'DAILY_HOROSCOPE') {
      // Create ad reward log
      await this.prisma.adRewardLog.create({
        data: {
          userId: user.id,
          rewardType: 'DAILY_HOROSCOPE',
          adNetworkId: adPlacementId || null,
          creditsGranted: 0,
        },
      });

      this.logger.log(
        `Ad reward claimed: user=${user.id}, type=DAILY_HOROSCOPE, daily=${newCount}/${MAX_DAILY_AD_VIEWS}`,
      );
    }

    const remaining = Math.max(0, MAX_DAILY_AD_VIEWS - newCount);

    return {
      success: true,
      creditsGranted,
      remainingDailyViews: remaining,
    };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Get the Redis key for the daily ad counter.
   * Format: ad:daily:{userId}:{YYYY-MM-DD} (UTC date)
   */
  private getDailyKey(userId: string): string {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC
    return `ad:daily:${userId}:${today}`;
  }

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
