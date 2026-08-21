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
import { AIService } from '../ai/ai.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateBirthProfileDto, UpdateBirthProfileDto } from './dto/create-birth-profile.dto';
import {
  isUniqueConstraintViolation,
  recordSignupBonusLedger,
  resolveSignupCredits,
} from '../common/signup-bonus';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  /** A4 — see `createBirthProfile`. Env-tunable without a redeploy of logic. */
  private maxBirthProfilesPerUser(): number {
    const raw = this.config.get<string>('BIRTH_PROFILE_MAX_PER_USER');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  }

  constructor(
    private prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiService: AIService,
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

    // 2. ERASE FIRST. This used to run last, after the Clerk user had already
    //    been deleted — and unlike the third-party calls it is not best-effort.
    //    If it threw (Prisma's default interactive-transaction timeout is 5s and
    //    a heavy account can exceed it), the exception propagated and the
    //    anonymize never ran, leaving: Stripe cancelled, Clerk identity gone,
    //    every birth profile and chat message intact, and the row not even
    //    anonymized — with no way back in, since `DELETE /users/me` is the only
    //    deletion endpoint and it authenticates with the Clerk session that no
    //    longer exists.
    //
    //    Erasing before the irreversible external deletes means a failure here
    //    is a clean, retryable no-op: the user still has their account.
    await this.erasePersonalData(user.id);

    // 3. Cancel active Stripe subs (best-effort).
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

    // 4. Delete the RevenueCat subscriber (best-effort).
    await this.deleteRevenueCatSubscriber(clerkUserId);

    // 5. Delete the Clerk user (best-effort — anonymize proceeds regardless).
    //    NOTE this fires the `user.deleted` webhook, which now also erases.
    //    Both are idempotent.
    await this.deleteClerkUser(clerkUserId);

    // 6. C1 — anonymize what must be retained (the erase happened at step 2).
    //
    // This step did not exist. The method anonymized the `User` row and stopped,
    // on the reasoning that deleting the row would take the financial records
    // with it (every money table is `onDelete: Cascade` from User). The instinct
    // was right and the execution inverted it: because NO row was ever deleted,
    // NONE of the declared cascades fired, and "delete my account" left behind
    // every birth profile (date, time, city, coordinates, gender — the actual
    // sensitive data), every reading, every comparison, every chat message the
    // user typed, and every fortune snapshot. Only the display name and the
    // Clerk link were cleared.
    //
    // So: delete the PII-bearing tables explicitly, keep the financial ones, and
    // anonymize the row that ties them together.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: '[deleted]',
        avatarUrl: null,
        clerkUserId: `deleted_${clerkUserId}_${Date.now()}`,
        credits: 0,
        subscriptionTier: 'FREE',
        // Device fingerprint is an identifier in its own right (it exists to
        // link anonymous sessions to a person) and has no financial purpose.
        deviceFingerprint: null,
      },
    });

    this.logger.warn(`Account deleted (PII erased, financial records retained): user ${user.id}`);
    return { deleted: true };
  }

  /**
   * Delete every table that holds personal data for this user, keeping the
   * financial/accounting record intact.
   *
   * RETAINED, deliberately: `Transaction`, `Subscription`, `CreditLedger`,
   * `MonthlyCreditsLog`, `AdRewardLog`, `SectionUnlock`. These are money and
   * entitlement history — amounts, tiers, timestamps, provider ids. They carry
   * no birth data and no free text, and they are what a chargeback, a tax
   * question or a double-grant investigation needs. `AIUsageLog.userId` is
   * `SetNull`, so it detaches on its own if the row is ever removed.
   *
   * ORDER IS LOAD-BEARING. `DailyFortuneSnapshot.birthProfileId` is `SetNull`,
   * not `Cascade` — deleting profiles first would ORPHAN the snapshots rather
   * than remove them, leaving the narrative text and a `chartHash` (a hash of
   * the birth pillars) with nothing left to attribute them to and no way to find
   * them again. Snapshots must go first, while the link still exists.
   */
  async erasePersonalData(userId: string): Promise<void> {
    const profiles = await this.prisma.birthProfile.findMany({
      where: { userId },
      select: {
        id: true,
        birthDate: true,
        birthTime: true,
        birthCity: true,
        gender: true,
      },
    });
    const profileIds = profiles.map((p) => p.id);

    // Content-addressed cache rows for this person's readings. Keyed by a hash
    // of the birth data (not by user), so they survive every cascade — and they
    // hold the full interpretation JSON. Bounded precisely by the user's OWN
    // readings, because the key includes readingType and targetYear and cannot
    // be enumerated blind.
    const readings = await this.prisma.baziReading.findMany({
      where: { userId },
      select: { readingType: true, targetYear: true, birthProfileId: true },
    });
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const cacheHashes = [
      ...new Set(
        readings
          .map((r) => {
            const p = byId.get(r.birthProfileId);
            if (!p) return null;
            return this.aiService.generateBirthDataHash(
              p.birthDate.toISOString().split('T')[0],
              p.birthTime ?? 'HOUR_UNKNOWN',
              p.birthCity,
              p.gender.toLowerCase(),
              r.readingType,
              r.targetYear ?? undefined,
            );
          })
          .filter((h): h is string => h !== null),
      ),
    ];

    await this.prisma.$transaction(async (tx) => {
      // 1. Fortune snapshots — BEFORE the profiles (SetNull would orphan them).
      if (profileIds.length > 0) {
        await tx.dailyFortuneSnapshot.deleteMany({
          where: { birthProfileId: { in: profileIds } },
        });
      }

      // 2. Chat. Sessions cascade to their messages, which are free text the
      //    user typed — the most obviously personal content we hold.
      await tx.chatSession.deleteMany({ where: { userId } });
      await tx.chatMonthlyUsage.deleteMany({ where: { userId } });

      // 3. Readings and comparisons (interpretation text about this person).
      await tx.baziComparison.deleteMany({ where: { userId } });
      await tx.baziReading.deleteMany({ where: { userId } });

      // 4. The birth data itself.
      await tx.birthProfile.deleteMany({ where: { userId } });

      // 5. The cache copies of their readings.
      if (cacheHashes.length > 0) {
        await tx.readingCache.deleteMany({
          where: { birthDataHash: { in: cacheHashes } },
        });
      }
    }, {
      // Default is 5s. This is up to seven statements across six tables with
      // cascades underneath; a long-lived account can exceed it, and a timeout
      // here used to strand the user permanently (see step 2).
      timeout: 30_000,
    });

    this.logger.log(
      `erasePersonalData user=${userId}: ${profileIds.length} profiles, ` +
        `${readings.length} readings, ${cacheHashes.length} cache entries`,
    );
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

    // A4: cap profiles per user.
    //
    // Profiles are the multiplier on free AI generation: the fortune free tier
    // is scoped per profile per day, so an uncapped account can mint one free
    // narration per profile per day — hundreds of profiles is hundreds of daily
    // Anthropic calls from a single free account, which is denial-of-wallet
    // rather than ordinary use. 10 is far above any genuine use (self plus
    // family and a few friends) and is env-tunable if that proves wrong.
    //
    // Not race-proof by design: two concurrent creates can both observe count
    // 9 and produce 11. A DB-level constraint cannot express "count per user",
    // and the exposure of overshooting by a handful is negligible against the
    // vector this closes, whereas a transaction here would serialize an
    // ordinary user action. The per-user daily quotas (S4) are the tight bound.
    const profileCount = await this.prisma.birthProfile.count({
      where: { userId: user.id },
    });
    if (profileCount >= this.maxBirthProfilesPerUser()) {
      throw new BadRequestException({
        code: 'BIRTH_PROFILE_LIMIT_REACHED',
        message: `最多只能建立 ${this.maxBirthProfilesPerUser()} 個命盤檔案。請先刪除不需要的檔案。`,
      });
    }

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

    // C1 — the same SetNull trap `erasePersonalData` was written to avoid, on
    // the path users actually take. `DailyFortuneSnapshot.birthProfileId` is
    // `SetNull`, so a bare profile delete ORPHANS every snapshot for it:
    // narrative text plus a `chartHash`, with nothing left to attribute them to.
    //
    // Worse than untidy — an orphan is permanently unreachable. Account deletion
    // scopes on `birthProfileId: { in: profileIds }`, so anything orphaned here
    // can never be cleaned up later, and "delete my account" quietly stops being
    // complete for anyone who ever removed a profile first.
    await this.prisma.$transaction([
      this.prisma.dailyFortuneSnapshot.deleteMany({ where: { birthProfileId: profileId } }),
      this.prisma.birthProfile.delete({ where: { id: profileId } }),
    ]);

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
            paidAt: true, // A7 — 未解鎖 badge; free creates now have creditsUsed 0
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
        // ⚠️ Same trap as the merged branch below — this re-maps explicitly, so
        // selecting `paidAt` is not enough. Without it the 未解鎖 badge is dead.
        paidAt: c.paidAt,
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
            paidAt: true, // A7 — 未解鎖 badge; free creates now have creditsUsed 0
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
      // ⚠️ Must be carried through. This branch RE-MAPS explicitly, so adding
      // `paidAt` to the `select` above is not enough — without this line the
      // clients see `paidAt: undefined` and render 「免費」 for an unpaid
      // comparison that will later cost 3 credits.
      paidAt: c.paidAt,
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
      // Auto-create user record if not found (e.g., webhook not configured).
      // F1: the bonus is resolved rather than hardcoded — `deleteAccount`
      // renames the row instead of deleting it, freeing the clerkUserId, so a
      // returning identity would otherwise re-mint 3 credits on every cycle.
      this.logger.warn(`User ${clerkUserId} not in DB — auto-creating`);
      const credits = await resolveSignupCredits(this.prisma, clerkUserId);
      try {
        user = await this.prisma.user.create({
          data: { clerkUserId, credits },
        });
        await recordSignupBonusLedger(this.prisma, user.id, credits);
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        // The `findUnique` above and this `create` are two round-trips, so a
        // concurrent request — or the Clerk webhook landing mid-flight — can
        // insert between them. Let the unique constraint settle who inserted
        // rather than trusting the stale read: the loser re-reads and grants
        // nothing, so the bonus is ledgered exactly once.
        user = await this.prisma.user.findUniqueOrThrow({ where: { clerkUserId } });
      }
    }

    return user;
  }
}
