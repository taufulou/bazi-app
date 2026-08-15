import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  InternalServerErrorException,
  HttpException,
  type MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subscriber } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIService } from '../ai/ai.service';
import { CreditsService } from '../credits/credits.service';
import { CreateReadingDto, CreateComparisonDto } from './dto/create-reading.dto';
import { Prisma, ReadingType } from '@prisma/client';
import { deepCamelCase } from '../common/deep-camel-case';
import { engineFetch } from '../common/engine-client';

/**
 * Used only when the COMPATIBILITY service row is missing or has been
 * deactivated between a comparison being created and revealed. Blocking the
 * reveal outright would strand a user mid-funnel on a comparison they already
 * hold, so charge the known price instead.
 */
const COMPATIBILITY_FALLBACK_CREDIT_COST = 3;

/**
 * How long a reading row with no interpretation is presumed to still be
 * GENERATING rather than abandoned.
 *
 * A row on its first generation ({aiInterpretation: null, regenerationCount: 0})
 * is byte-identical to one whose generation died, so age is the only signal that
 * separates them. Set above `AI_STREAM_TIMEOUT_MS` (300s, `ai.service.ts`) plus
 * headroom for the retry/provider-fallback chain, because anything still inside
 * that window could legitimately still be writing.
 *
 * Too LOW and a concurrent create during a slow generation charges the user a
 * second time; too HIGH and a genuinely dead row can't be replaced by a fresh
 * create until it ages out (the user can still use Regenerate, which has its own
 * path). The money error is the worse one, so this errs high.
 */
const FIRST_GENERATION_INFLIGHT_MS = 360_000;


/**
 * Removes the subscriber-only content from an `/explain-element` response.
 *
 * The paid boundary is defined by the CLIENTS — `ElementExplanation.tsx` on web
 * (`:294-405`) and `apps/mobile/src/components/ElementExplanation.tsx`
 * (`:207-...`) both render these inside an `isSubscriber ?` branch:
 *
 *   • `personalized`  — Layer B `pillarMeaning`, C `godRoleMeaning`/`godRole`,
 *                       D `genderMeaning`
 *   • `pillarContext.paid`   (`.free` is the teaser and stays)
 *   • `interactions`         — cross-pillar 六合/六沖 detail, subscriber-only
 *                              on BOTH clients
 *   • `dayPillarCombo`       — `grade` + `teaser` are the free tier behind a
 *                              「解鎖日柱組合完整解讀」 CTA; `summary`,
 *                              `gradeReason`, `specialLabels` and
 *                              `lifeStageSeat` are paid. The engine ships all
 *                              60 combos, so leaving `summary` in lets an
 *                              anonymous caller enumerate the entire paid set.
 *
 * ⚠️ `personalized` is EMPTIED, not deleted. Mobile dereferences
 * `data.personalized.pillarMeaning` with no guard (`:206`, `:240`), and its own
 * error stub always supplies `personalized: {}` — so "always present" is an
 * invariant of this payload. Deleting the key crashed every non-subscriber
 * mobile caller with a TypeError. Emptying keeps the invariant and leaks
 * nothing.
 *
 * Pure + total: a non-object response passes through untouched.
 */
export function stripPaidExplanationLayers(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;

  const src = result as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  // Layers B/C/D. Emptied rather than removed — see the note above.
  if ('personalized' in out) out.personalized = {};

  // Split field: `.free` is the teaser, `.paid` is the full text.
  const ctx = src.pillarContext;
  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
    const rest = { ...(ctx as Record<string, unknown>) };
    delete rest.paid;
    out.pillarContext = rest;
  }

  // Cross-pillar interactions — wholly subscriber-only.
  delete out.interactions;

  // Day-pillar combo — keep the free teaser, drop the paid analysis.
  const combo = src.dayPillarCombo;
  if (combo && typeof combo === 'object' && !Array.isArray(combo)) {
    const c = combo as Record<string, unknown>;
    out.dayPillarCombo = {
      ...(c.grade !== undefined && { grade: c.grade }),
      ...(c.teaser !== undefined && { teaser: c.teaser }),
    };
  }

  return out;
}

@Injectable()
export class BaziService {
  private readonly logger = new Logger(BaziService.name);
  private readonly baziEngineUrl: string;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private configService: ConfigService,
    private aiService: AIService,
    private creditsService: CreditsService,
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

    const hasEnoughCredits = user.credits >= service.creditCost;

    if (!hasEnoughCredits) {
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
      return await this._executeCreateReading(user, profile, dto, service);
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  /**
   * Internal: executes reading creation within distributed lock.
   * Separated to keep createReading() clean and testable.
   */
  private async _executeCreateReading(
    user: { id: string; credits: number; subscriptionTier: string },
    profile: { id: string; birthDate: Date; birthTime: string | null; hourKnown: boolean; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    dto: CreateReadingDto,
    service: { creditCost: number; type: string },
  ) {
    // Generate birth data hash for cache lookup
    const birthDataHash = this.aiService.generateBirthDataHash(
      profile.birthDate.toISOString().split('T')[0],
      // Unknown 時辰: distinct, non-colliding cache key (birthTime is null →
      // sentinel). Known-hour keys keep their real time → byte-identical, no regen.
      profile.birthTime ?? 'HOUR_UNKNOWN',
      profile.birthCity,
      profile.gender.toLowerCase(),
      dto.readingType,
      dto.targetYear,
    );

    // ── Bundle B — return the user's EXISTING reading instead of inserting a
    // duplicate row.
    //
    // Re-running a paid reading with identical birth data already charged 0
    // credits (the `fromCache` path below), but still INSERTed a fresh
    // `bazi_readings` row. That is what inflates 歷史分析記錄 — one chart shown
    // as dozens of identical entries, and a meaningless counter.
    //
    // ⚠️ Scoped to (userId, birthProfileId, readingType, targetYear) — NOT to
    // the AI cache. The AI cache is GLOBAL (keyed on birth data + type + year),
    // so keying dedupe on it would hand back a DIFFERENT USER's row.
    const reusable = await this.prisma.baziReading.findFirst({
      where: {
        userId: user.id,
        birthProfileId: profile.id,
        readingType: dto.readingType,
        targetYear: dto.targetYear ?? null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (reusable) {
      const isComplete =
        reusable.aiInterpretation !== null &&
        !reusable.isDegraded &&
        reusable.refundedAt === null;

      // A row mid-regeneration is IN FLIGHT, not absent: `regenerateReading`
      // deliberately nulls `aiInterpretation` so the SSE endpoint refills it.
      // Without this carve-out a concurrent create during that window would
      // fall through and CHARGE AGAIN.
      // ⚠️ `refundedAt === null` is required here too, not just on `isComplete`.
      // Reachable chain: create+charge → stream degrades → user regenerates
      // (`regenerationCount: 1`, AI nulled, `refundedAt` untouched) → the regen
      // fails → `refundReadingCredit` sets `refundedAt` and returns the credits.
      // The row is then {AI: null, regenerationCount: 1, refundedAt: set}. Without
      // this clause that reads as "in flight", so the create returns
      // `streamReady` free — and `/readings/:id/stream` has NO payment gate, so
      // the user gets their credits back AND the full paid report.
      const isRegenerating =
        reusable.aiInterpretation === null &&
        reusable.regenerationCount > 0 &&
        reusable.refundedAt === null;

      // The FIRST generation needs the same carve-out, and is the common case:
      // `createReading` returns `streamReady` as soon as the row exists, then the
      // SSE fills `aiInterpretation` over the next 45s-5min. Throughout that
      // window the row reads {AI: null, regenerationCount: 0} — matching neither
      // branch above — so a retried POST, a double-submit, or a reload used to
      // fall through, INSERT a second row and CHARGE AGAIN. The per-user
      // `reading:create:` lock does not help: it is released when this method
      // returns, long before the stream finishes.
      //
      // Age is the only thing separating "still generating" from "abandoned",
      // hence the window. `isDegraded` is excluded because a degraded row is
      // finished, not in flight — Regenerate is its path.
      //
      // ⚠️ Pairs with the per-reading lock in `_setupStream`: this stops the
      // duplicate row and the second charge, and that stops the duplicate
      // GENERATION. The second caller gets the same row back for free and, if a
      // generation really is still running, a 409 from the stream rather than a
      // silent second bill.
      const isFirstGenerationInFlight =
        reusable.aiInterpretation === null &&
        reusable.regenerationCount === 0 &&
        reusable.refundedAt === null &&
        !reusable.isDegraded &&
        // `?? 0` rather than a bare deref: if a future narrowing `select` ever
        // drops createdAt, fall back to the pre-fix behaviour (treat as not in
        // flight) instead of throwing inside the create path.
        Date.now() - (reusable.createdAt?.getTime() ?? 0) <
          FIRST_GENERATION_INFLIGHT_MS;

      if (isComplete) {
        // ⚠️ `fromCache: true` is a live client contract — web
        // `reading/[type]/page.tsx` (`callNestJS`, its `response.fromCache`
        // branch) and mobile `reading/[type].tsx` (`setCacheToast`) drive the
        // 「已載入…未扣點」 CacheToast off it. Returning a reused row without it
        // would charge nothing and tell the user nothing, which is the exact
        // confusion that toast exists to prevent.
        // ⚠️ `creditsUsed: 0` — the envelope field means "credits charged by
        // THIS call", which is what every consumer assumes. Spreading the row's
        // original non-zero charge made the web client decrement the displayed
        // balance (same function, its `creditsUsed > 0` guard) while the
        // CacheToast said
        // 「未扣點」 — the exact contradiction that toast exists to prevent.
        return { ...reusable, creditsUsed: 0, fromCache: true };
      }

      if (isRegenerating || isFirstGenerationInFlight) {
        // The row has no interpretation YET, so returning it as a cache hit
        // would render an empty reading. Hand back `streamReady` instead so the
        // client opens the SSE stream and receives the in-flight content —
        // and still no charge, because this reading was already paid for.
        return {
          ...reusable,
          creditsUsed: 0, // charged by THIS call — see the note above
          fromCache: false,
          // Mirror the fresh path: only promise a stream when one was asked for.
          streamReady: dto.stream === true,
          deterministic: this._buildDeterministicPayload(
            (reusable.calculationData ?? {}) as Record<string, unknown>,
            dto.readingType,
          ),
        };
      }
      // Otherwise fall through: a degraded / refunded / long-abandoned row is
      // what `regenerateBaziReading` exists to replace, not something to serve.
      // "Long-abandoned" is the key word — a row younger than
      // FIRST_GENERATION_INFLIGHT_MS is caught by the branch above instead.
    }

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

    // Streaming path: V2 reading types + stream=true + no cache → skip AI, return streamReady
    const isV2Reading = dto.readingType === ReadingType.LIFETIME
      || dto.readingType === ReadingType.CAREER
      || dto.readingType === ReadingType.ANNUAL
      || dto.readingType === ReadingType.LOVE;
    const isStreamingRequest = dto.stream === true
      && isV2Reading
      && !cachedInterpretation;

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
    } else if (!isStreamingRequest) {
      // Non-streaming: generate AI inline (existing behavior)
      try {
        // Add birth info to calculation data for prompt interpolation
        const enrichedData = {
          ...calculationData,
          gender: profile.gender.toLowerCase(),
          birthDate: profile.birthDate.toISOString().split('T')[0],
          birthTime: profile.birthTime,
          hourKnown: profile.hourKnown,
          targetYear: dto.targetYear,
        };

        // Route V2 reading types to their multi-call generators; all others use V1
        let aiResult;
        if (dto.readingType === ReadingType.LIFETIME) {
          aiResult = await this.aiService.generateLifetimeV2Interpretation(
            enrichedData,
            user.id,
          );
        } else if (dto.readingType === ReadingType.CAREER) {
          aiResult = await this.aiService.generateCareerV2Interpretation(
            enrichedData,
            user.id,
          );
        } else if (dto.readingType === ReadingType.ANNUAL) {
          aiResult = await this.aiService.generateAnnualV2Interpretation(
            enrichedData,
            user.id,
          );
        } else if (dto.readingType === ReadingType.LOVE) {
          aiResult = await this.aiService.generateLoveV2Interpretation(
            enrichedData,
            user.id,
          );
        } else {
          aiResult = await this.aiService.generateInterpretation(
            enrichedData,
            dto.readingType,
            user.id,
          );
        }

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
    // else: streaming request — aiInterpretation stays null, will be populated by SSE endpoint

    // Cache hit: no credit deduction (user already paid for this interpretation)
    // Regular: deduct service.creditCost credits
    const fromCache = !!cachedInterpretation;
    const creditsUsed = fromCache ? 0 : service.creditCost;

    const reading = await this.prisma.$transaction(async (tx) => {
      // Create reading first so we have an id to attach to the credit ledger.
      // If deduction fails below, the transaction rolls back and the reading is not persisted.
      const r = await tx.baziReading.create({
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
      if (!fromCache) {
        await this.creditsService.deductCredits(
          user.id,
          service.creditCost,
          `reading-create:${dto.readingType}`,
          { readingId: r.id, tx },
        );
      }
      return r;
    });

    // For streaming requests, include streamReady flag and deterministic data
    if (isStreamingRequest) {
      // Extract deterministic data from the appropriate enhanced insights key
      const deterministic = this._buildDeterministicPayload(calculationData, dto.readingType);

      return { ...reading, fromCache, streamReady: true, deterministic };
    }

    return { ...reading, fromCache };
  }

  /**
   * Shape the deterministic (non-AI) payload the streaming clients render while
   * the AI is still arriving. Shared by the fresh-stream path and Bundle B's
   * in-flight-regeneration reuse, so both hand the frontend the same structure.
   */
  private _buildDeterministicPayload(
    calculationData: Record<string, unknown>,
    readingType: string,
  ): Record<string, unknown> {
    const INSIGHTS_KEY_MAP: Record<string, string> = {
      CAREER: 'careerEnhancedInsights',
      ANNUAL: 'annualEnhancedInsights',
      LIFETIME: 'lifetimeEnhancedInsights',
      LOVE: 'loveEnhancedInsights',
    };
    const insightsKey = INSIGHTS_KEY_MAP[readingType] || 'lifetimeEnhancedInsights';
    const enhancedInsights = calculationData[insightsKey] as Record<string, unknown> | undefined;

    // For ANNUAL V2: pass the full enhancedInsights (not just the compact 'deterministic' sub-key)
    // so the frontend has access to taiSui, career, finance, health, monthly aspects etc.
    // For other types: keep using the compact 'deterministic' sub-key.
    if (readingType === 'ANNUAL' && enhancedInsights) {
      return deepCamelCase(enhancedInsights) as Record<string, unknown>;
    }
    const rawDeterministic = (enhancedInsights?.['deterministic'] || {}) as Record<string, unknown>;
    // NOTE: Love deterministic data receives shallow camelCase here (top-level keys only).
    // Nested objects (annualForecasts items, goodYears, etc.) retain snake_case.
    // Frontend normalizeLoveDeterministic() applies deepCamelCase to handle this.
    // Do NOT remove the frontend deepCamelCase — it is required for nested fields.
    const deterministic: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawDeterministic)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      deterministic[camelKey] = value;
    }
    return deterministic;
  }

  /**
   * Regenerate AI for a degraded reading. Free (no credit deduction).
   * Limit: REGENERATION_LIMIT (3) per reading. After exhausted, user must
   * delete the reading and create a fresh one.
   *
   * Sets aiInterpretation back to NULL so the SSE stream endpoint will
   * regenerate from scratch on next /stream request.
   */
  async regenerateReading(clerkUserId: string, readingId: string) {
    // Mirrors @repo/shared REGENERATION_LIMIT — NestJS @repo/shared runtime
    // restriction prevents direct import. Keep in sync.
    const REGENERATION_LIMIT = 3;
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    // Atomic conditional update — only succeeds if the row is degraded,
    // not exhausted, and below the limit. Prevents a TOCTOU race where two
    // concurrent regen requests both pass a check-then-update sequence and
    // burn an extra free regen.
    // CRITICAL: Prisma.DbNull sets the column to SQL NULL (vs Prisma.JsonNull
    // which writes JSONB literal 'null'). undefined would be a no-op.
    const result = await this.prisma.baziReading.updateMany({
      where: {
        id: readingId,
        userId: user.id,
        isDegraded: true,
        regenerationExhausted: false,
        regenerationCount: { lt: REGENERATION_LIMIT },
      },
      data: {
        regenerationCount: { increment: 1 },
        isDegraded: false,
        failedReason: null,
        aiInterpretation: Prisma.DbNull,
        aiProvider: null,
        aiModel: null,
        // ⚠️ Deliberately does NOT touch `refundedAt` or `creditsUsed`.
        //
        // `isDegraded: true` in the WHERE above already means this row was NOT
        // refunded: `ai.service.ts` computes one exclusive status per attempt
        // and sets `isDegraded` only on 'degraded', while the refund fires only
        // on 'failed'. So a refunded reading can never match here — the user
        // was charged, got partial content, and kept the charge.
        //
        // An earlier version of this block cleared `refundedAt` and zeroed
        // `creditsUsed` to close a double-refund it believed regeneration
        // opened. The clear was a no-op (the column is already null on every
        // row that matches), and the zeroing was actively harmful: it erased
        // the record of a real charge, so if the regenerated stream also failed,
        // `refundReadingCredit`'s `creditsUsed > 0` guard blocked the refund and
        // the user silently ate the credits they had paid.
      },
    });

    if (result.count === 0) {
      // The atomic update didn't match. Disambiguate the reason for the caller.
      const reading = await this.prisma.baziReading.findFirst({
        where: { id: readingId, userId: user.id },
      });
      if (!reading) throw new NotFoundException('Reading not found');
      if (!reading.isDegraded) {
        throw new BadRequestException('此分析狀態正常，無需重新生成');
      }
      if (
        reading.regenerationExhausted ||
        reading.regenerationCount >= REGENERATION_LIMIT
      ) {
        if (!reading.regenerationExhausted) {
          await this.prisma.baziReading.update({
            where: { id: readingId },
            data: { regenerationExhausted: true },
          });
        }
        throw new BadRequestException(
          `已達免費重新生成上限（${REGENERATION_LIMIT} 次）。如需再次分析，請建立新的命理分析。`,
        );
      }
      // Catch-all for the rare race where a concurrent successful regen flipped
      // the row out from under our where clause between updateMany and findFirst.
      throw new BadRequestException('此分析無法重新生成，請稍後再試');
    }

    const updated = await this.prisma.baziReading.findUnique({
      where: { id: readingId },
    });
    if (!updated) throw new NotFoundException('Reading not found');

    return {
      readingId: updated.id,
      regenerationCount: updated.regenerationCount,
      regenerationsRemaining: REGENERATION_LIMIT - updated.regenerationCount,
    };
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

    // Server-side paywall: non-subscribers only get preview sections.
    //
    // F2 — the previous predicate was `creditsUsed > 0 || reading.userId === user.id`.
    // The WHERE clause above already scopes to `userId: user.id`, so the second
    // disjunct was ALWAYS true: the preview-stripping below was unreachable dead
    // code and every caller got full content. (The identical bug was found and
    // fixed on the comparison path — see the `paidAt` note near :1293 — and never
    // applied here or in zwds.service.)
    //
    // Deleting just the tautology is WRONG: the residue `creditsUsed > 0` would
    // paywall 0-credit cache-hit readings, which are deliberately free (F4 —
    // "same birth data won't charge twice"). Entitlement is therefore the
    // absence of a refund, not the presence of a charge.
    //
    // Refund semantics: `refundedAt` is set only when generation FAILED outright
    // and the credits were returned. The refund also nulls `aiInterpretation`,
    // so a refunded row usually has nothing to strip — but the null-out is a
    // separate `.catch()`-ed update (ai.service.ts ~:1356) that can fail on its
    // own, leaving a refunded row holding content. This gate is what covers that.
    // Truthiness, not `=== null`: Prisma returns `null` for an unset
    // `DateTime?`, but a partial `select` (or a test mock) yields `undefined`,
    // and `undefined === null` is false — which would silently paywall every
    // PAYING customer. A Date is always truthy, so `!refundedAt` is exact for
    // both real shapes and cannot misfire that way.
    const isEntitled = !reading.refundedAt;

    // ⚠️ There is deliberately NO `isSubscriber ||` here (F-4, 1B audit).
    //
    // It used to read `if (isSubscriber || isEntitled)`, which handed a
    // refunded subscriber the full report — removing exactly the coverage the
    // comment above says this gate provides. Two different concepts had been
    // fused into one boolean: the preview PAYWALL (tier-based) and the refund
    // ENTITLEMENT check, and the OR let the weaker one win.
    //
    // Subscribers are not exempt from paying: `createReading` computes
    // `creditsUsed = fromCache ? 0 : service.creditCost` with no tier branch
    // and deducts unconditionally. So a subscriber who was refunded got their
    // credits back and is no more entitled to THIS reading than a free user.
    // Stale logic from an earlier all-access subscription model.
    //
    // The asymmetry was the tell: the chat gate (F6) and the fortune window
    // (F5) both correctly have no subscriber exemption. This was the odd one out.
    if (isEntitled) {
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

  // ============ SSE Streaming ============

  /**
   * Stream AI interpretation for a LIFETIME reading via SSE.
   * Returns an Observable<MessageEvent> consumed by the @Sse endpoint.
   */
  streamReading(clerkUserId: string, readingId: string): Observable<MessageEvent> {
    return new Observable((subscriber: Subscriber<MessageEvent>) => {
      this._setupStream(clerkUserId, readingId, subscriber).catch((err) => {
        const message = err instanceof Error ? err.message : 'Stream setup failed';
        subscriber.next({
          data: JSON.stringify({ message }),
          type: 'error',
        } as MessageEvent);
        subscriber.complete();
      });
    });
  }

  private async _setupStream(
    clerkUserId: string,
    readingId: string,
    subscriber: Subscriber<MessageEvent>,
  ) {
    this.logger.log(`[Stream] Setup starting for reading=${readingId}, user=${clerkUserId}`);

    // 1. Verify user owns this reading
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const reading = await this.prisma.baziReading.findFirst({
      where: { id: readingId, userId: user.id },
      include: { birthProfile: true },
    });
    if (!reading) throw new NotFoundException('Reading not found');

    this.logger.log(`[Stream] Reading found, hasAI=${!!reading.aiInterpretation}, hasCalc=${!!reading.calculationData}`);

    // 1b. F2 PAYMENT GATE. This route previously had none — the defect the note
    // at ~:198 describes from the create side ("`/readings/:id/stream` has NO
    // payment gate, so the user gets their credits back AND the full paid
    // report"). Two distinct costs, not just content:
    //   • a refunded row has `aiInterpretation` nulled, so falling through does
    //     not replay stored text — it runs a FULL provider generation, i.e. real
    //     Anthropic spend, for a reading the user was already refunded for;
    //   • that generation bypasses the regeneration counter entirely, since the
    //     3-per-reading cap is enforced in `regenerateReading`, not here.
    // The legitimate path forward is a NEW reading, not regeneration.
    // `regenerateReading` matches only `isDegraded: true`, and a refunded row is
    // never degraded (one exclusive status per attempt), so it would answer
    // 「此分析狀態正常，無需重新生成」 — and the web UI doesn't render the
    // regenerate control for a non-degraded reading anyway. The user has their
    // credits back, so `POST /readings` creates and charges a fresh row: all
    // three reuse branches require `refundedAt === null`, so the refunded row is
    // correctly skipped rather than handed back.
    if (reading.refundedAt) {
      this.logger.warn(
        `[Stream] REFUSED refunded reading=${readingId} user=${user.id} ` +
        `(refundedAt=${reading.refundedAt.toISOString()}) — user should create a new reading`,
      );
      throw new BadRequestException({
        code: 'READING_REFUNDED',
        message: '此分析已退款，點數已退回。請重新建立一次分析。',
      });
    }

    // 2. If AI already populated (cache hit or re-fetch), emit static sections
    if (reading.aiInterpretation) {
      this.emitStaticSections(
        reading.aiInterpretation as Record<string, unknown>,
        subscriber,
      );
      return;
    }

    // 3. Check concurrent stream limit (max 2 per user)
    const activeKey = `stream:active:${user.id}`;
    const active = await this.redis.incrementRateLimit(activeKey, 300); // 5 min TTL safety
    if (active > 2) {
      await this.redis.getClient().decr(activeKey);
      throw new ConflictException('Maximum concurrent streams reached');
    }

    // 3b. PER-READING single-flight. The cap above is per-USER, so it happily
    // allows two streams for the SAME readingId — and `createReading`'s reusable
    // -row branches now hand back `streamReady` for a reading whose generation is
    // still running, so a reload or double-submit lands here twice for one row.
    // Without this lock that runs the full provider-fallback generation twice:
    // double Anthropic spend, and two writers racing the same row where the last
    // one wins, so a good result can be clobbered by a degraded retry.
    //
    // This is the same invariant `regenerateReading` protects with its atomic
    // `updateMany` on `regenerationCount` — that guard covers the /regenerate
    // entry point, and this covers the stream entry point.
    //
    // TTL exceeds AI_STREAM_TIMEOUT_MS (300s) so the lock cannot expire under a
    // still-running generation; the explicit releases below are the normal path.
    const readingLockKey = `stream:reading:${readingId}`;
    const readingLockAcquired = await this.redis.acquireLock(readingLockKey, 330);
    if (!readingLockAcquired) {
      await this.redis.getClient().decr(activeKey);
      throw new ConflictException(
        'This reading is already being generated. Please wait for it to finish.',
      );
    }
    const releaseStreamSlot = () => {
      this.redis.getClient().decr(activeKey).catch(() => {});
      this.redis.releaseLock(readingLockKey).catch(() => {});
    };

    try {
      // 4. Rebuild enriched data from stored calculationData.
      // targetYear is only meaningful for ANNUAL readings; omit for others so
      // a future prompt template can't accidentally interpolate `undefined`.
      const enrichedData: Record<string, unknown> = {
        ...(reading.calculationData as Record<string, unknown>),
        gender: reading.birthProfile?.gender?.toLowerCase(),
        birthDate: reading.birthProfile?.birthDate?.toISOString().split('T')[0],
        birthTime: reading.birthProfile?.birthTime,
        birthCity: reading.birthProfile?.birthCity || '',
        // 時辰未知: set hourKnown EXPLICITLY (mirrors the first-stream path) rather
        // than relying on it riding in via the calculationData spread — guards the
        // suppression injectors if the engine output schema ever changes.
        hourKnown: reading.birthProfile?.hourKnown
          ?? (reading.calculationData as Record<string, unknown>)?.['hourKnown']
          ?? true,
      };
      if (reading.readingType === 'ANNUAL' && reading.targetYear != null) {
        enrichedData.targetYear = reading.targetYear;
      }

      // 5. Delegate to correct V2 streamer based on reading type
      let aiObservable;
      switch (reading.readingType) {
        case 'CAREER':
          aiObservable = this.aiService.streamCareerV2(enrichedData, readingId);
          break;
        case 'ANNUAL':
          aiObservable = this.aiService.streamAnnualV2(enrichedData, readingId, reading.targetYear ?? undefined);
          break;
        case 'LOVE':
          aiObservable = this.aiService.streamLoveV2(enrichedData, readingId);
          break;
        default:
          aiObservable = this.aiService.streamLifetimeV2(enrichedData, readingId);
          break;
      }
      aiObservable.subscribe({
        next: (event) => subscriber.next(event),
        error: (err) => {
          releaseStreamSlot();
          const message = err instanceof Error ? err.message : 'Stream error';
          subscriber.next({
            data: JSON.stringify({ message }),
            type: 'error',
          } as MessageEvent);
          subscriber.complete();
        },
        complete: () => {
          releaseStreamSlot();
          subscriber.complete();
        },
      });
    } catch (err) {
      // Release both the per-user slot and the per-reading lock on setup error,
      // otherwise a failure here would wedge the reading for the whole 330s TTL.
      releaseStreamSlot();
      throw err;
    }
  }

  /**
   * Emit already-existing AI interpretation as static SSE events.
   * Used when a reading already has AI data (e.g., client reconnects after completion).
   */
  private emitStaticSections(
    aiInterpretation: Record<string, unknown>,
    subscriber: Subscriber<MessageEvent>,
  ) {
    const sections = aiInterpretation['sections'] as Record<string, { preview: string; full: string }> | undefined;
    const summary = aiInterpretation['summary'] as { preview: string; full: string } | undefined;

    if (sections) {
      for (const [key, section] of Object.entries(sections)) {
        subscriber.next({
          data: JSON.stringify({ key, preview: section.preview, full: section.full }),
          type: 'section_complete',
        } as MessageEvent);
      }
    }

    if (summary) {
      subscriber.next({
        data: JSON.stringify({ preview: summary.preview, full: summary.full }),
        type: 'summary',
      } as MessageEvent);
    }

    subscriber.next({
      data: JSON.stringify({ totalSections: sections ? Object.keys(sections).length : 0, latencyMs: 0 }),
      type: 'done',
    } as MessageEvent);

    subscriber.complete();
  }

  // ============ Comparison Streaming ============

  /**
   * Stream AI interpretation for a Romance V2 comparison via SSE.
   * Returns an Observable<MessageEvent> consumed by the @Sse endpoint.
   */
  streamComparisonAI(clerkUserId: string, comparisonId: string): Observable<MessageEvent> {
    return new Observable((subscriber: Subscriber<MessageEvent>) => {
      this._setupComparisonStream(clerkUserId, comparisonId, subscriber).catch((err) => {
        const message = err instanceof Error ? err.message : 'Stream setup failed';
        subscriber.next({
          data: JSON.stringify({ message }),
          type: 'error',
        } as MessageEvent);
        subscriber.complete();
      });
    });
  }

  private async _setupComparisonStream(
    clerkUserId: string,
    comparisonId: string,
    subscriber: Subscriber<MessageEvent>,
  ) {
    this.logger.log(`[Stream] Comparison stream setup starting for comparison=${comparisonId}, user=${clerkUserId}`);

    // 1. Verify user owns this comparison
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const comparison = await this.prisma.baziComparison.findFirst({
      where: { id: comparisonId, userId: user.id },
    });
    if (!comparison) throw new NotFoundException('Comparison not found');

    // 2. Check it's a Romance V2 comparison
    const calculationData = comparison.calculationData as Record<string, unknown>;
    const isRomanceV2 = comparison.comparisonType === 'ROMANCE'
      && !!calculationData['romancePreAnalysis'];
    if (!isRomanceV2) {
      throw new BadRequestException('Streaming only supported for Romance V2 comparisons');
    }

    this.logger.log(`[Stream] Comparison found, hasAI=${!!comparison.aiInterpretation}, type=${comparison.comparisonType}`);

    // 3. If AI is populated AND the comparison is unlocked, emit static sections.
    //
    // ⚠️ `paidAt` is part of the condition on purpose. Keying on
    // `aiInterpretation` alone means an unpaid row carrying an interpretation
    // (refunded, or a pre-Bundle-A cache-hit row) hands the full report over for
    // free — this endpoint emits every section with no preview stripping.
    // An unpaid row with a stale interpretation falls through to the charge.
    if (comparison.aiInterpretation && comparison.paidAt !== null) {
      this.emitStaticSections(
        comparison.aiInterpretation as Record<string, unknown>,
        subscriber,
      );
      return;
    }

    // 4. Check concurrent stream limit (max 2 per user)
    const activeKey = `stream:active:compat:${user.id}`;
    const active = await this.redis.incrementRateLimit(activeKey, 300); // 5 min TTL safety
    if (active > 2) {
      await this.redis.getClient().decr(activeKey);
      throw new ConflictException('Maximum concurrent streams reached');
    }

    // 5. CHARGE — after the concurrency guard, before any AI work.
    //
    // ⚠️ Placed after the guard deliberately: charging above it would debit a
    // user who is merely rate-limited. Charge-then-generate (not the reverse)
    // because a concurrent spend between generation and charge would let us
    // deliver the report for nothing; the CAS makes a retry free.
    try {
      await this._chargeForReveal(user.id, comparison);
    } catch (err) {
      await this.redis.getClient().decr(activeKey);
      // Headers are already sent on an SSE response, so a thrown
      // BadRequestException would reach the client as a message string, not a
      // 4xx. Emit a machine-readable code the frontend can dispatch on.
      const isCredits =
        err instanceof BadRequestException &&
        (err.getResponse() as { code?: string })?.code === 'INSUFFICIENT_CREDITS';
      subscriber.next({
        data: JSON.stringify(
          isCredits
            ? { code: 'INSUFFICIENT_CREDITS', message: '點數不足，無法解鎖完整報告。' }
            : { message: err instanceof Error ? err.message : 'Reveal failed' },
        ),
        type: 'error',
      } as MessageEvent);
      subscriber.complete();
      return;
    }

    try {
      // 6. Delegate to ai.service streaming method
      const aiObservable = this.aiService.streamCompatibilityRomanceV2(calculationData, comparisonId);

      // ⚠️ The refund CANNOT hang off the observable's `error` channel.
      // `streamCompatibilityRomanceV2` never calls `subscriber.error()` — there
      // is not one such call in ai.service.ts. Every failure, including
      // "All providers failed", is caught and emitted as a `next()` event of
      // type 'error', followed by `complete()` in a `finally`. A refund wired to
      // `error:` is therefore dead code, and the user is debited with no report.
      //
      // So: watch the EVENT STREAM. A healthy run ends with a 'done' event; if
      // we reach `complete` having seen an error event and produced no sections,
      // the user got nothing and must be refunded.
      let sawErrorEvent = false;
      let sawAnySection = false;
      let sawDone = false;

      const settleRefundIfEmpty = () => {
        // Partial output is deliberately NOT refunded: the client keeps those
        // sections and tells the user 「部分分析已完成」, and a retry is free
        // anyway because the CAS sees `paidAt` already set.
        if (!sawErrorEvent || sawAnySection || sawDone) return;
        this.creditsService
          .refundComparisonCredit(comparisonId, 'reveal-stream-failed')
          .then((r) => {
            if (r.refunded) {
              this.logger.warn(
                `Refunded ${r.amount} credits for failed comparison reveal ${comparisonId}`,
              );
            }
          })
          .catch((refundErr) =>
            this.logger.error(`Reveal refund failed for ${comparisonId}: ${refundErr}`),
          );
      };

      aiObservable.subscribe({
        next: (event) => {
          const type = (event as { type?: string }).type;
          // ⚠️ ALLOWLIST real output — do NOT invert this into a denylist.
          // `streamCompatibilityRomanceV2` emits `{type:'heartbeat'}` every 15s
          // starting BEFORE the first provider attempt (its `heartbeatInterval`
          // in `ai.service.ts`), so
          // "anything that isn't error/done/summary counts as output" marks
          // every real failure as partial — and real failures are always slower
          // than 15s (300s timeout, sequential provider fallback). The refund
          // then never fires, which is the exact defect this block exists to fix.
          if (type === 'error') sawErrorEvent = true;
          else if (type === 'done') sawDone = true;
          // `summary` is real content too. It is followed by `done` today, so
          // `sawDone` would suppress the refund anyway — but relying on that
          // adjacency is fragile, and counting it costs nothing.
          else if (type === 'section_complete' || type === 'summary') sawAnySection = true;
          subscriber.next(event);
        },
        error: (err) => {
          // Defensive only — see the note above; nothing in ai.service.ts
          // currently reaches this channel.
          this.redis.getClient().decr(activeKey).catch(() => {});
          sawErrorEvent = true;
          settleRefundIfEmpty();
          const message = err instanceof Error ? err.message : 'Stream error';
          subscriber.next({
            data: JSON.stringify({ message }),
            type: 'error',
          } as MessageEvent);
          subscriber.complete();
        },
        complete: () => {
          this.redis.getClient().decr(activeKey).catch(() => {});
          // This is the path a real provider failure takes — the stream emits an
          // 'error' EVENT and then completes normally, so the refund decision
          // belongs here, not in `error:`.
          settleRefundIfEmpty();
          subscriber.complete();
        },
      });
    } catch (err) {
      // Decrement on setup error
      await this.redis.getClient().decr(activeKey);
      throw err;
    }
  }

  // ============ Comparison reveal charge (shared by both reveal paths) ============

  /**
   * Charge for unlocking a comparison, AT MOST ONCE, atomically.
   *
   * ⚠️ The claim is a compare-and-set on `paidAt`, not a read-then-write. Two
   * concurrent reveals would otherwise both see `paidAt: null` and both charge.
   *
   * ⚠️ `paidAt` is the predicate, NOT `creditsUsed === 0`. A refunded comparison
   * keeps its `creditsUsed` (`refundComparisonCredit` guards on
   * `creditsUsed > 0`), so a creditsUsed-based gate would treat a fully refunded
   * user as already paid and hand over the report.
   *
   * The CAS also resets `refundedAt`/`failedReason`: `refundComparisonCredit`
   * guards on `refundedAt: null`, so without the reset a second failure after a
   * re-pay could never be refunded. Each paid cycle is refundable exactly once.
   *
   * @returns true if this call performed the charge, false if already unlocked
   */
  private async _chargeForReveal(
    userId: string,
    comparison: { id: string; comparisonType: string; paidAt: Date | null },
  ): Promise<boolean> {
    if (comparison.paidAt !== null) return false;

    // `service` is not in scope on the reveal paths (only createComparison looks
    // it up). Fall back rather than hard-failing a user mid-funnel if the row is
    // missing or deactivated after they created the comparison.
    const service = await this.prisma.service.findFirst({
      where: { type: ReadingType.COMPATIBILITY, isActive: true },
    });
    const cost = service?.creditCost ?? COMPATIBILITY_FALLBACK_CREDIT_COST;

    // Fail fast so the caller gets a clean insufficient-credits error instead of
    // a transaction rollback surfacing as something vaguer.
    const fresh = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if ((fresh?.credits ?? 0) < cost) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_CREDITS',
        message: `Insufficient credits. Unlocking this comparison requires ${cost} credits.`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.baziComparison.updateMany({
        where: { id: comparison.id, userId, paidAt: null },
        data: {
          paidAt: new Date(),
          creditsUsed: cost,
          refundedAt: null,
          failedReason: null,
        },
      });
      if (claim.count === 0) return false; // another request won the race

      await this.creditsService.deductCredits(
        userId,
        cost,
        `comparison-reveal:${comparison.comparisonType}`,
        { comparisonId: comparison.id, tx },
      );
      return true;
    });
  }

  /**
   * A Bazi reveal/mutate endpoint must refuse a row it cannot interpret.
   *
   * ⚠️ LOAD-BEARING, not defence in depth. `BaziComparison` is SHARED with ZWDS
   * compatibility (`zwds.service.ts` writes the same table). A ZWDS row created
   * before its endpoints were disabled has `paidAt` set but no
   * `romancePreAnalysis`; without this guard `generateComparisonAI` would charge
   * Bazi credits and regenerate a BAZI romance interpretation over the user's
   * paid ZWDS report. The same applies to legacy Bazi V1 rows (11 on dev), which
   * predate `romancePreAnalysis`.
   */
  private _assertRomanceV2(comparison: {
    comparisonType: string;
    calculationData: unknown;
  }): void {
    const calc = (comparison.calculationData ?? {}) as Record<string, unknown>;
    if (comparison.comparisonType !== 'ROMANCE' || !calc['romancePreAnalysis']) {
      throw new BadRequestException(
        'This comparison is not a Romance V2 analysis and cannot be generated here.',
      );
    }
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

    // ⚠️ NO credit gate here any more. Creating a comparison is FREE — it shows
    // the two 排盤 charts and nothing else. The 3-credit charge moved to the
    // reveal (`_setupComparisonStream` / `generateComparisonAI`), which is where
    // the score and the AI report are actually handed over. Gating creation on
    // credits would block a user from browsing charts they are not paying for.

    // Ordered dedupe key — `<A>|<B>|<type>` in SUBMITTED order, deliberately not
    // sorted. A paid report cannot be re-oriented (the AI writes 男方/女方 into
    // stored prose), so a deliberate A/B swap is a genuinely different report,
    // not a duplicate. The reversed pair is surfaced to the caller instead —
    // see `reversedPairExists` below.
    const pairKey = `${dto.profileAId}|${dto.profileBId}|${dto.comparisonType}`;

    // Same-order resubmit → hand back the existing row rather than creating a
    // second one. This is the read-side fast path; the unique index on
    // (userId, pairKey) is the actual arbiter (see the P2002 catch below),
    // because this check races under a 30s advisory lock that wraps a slow
    // engine call.
    const existing = await this.prisma.baziComparison.findFirst({
      where: { userId: user.id, pairKey },
      include: { profileA: true, profileB: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      // ⚠️ Refresh a STALE UNPAID row before returning it. Before Bundle A every
      // create re-ran the engine, so the free 排盤 charts were always current.
      // Now the fast path returns an existing row — and since A5 gates
      // `recalculateComparison` on `paidAt`, an unpaid comparison would
      // otherwise be stuck on year-N 大運/流年 with NO route to refresh, and the
      // eventual paid reveal would be generated from stale calculationData.
      //
      // Only while unpaid: never mutate the basis of a report the user bought —
      // that is what `recalculateComparison` is for.
      const currentYear = new Date().getFullYear();
      if (existing.paidAt === null && (existing.lastCalculatedYear ?? 0) < currentYear) {
        try {
          const fresh = (await this.callBaziCompatibility(
            profileA,
            profileB,
            dto,
          )) as Record<string, unknown>;
          // ⚠️ Re-assert `paidAt: null` at WRITE time, not just at read time.
          // The snapshot above predates a multi-second engine call, and a
          // concurrent reveal in another tab can set `paidAt` and generate the
          // AI from the OLD calculationData inside that window. A plain
          // update-by-id would then swap the charts underneath a finished paid
          // report, leaving prose describing data that is no longer stored.
          const claim = await this.prisma.baziComparison.updateMany({
            where: { id: existing.id, paidAt: null },
            data: {
              calculationData: fresh as Prisma.InputJsonValue,
              lastCalculatedYear: currentYear,
            },
          });
          const after = await this.prisma.baziComparison.findFirst({
            where: { id: existing.id, userId: user.id },
            include: { profileA: true, profileB: true },
          });
          if (claim.count === 0) {
            this.logger.log(
              `Skipped stale refresh for ${existing.id} — it was paid for mid-refresh`,
            );
          }
          return this.flattenComparisonResponse(after ?? existing);
        } catch (err: unknown) {
          // A refresh failure must not block access to a comparison the user
          // already has — fall through and serve the stale-but-valid row.
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.warn(
            `Stale-comparison refresh failed for ${existing.id}, serving as-is: ${message}`,
          );
        }
      }
      return this.flattenComparisonResponse(existing);
    }

    // Reversed pair — do NOT auto-dedupe (orientation matters) and do NOT
    // silently create a second row. Signal it so the client can offer
    // 「您已有這對組合的合盤」 and let the user choose.
    const reversedPairKey = `${dto.profileBId}|${dto.profileAId}|${dto.comparisonType}`;
    const reversed = await this.prisma.baziComparison.findFirst({
      where: { userId: user.id, pairKey: reversedPairKey },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    // (The comparison-hash + AI-cache lookup that used to sit here went with the
    // AI-at-create block below — creation no longer produces an interpretation,
    // so there was nothing to look up. The cache is read at the reveal instead.)

    // Acquire distributed lock to prevent concurrent exploit
    const lockKey = `comparison:create:${user.id}`;
    const lockAcquired = await this.redis.acquireLock(lockKey, 30);
    if (!lockAcquired) {
      throw new ConflictException('A comparison is already being created. Please wait.');
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

      // ⚠️ NO AI at create — creation is charts-only, unconditionally.
      //
      // The legacy `!dto.skipAI` branch that generated (or attached a cached)
      // interpretation here has been DELETED. Every client already sends
      // `skipAI: true` (web `reading/compatibility/page.tsx` and mobile
      // `compat.tsx`, both at their `createBaziCompatibility` calls), so it had
      // no caller — and once creation became free it
      // became a hole: it would have returned a full paid report for 0 credits,
      // since `createComparison` returns `flattenComparisonResponse` with no
      // preview stripping.
      //
      // A0's `deliveredFromCache` guard retires with it; its whole job was
      // keeping the create honest while the charge lived here. The AI cache is
      // now read at the reveal instead, which is where the report is delivered.
      //
      // `skipAI` remains an accepted no-op on the DTO so installed clients do
      // not 400 on an unknown property under `forbidNonWhitelisted`.
      const aiInterpretation = undefined;
      const aiProvider = undefined;
      const aiModel = undefined;
      const tokenUsage = undefined;

      // ⚠️ Creation is FREE. `creditsUsed: 0` / `paidAt: null` are the unpaid
      // state; the reveal CAS is the ONLY writer of `paidAt`. A0's
      // `deliveredFromCache` retires here along with the create-time charge —
      // its whole job was keeping the create honest while the charge lived here.
      let comparison;
      try {
        comparison = await this.prisma.baziComparison.create({
          data: {
            userId: user.id,
            profileAId: profileA.id,
            profileBId: profileB.id,
            comparisonType: dto.comparisonType,
            pairKey,
            calculationData: calculationData as Prisma.InputJsonValue,
            aiInterpretation,
            aiProvider: aiProvider as any,
            aiModel,
            tokenUsage,
            creditsUsed: 0,
            paidAt: null,
            lastCalculatedYear: new Date().getFullYear(),
          },
          include: { profileA: true, profileB: true },
        });
      } catch (err: unknown) {
        // The unique index on (userId, pairKey) is the real arbiter — the
        // read-side check above races, because the 30s advisory lock can expire
        // during a slow engine call before the row is written.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await this.prisma.baziComparison.findFirst({
            where: { userId: user.id, pairKey },
            include: { profileA: true, profileB: true },
            orderBy: { createdAt: 'desc' },
          });
          if (raced) {
            // The engine call above already produced fresh charts, and they are
            // thrown away here. Refresh a STALE row so a returning user isn't
            // shown last year's 排盤 — but only while it is unpaid. Never mutate
            // the basis of a report the user has paid for; that is what
            // `recalculateComparison` is for.
            const currentYear = new Date().getFullYear();
            if (raced.paidAt === null && (raced.lastCalculatedYear ?? 0) < currentYear) {
              const refreshed = await this.prisma.baziComparison.update({
                where: { id: raced.id },
                data: {
                  calculationData: calculationData as Prisma.InputJsonValue,
                  lastCalculatedYear: currentYear,
                },
                include: { profileA: true, profileB: true },
              });
              return this.flattenComparisonResponse(refreshed);
            }
            return this.flattenComparisonResponse(raced);
          }
        }
        throw err;
      }

      return {
        ...this.flattenComparisonResponse(comparison),
        // Lets the client offer 「您已有這對組合的合盤」 rather than the user
        // discovering a near-duplicate later. Only set when the REVERSED pair
        // exists — the same-order case returned early above.
        ...(reversed ? { reversedPairExists: true, reversedComparisonId: reversed.id } : {}),
      };
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

    // Server-side paywall: non-subscribers only get preview sections.
    //
    // ⚠️ This check used to read `creditsUsed > 0 || comparison.userId === user.id`,
    // which could never be false — the `findFirst` above already filters on
    // `userId`, so the preview-stripping branch was unreachable dead code. It
    // was masked because a comparison always had `creditsUsed: 3` by the time it
    // had an interpretation. Now that creation is free, "unpaid" is a real,
    // reachable state and this is a live paywall.
    // ⚠️ No `isSubscriber ||` — same fix as `getReading` (F-4), applied to the
    // sibling the first pass missed. F-4's stated "tell" was that the chat and
    // fortune gates carry no subscriber exemption while `getReading` did; this
    // function, one screen away, still did.
    //
    // The refund case here is already covered more strongly than on the reading
    // path — `refundComparisonCredit` clears `paidAt` AND nulls
    // `aiInterpretation` in one atomic `updateMany`. The live gap is the OTHER
    // state, which `:922-924` names explicitly: "an unpaid row with a stale
    // interpretation falls through to the charge." On the SSE path that costs
    // 3 credits; here a subscriber was handed it free.
    //
    // A subscription is a bounded credit allowance (`Plan.monthlyCredits`
    // 5/15/50), not all-access — comparisons are charged with no tier branch.
    const isPaid = comparison.paidAt !== null;

    if (isPaid) {
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
          paidAt: true, // A7 — 未解鎖 badge; free creates now have creditsUsed 0
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

    // ⚠️ Refuse rows this endpoint cannot interpret. LOAD-BEARING: ZWDS never
    // sets `lastCalculatedYear`, so the year guard below (`=== currentYear`)
    // never fires for a ZWDS row — `null === 2026` is false. Combined with
    // `paidAt` (which ZWDS rows would carry, being paid at create), the
    // gate below would ADMIT exactly the rows that must be blocked, and this
    // method would overwrite a paid ZWDS report with Bazi romance content.
    this._assertRomanceV2(comparison);

    // Only an unlocked comparison can be refreshed. Otherwise a free create
    // could be turned into a full report for the 1-credit recalculate price:
    // recalculate writes `aiInterpretation`, and the reveal paths return early
    // on an already-generated row.
    if (comparison.paidAt === null) {
      throw new BadRequestException('請先解鎖此合盤分析，才能更新年份');
    }

    const currentYear = new Date().getFullYear();

    // Check if already up-to-date
    if (comparison.lastCalculatedYear === currentYear) {
      throw new BadRequestException('此合盤分析已是最新年份');
    }

    // Charge 1 credit
    const recalcCost = 1;

    if (user.credits < recalcCost) {
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
      // Note: chartA/chartB already contain 'gender' from the Python engine
      const enrichedData: Record<string, unknown> = {
        ...calculationData,
        comparisonType: comparison.comparisonType.toLowerCase(),
        genderA: profileA.gender.toLowerCase(),
        genderB: profileB.gender.toLowerCase(),
        birthDateA: profileA.birthDate.toISOString().split('T')[0],
        birthDateB: profileB.birthDate.toISOString().split('T')[0],
      };

      // Route: Romance V2 (3-call) vs V1 (single-call)
      const isRomanceV2 = comparison.comparisonType === 'ROMANCE' &&
        !!(calculationData as Record<string, unknown>)['romancePreAnalysis'];

      let aiResult;
      if (isRomanceV2) {
        this.logger.log('Recalculate: Using Compatibility Romance V2 (3-call architecture)');
        aiResult = await this.aiService.generateCompatibilityRomanceV2(
          enrichedData,
          user.id,
        );
      } else {
        aiResult = await this.aiService.generateInterpretation(
          enrichedData,
          ReadingType.COMPATIBILITY,
          user.id,
        );
      }

      aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
      aiProvider = aiResult.provider;
      aiModel = aiResult.model;
      tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`AI re-interpretation failed: ${message}`);
      // ⚠️ Do NOT charge for a refresh that produced nothing. The AI runs BEFORE
      // the transaction, so the deduction below is simply skipped — no refund
      // needed, and none wanted: `refundComparisonCredit` is not parameterised
      // by amount (it refunds `creditsUsed`, which after a reveal holds 3, not
      // the 1 charged here), and it clears `paidAt` + nulls the interpretation,
      // which would revoke a purchased unlock and destroy the still-valid prior
      // report over a failed cheap refresh.
      throw new InternalServerErrorException(
        '合盤分析更新失敗，未扣除點數，請稍後再試。',
      );
    }

    // Atomic update: deduct credit + update comparison
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.creditsService.deductCredits(
        user.id,
        recalcCost,
        'comparison-recalculate',
        { comparisonId, tx },
      );

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
   * Idempotent: returns the existing AI if already generated.
   * Uses distributed lock to prevent concurrent AI generation for the same comparison.
   *
   * ⚠️ THIS IS A REVEAL PATH — it charges. Creating a comparison is free; the
   * 3 credits are taken here (and in `_setupComparisonStream`), once, via
   * `_chargeForReveal`'s compare-and-set on `paidAt`.
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

    // Refuse rows this endpoint cannot interpret BEFORE charging or generating —
    // see `_assertRomanceV2`. Without it a ZWDS or legacy-V1 row would be
    // charged for and then overwritten with Bazi romance content.
    this._assertRomanceV2(comparison);

    // Idempotent return — but only for a row that is BOTH generated and unlocked.
    // `aiInterpretation` alone would hand a refunded or never-paid row over free;
    // this endpoint returns `flattenComparisonResponse` with no preview stripping.
    if (comparison.aiInterpretation && comparison.paidAt !== null) {
      return this.flattenComparisonResponse(comparison);
    }

    // Charge before generating. Already-unlocked rows are a no-op (CAS returns
    // false), so a retry after a failed generation is free.
    await this._chargeForReveal(user.id, comparison);

    // ⚠️ Read the AI cache HERE — after the charge, before generation.
    //
    // A0 made this load-bearing. The cache used to be harvested at create (which
    // was the leak A0 closed); now nothing consults it on the way to a reveal, so
    // without this every unlock regenerates from scratch even on a warm cache.
    // The user still pays — a global cache hit means SOMEONE ELSE paid to
    // generate it, which is not this user's entitlement — we just skip the spend.
    const revealCacheHash = this.aiService.generateComparisonHash(
      {
        birthDate: comparison.profileA.birthDate.toISOString().split('T')[0],
        birthTime: comparison.profileA.birthTime ?? 'HOUR_UNKNOWN',
        birthCity: comparison.profileA.birthCity,
        gender: comparison.profileA.gender.toLowerCase(),
      },
      {
        birthDate: comparison.profileB.birthDate.toISOString().split('T')[0],
        birthTime: comparison.profileB.birthTime ?? 'HOUR_UNKNOWN',
        birthCity: comparison.profileB.birthCity,
        gender: comparison.profileB.gender.toLowerCase(),
      },
      comparison.comparisonType,
    );
    const revealCached = await this.aiService.getCachedInterpretation(
      revealCacheHash,
      ReadingType.COMPATIBILITY,
    );
    if (revealCached) {
      this.logger.log(`Reveal cache hit for comparison ${comparisonId}`);
      await this.prisma.baziComparison.updateMany({
        where: { id: comparisonId, userId: user.id },
        data: {
          aiInterpretation: revealCached as unknown as Prisma.InputJsonValue,
          aiProvider: 'CLAUDE',
          aiModel: 'cached',
        },
      });
      const hydrated = await this.prisma.baziComparison.findFirst({
        where: { id: comparisonId, userId: user.id },
        include: { profileA: true, profileB: true },
      });
      return this.flattenComparisonResponse(hydrated ?? comparison);
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
        birthDateA: comparison.profileA.birthDate.toISOString().split('T')[0],
        birthDateB: comparison.profileB.birthDate.toISOString().split('T')[0],
      };

      // Ensure gender in chart data for interpolateChartFields
      // (backward compat: older records may not have gender in calculationData)
      const eChartA = enrichedData['chartA'] as Record<string, unknown> | undefined;
      const eChartB = enrichedData['chartB'] as Record<string, unknown> | undefined;
      if (eChartA && !eChartA['gender']) eChartA['gender'] = comparison.profileA.gender.toLowerCase();
      if (eChartB && !eChartB['gender']) eChartB['gender'] = comparison.profileB.gender.toLowerCase();

      // Call AI service (same pattern as createComparison)
      let aiInterpretation: Prisma.InputJsonValue | undefined = undefined;
      let aiProvider: string | undefined = undefined;
      let aiModel: string | undefined = undefined;
      let tokenUsage: Prisma.InputJsonValue | undefined = undefined;

      try {
        // Route: Romance V2 (3-call) vs V1 (single-call)
        const isRomanceV2 = comparison.comparisonType === 'ROMANCE' &&
          !!calcData['romancePreAnalysis'];

        let aiResult;
        if (isRomanceV2) {
          this.logger.log('GenerateComparisonAI: Using Compatibility Romance V2 (3-call architecture)');
          aiResult = await this.aiService.generateCompatibilityRomanceV2(
            enrichedData,
            user.id,
          );
        } else {
          aiResult = await this.aiService.generateInterpretation(
            enrichedData,
            ReadingType.COMPATIBILITY,
            user.id,
          );
        }

        aiInterpretation = aiResult.interpretation as unknown as Prisma.InputJsonValue;
        aiProvider = aiResult.provider;
        aiModel = aiResult.model;
        tokenUsage = aiResult.tokenUsage as unknown as Prisma.InputJsonValue;

        // Cache the AI result for future identical comparisons
        const comparisonHash = this.aiService.generateComparisonHash(
          {
            birthDate: comparison.profileA.birthDate.toISOString().split('T')[0],
            birthTime: comparison.profileA.birthTime ?? 'HOUR_UNKNOWN',
            birthCity: comparison.profileA.birthCity,
            gender: comparison.profileA.gender.toLowerCase(),
          },
          {
            birthDate: comparison.profileB.birthDate.toISOString().split('T')[0],
            birthTime: comparison.profileB.birthTime ?? 'HOUR_UNKNOWN',
            birthCity: comparison.profileB.birthCity,
            gender: comparison.profileB.gender.toLowerCase(),
          },
          comparison.comparisonType,
        );
        this.aiService.cacheInterpretation(
          comparisonHash,
          ReadingType.COMPATIBILITY,
          calcData,
          aiResult.interpretation,
        ).catch((err) => this.logger.error(`Comparison cache write failed: ${err}`));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(
          `AI compatibility generation failed for comparison ${comparisonId}: ${message}`,
        );
        // The user was charged just above and is getting nothing. Refund rather
        // than leaving a silent debit — `refundComparisonCredit` is idempotent
        // and also clears `paidAt`, so a later retry re-charges cleanly.
        const refund = await this.creditsService
          .refundComparisonCredit(comparisonId, 'reveal-generate-failed')
          .catch((refundErr) => {
            this.logger.error(`Reveal refund failed for ${comparisonId}: ${refundErr}`);
            return { refunded: false, amount: 0 };
          });
        if (refund.refunded) {
          this.logger.warn(
            `Refunded ${refund.amount} credits for failed comparison reveal ${comparisonId}`,
          );
        }
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
  /**
   * ⚠️ Strips the SCORING analysis from an unlocked-but-unpaid comparison.
   *
   * The free create returns the two 排盤 charts — that is the whole point of
   * making creation free. But `flattenComparisonResponse` spreads
   * `compatibilityEnhanced` up to the top level, which carries `adjustedScore`,
   * `label`, `dimensionScores`, knockouts and 配偶宮 findings. That IS the paid
   * analysis: it is the same data the A6 chat gate exists to protect, on the
   * grounds that "a user can create for 0 and have the chat narrate the paid
   * analysis". Gating the chat while handing the raw numbers over directly
   * would be incoherent — before Bundle A the create charge covered this.
   *
   * Charts stay, scores go, until `paidAt` is set.
   */
  private stripUnpaidComparisonAnalysis<
    T extends { calculationData: unknown; paidAt?: Date | null },
  >(comparison: T): T {
    if (comparison.paidAt) return comparison;
    const calcData = comparison.calculationData as Record<string, unknown> | null;
    if (!calcData) return comparison;
    // ⚠️ `romancePreAnalysis` must SURVIVE, reduced. Both clients use its mere
    // PRESENCE to route to the Romance-V2 paywall — mobile
    // mobile `compat.tsx` (`isRomance`) and web
    // `reading/compatibility/page.tsx` (`isV2Romance`, the
    // history/reload path). Dropping it made mobile render the generic gate
    // instead of the 3-point unlock CTA, and stranded web users who reopened an
    // unpaid comparison on an empty view with no way to unlock. It also carries
    // the 時辰未知 flags the CTA shows BEFORE payment.
    //
    // So: allowlist, don't denylist. Only the two hourUnknown flags survive —
    // `blendedScore`, `blendedLabel`, `scoreBreakdown`, `postMarriageQuality`,
    // `peachBlossomCount*` and everything else stay behind the paywall.
    const rpa = calcData['romancePreAnalysis'] as Record<string, unknown> | undefined;
    const strippedRpa = rpa
      ? {
          lovePersonalityA: {
            hourUnknown: (rpa['lovePersonalityA'] as Record<string, unknown> | undefined)?.[
              'hourUnknown'
            ],
          },
          lovePersonalityB: {
            hourUnknown: (rpa['lovePersonalityB'] as Record<string, unknown> | undefined)?.[
              'hourUnknown'
            ],
          },
        }
      : undefined;

    return {
      ...comparison,
      calculationData: {
        chartA: calcData['chartA'],
        chartB: calcData['chartB'],
        comparisonType: calcData['comparisonType'],
        ...(strippedRpa ? { romancePreAnalysis: strippedRpa } : {}),
      },
    };
  }

  private flattenComparisonResponse<T extends { calculationData: unknown; paidAt?: Date | null }>(
    original: T,
  ): T {
    const comparison = this.stripUnpaidComparisonAnalysis(original);
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
          romancePreAnalysis: calcData['romancePreAnalysis'],
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
    profile: { birthDate: Date; birthTime: string | null; hourKnown: boolean; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    dto: CreateReadingDto,
  ): Promise<Prisma.InputJsonValue> {
    const response = await engineFetch(`${this.baziEngineUrl}/calculate`, {
      method: 'POST',
      caller: 'bazi.reading',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        birth_date: profile.birthDate.toISOString().split('T')[0],
        birth_time: profile.hourKnown ? profile.birthTime : null,
        hour_known: profile.hourKnown,
        birth_city: profile.birthCity,
        birth_timezone: profile.birthTimezone,
        birth_longitude: profile.birthLongitude,
        birth_latitude: profile.birthLatitude,
        gender: profile.gender.toLowerCase(),
        reading_type: dto.readingType.toLowerCase(),
        target_year: dto.targetYear,
      }),
      signal: AbortSignal.timeout(dto.readingType === ReadingType.CAREER || dto.readingType === ReadingType.LOVE ? 45000 : 30000),
    });

    if (!response.ok) {
      throw new Error(`Bazi engine returned ${response.status}`);
    }

    const result = await response.json();
    // The engine returns { status, data, calculationTimeMs }
    return result.data || result;
  }

  /**
   * Public passthrough to the Python engine. Mobile (and any non-web client) must
   * NOT reach the engine directly — the engine is unauthenticated and exposes far
   * more than the free-preview surface. These forward the body verbatim to
   * /calculate and /explain-element and return the engine's { status, data } envelope.
   */
  async passthroughCalculate(body: Record<string, unknown>): Promise<unknown> {
    return this.enginePassthrough('/calculate', body);
  }

  /**
   * B1/O3 — element encyclopedia, with the paid tiers gated SERVER-SIDE.
   *
   * The engine deliberately returns every layer (its docblock says so), and the
   * paywall lived entirely in `ElementExplanation.tsx` behind an `isSubscriber`
   * prop. A client-side paywall is not a paywall: `curl` got the paid content.
   *
   * Boundary mirrors the component exactly — FREE keeps Layer A and
   * `pillarContext.free`; PAID is the whole `personalized` block (Layer B
   * `pillarMeaning`, Layer C `godRoleMeaning`/`godRole`, Layer D
   * `genderMeaning`) plus `pillarContext.paid`.
   *
   * @param clerkUserId optional — the route is public, so anonymous callers
   *                    are normal and simply get the free tier.
   */
  async passthroughExplainElement(
    body: Record<string, unknown>,
    clerkUserId?: string,
  ): Promise<unknown> {
    const result = await this.enginePassthrough('/explain-element', body);
    if (await this.isSubscriberByClerkId(clerkUserId)) return result;
    return stripPaidExplanationLayers(result);
  }

  /**
   * Fails CLOSED (returns false) for an absent id, an unknown user, or a DB
   * error — the downside is a subscriber briefly seeing the free tier, versus
   * handing paid content to everyone if the lookup hiccups.
   */
  private async isSubscriberByClerkId(clerkUserId?: string): Promise<boolean> {
    if (!clerkUserId) return false;
    try {
      const user = await this.prisma.user.findUnique({
        where: { clerkUserId },
        select: { subscriptionTier: true },
      });
      return !!user && user.subscriptionTier !== 'FREE';
    } catch (err) {
      this.logger.warn(`explain-element tier lookup failed, serving free tier: ${err}`);
      return false;
    }
  }

  private async enginePassthrough(path: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await engineFetch(`${this.baziEngineUrl}${path}`, {
        method: 'POST',
        caller: 'bazi.passthrough',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new HttpException('無法連線到排盤引擎', 502);
    }
    if (!response.ok) {
      let detail: string | undefined;
      try {
        const raw = (await response.json()) as { detail?: unknown };
        // FastAPI/Pydantic 422 returns `detail` as an array of error objects;
        // other errors return a string. Normalize to a single message.
        if (typeof raw?.detail === 'string') {
          detail = raw.detail;
        } else if (Array.isArray(raw?.detail)) {
          const first = raw.detail[0] as { msg?: string } | undefined;
          detail = first?.msg;
        }
      } catch {
        /* non-JSON engine error */
      }
      throw new HttpException(detail || `Bazi engine returned ${response.status}`, response.status);
    }
    return response.json();
  }

  private async callBaziCompatibility(
    profileA: { birthDate: Date; birthTime: string | null; hourKnown: boolean; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    profileB: { birthDate: Date; birthTime: string | null; hourKnown: boolean; birthCity: string; birthTimezone: string; birthLongitude: number | null; birthLatitude: number | null; gender: string },
    dto: CreateComparisonDto,
  ): Promise<Prisma.InputJsonValue> {
    const response = await engineFetch(`${this.baziEngineUrl}/compatibility`, {
      method: 'POST',
      caller: 'bazi.compatibility',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_a: {
          birth_date: profileA.birthDate.toISOString().split('T')[0],
          birth_time: profileA.birthTime,
          // 時辰未知 (Phase 3b): thread per-party hour_known so the engine
          // returns a 3-pillar partial 合盤 instead of fabricating the hour.
          // Also fixes a live 500: a pre-existing hour-unknown profile
          // (birthTime=null) was 422'd by the engine's N1 validator because
          // hour_known was omitted (defaulted True).
          hour_known: profileA.hourKnown,
          birth_city: profileA.birthCity,
          birth_timezone: profileA.birthTimezone,
          birth_longitude: profileA.birthLongitude,
          birth_latitude: profileA.birthLatitude,
          gender: profileA.gender.toLowerCase(),
        },
        profile_b: {
          birth_date: profileB.birthDate.toISOString().split('T')[0],
          birth_time: profileB.birthTime,
          hour_known: profileB.hourKnown,  // 時辰未知 (Phase 3b)
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
