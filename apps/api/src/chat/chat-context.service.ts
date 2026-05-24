import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ReadingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// ============================================================
// Constants — version map (mirror plan's CHAT_PROMPT_VERSIONS)
// ============================================================

/**
 * Chat-specific prompt versions, keyed by reading type. Bumped when chat
 * system-prompt rules or doctrine injectors change for THAT reading type
 * (separate from PRE_ANALYSIS_VERSIONS in ai.service.ts which is for
 * reading-side prompts).
 *
 * Per-session snapshot is stored in `ChatSession.contextVersion` so the
 * controller can reject mid-session messages if the version diverges
 * from current — forcing the user to start a new session rather than
 * mixing v1.0 prompt rules with v1.1 doctrine injection.
 *
 * Phase 2 (round-2 NEW#2): per-readingType versioning so a LOVE-only
 * prompt-rule change doesn't invalidate active LIFETIME sessions, and
 * vice versa. Each entry tracks its OWN evolution.
 *
 * Partial map — only the reading types currently chat-enabled have entries
 * (Phase 2 ships LIFETIME + LOVE + CAREER + ANNUAL). Lookup helper below
 * falls back to LIFETIME's version for any unmapped type so we never crash.
 * HEALTH / COMPATIBILITY / ZWDS_* will be added when those reading types
 * are added to the chat whitelist (Phase 2.5 / Phase 3).
 */
export const CHAT_PROMPT_VERSIONS: Partial<Record<ReadingType, string>> = {
  LIFETIME: 'v1.2.2', // Phase 2 post-test bump — added anti-self-cross-sell + anti-hallucinated-tier rule
  LOVE: 'v1.0.1',     // Phase 2 post-test bump — anti-self-cross-sell + «不可虛構完整版» rule
  CAREER: 'v1.0.1',   // Phase 2 post-test bump — same rule (preventive)
  ANNUAL: 'v1.0.3',   // Phase 2 post-test bump — A-4 few-shot regex-friendly fix (moved «屬於命局架構層面而非流年動態» AFTER «範圍——» so isTopicBoundaryRefuse regex still matches)
  COMPATIBILITY: 'v1.1.0', // Phase 3.1 — Bazi-master review fixes: K-3 doctrinal correction (no marriagePalace.personality), 配偶星 gender hint, 六合/半合 scope, softer cross-sell wording
  FORTUNE: 'v1.1.0',  // Phase 1.5.z — folk content (吉色/吉數/吉食含忌食/吉時) now reaches chat scope via interpolateFortuneV1Fields folk block (2026-05-22)
};

/** Safe lookup with fallback to LIFETIME for unmapped reading types. */
export function getChatPromptVersion(readingType: ReadingType): string {
  return CHAT_PROMPT_VERSIONS[readingType] ?? CHAT_PROMPT_VERSIONS.LIFETIME ?? 'v1.0.0';
}

export type ChatPromptVersionKey = ReadingType;

// Cache version for the chat-context slim. Each entry must be ≥ the
// corresponding entry in ai.service.ts::PRE_ANALYSIS_VERSIONS (which tracks
// engine pre-analysis output structure). When the engine pre-analysis bumps,
// this MUST also bump. When the chat slim (packages/bazi-engine/app/chat_context.py)
// makes chat-only changes that don't affect engine output, this can
// independently bump using semver patch (engine v1.8.0 + chat slim
// adjustments → v1.8.2) without forcing reading re-narration.
//
// See ai.service.ts:7178 «⚠️ SYNC REQUIRED» — that list intentionally
// omits COMPATIBILITY because chat-only slim changes (Phase 3 follow-up
// H1 timingSync / H4 strip ideal-spouse / H5 anti-hallucination anchors)
// bump only this side. Both sides agree COMPATIBILITY can diverge.
//
// Phase 5 (PR #44 code review Issue 3): comment rewritten to reflect the
// actual asymmetric sync contract. The original «kept in sync with
// ai.service.ts:7177» was misleading — it implied strict mirror, which
// breaks the moment a chat-only slim change ships.
const PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH = {
  LIFETIME: 'v2.9.0',
  CAREER: 'v2.5.0',
  ANNUAL: 'v2.4.0',
  LOVE: 'v1.11.0',
  COMPATIBILITY: 'v1.8.2', // Phase 3 follow-up — H1 timingSync + H4 strip ideal-spouse + H5 restore 4 anti-hallucination anchors
  // Phase Fortune chat — mirrors FORTUNE_DAILY_PRE_ANALYSIS_VERSION='v1.1.1'
  // in packages/bazi-engine/app/fortune_constants.py. ONLY appended to the
  // version string when readingType === 'FORTUNE' (per-readingType conditional
  // in computeVersionString + getCurrentSnapshotVersions per plan Issue 11 +
  // NEW-A re-review). Adding this entry does NOT invalidate any non-FORTUNE
  // session because the conditional gate prevents it from joining the version
  // string for LIFETIME/LOVE/CAREER/ANNUAL/COMPAT sessions.
  FORTUNE: 'v1.1.1',
} as const;

const CHAT_CONTEXT_TTL_SECONDS = 24 * 60 * 60; // 24h

// ============================================================
// Pure helpers
// ============================================================

const GANZHI_STEMS = '甲乙丙丁戊己庚辛壬癸';
const GANZHI_BRANCHES = '子丑寅卯辰巳午未申酉戌亥';

/**
 * Compose 干支 (e.g., '辛亥') for a given solar year. The 60-year sexagenary
 * cycle anchors at 1984 = 甲子 (offset 0). Used by `extractLovePivotHint`
 * since engine's `romance.candidates[]` doesn't carry a pre-composed ganzhi
 * field — only `year`.
 */
export function yearToGanzhi(year: number): string {
  const offset = ((year - 1984) % 60 + 60) % 60;
  const stem = GANZHI_STEMS[offset % 10];
  const branch = GANZHI_BRANCHES[offset % 12];
  return `${stem}${branch}`;
}

// ============================================================
// Types
// ============================================================

export interface ChatContext {
  // Single-chart fields (LIFETIME / LOVE / CAREER / ANNUAL). All optional
  // at the type level so the same interface can describe COMPATIBILITY
  // payloads (which use chartA/chartB instead — see below). The single-chart
  // payload sets all of these; the compat payload sets none of them.
  chart?: Record<string, unknown>;
  strength?: Record<string, unknown>;
  favorability?: Record<string, unknown>;
  fiveElements?: Record<string, unknown>;
  patternNarrative?: unknown;
  narrativeAnchors?: unknown;
  call2NarrativeAnchors?: unknown;
  touganAnalysis?: unknown[];
  tenGodPositionAnalysis?: unknown[];
  luckPeriods?: unknown[];
  annualForecast15?: unknown[];
  monthlyForecast12?: unknown[];
  romance?: Record<string, unknown>;
  career?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  shensha?: Record<string, unknown>;
  doctrineFlags?: Record<string, unknown>;
  doctrineInjectors?: Record<string, string | null>;
  /** Phase 2 (round-1 HIGH-#2 + round-3 NEW#10) — per-readingType
   *  deterministic «pivot back to in-topic» example. Set per-session by
   *  `extractCrossSellPivotHint` based on the chart's most striking
   *  in-topic fact. The chat-prompt-builder substitutes
   *  `{crossSellPivotHint}` in refuse templates with this value. Null
   *  when no compelling in-topic example exists; the substitution then
   *  strips the entire pivot clause via regex fallback. */
  crossSellPivotHint?: string | null;
  /** M2 (Phase 3 follow-up) — discriminant fields for COMPATIBILITY.
   *  Present only when this payload describes a chart pair (compat chat).
   *  When set, chartA + chartB carry per-party slimmed contexts and the
   *  single-chart fields above are absent. The chat-prompt-builder and
   *  chat-validators use `chartA != null && chartB != null` as the typed
   *  detection check (replaces the previous `as unknown as Record<...>`
   *  duck-typing). */
  chartA?: Record<string, unknown>;
  chartB?: Record<string, unknown>;
  overallScore?: number;
  adjustedScore?: number;
  /** Engine's `COMPATIBILITY_LABELS` value (8 base) OR `SPECIAL_LABEL`
   *  override (相愛相殺/前世冤家/命中注定) — 11 possible values total.
   *  Surfaced verbatim by `extractCompatPivotHint`. */
  verbalLabel?: string;
  comparisonType?: string;
  dimensionScores?: Record<string, unknown>;
  crossChartFindings?: unknown[];
  specialFindings?: Record<string, unknown>;
  knockoutConditions?: unknown[];
  /** H1 (Phase 3 follow-up) — engine's timingSync from
   *  compatibility_enhanced.py:1798-1801. Shape: {goldenYears, challengeYears,
   *  luckCycleSyncScore}. Entry: {year, reason}, each capped at 5. */
  timingSync?: Record<string, unknown>;
  /** Phase Fortune — present only when this payload describes a FORTUNE
   *  (daily fortune) chat scope. Mirrors the engine's
   *  `build_chat_context_fortune` shape. Carries the day pillar, today's
   *  auspiciousness label + energy score, 5-dim breakdown, headliner
   *  signals, folk content (wealth direction), plus Option 2.5 transparency
   *  fields used by the anti-incoherence prompt rule. The day-pillar
   *  TRANSIENT findings ride in `dailyFortune.dimensions[].signals[]` and
   *  are consumed by `interpolateFortuneV1Fields` below. */
  dailyFortune?: Record<string, unknown>;
  /** Phase Fortune — ISO `YYYY-MM-DD` anchor date the FORTUNE chat session
   *  is pinned to. Set by engine; mirrored from the
   *  `ChatSession.fortuneAnchorDate` column. */
  anchorDate?: string;
}

export interface ChatContextCacheKey {
  birthHash: string;
  /** Combined version key — bump invalidates all cached chat contexts. */
  versions: string;
}

// ============================================================
// Service
// ============================================================

/**
 * ChatContextService — fetches the slim chat context (with all 4 enhanced
 * pipelines + doctrine injectors) from the Python engine, caches in Redis.
 *
 * Per the next-the-big-feature-proud-manatee plan:
 *
 * 1. **4-pipeline merge guarantee**: calls Python `/build-chat-context` which
 *    invokes `calculate_bazi_with_all_pipelines` → unconditionally runs
 *    lifetime + love + career + annual. Without this, Issue 22 would resurface
 *    (chat AI gets empty doctrineFlags and falls back to folk doctrine).
 *
 * 2. **Cache key**: `chat-context:{birthHash}:{versions}`. Bumping any
 *    PRE_ANALYSIS_VERSION or CHAT_PROMPT_VERSION invalidates. TTL 24h.
 *
 * 3. **Per-session version snapshot**: caller (chat.service.ts) snapshots
 *    `versions` into `ChatSession.contextVersion` at session create. If
 *    versions diverge mid-session (post-deploy bump), session message
 *    handler rejects and forces new-session start.
 */
@Injectable()
export class ChatContextService {
  private readonly logger = new Logger(ChatContextService.name);
  private readonly baziEngineUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.baziEngineUrl = this.config.get<string>('BAZI_ENGINE_URL') || 'http://localhost:5001';
  }

  /**
   * Get the chat context for a given Bazi reading. Caches in Redis 24h.
   * The reading's birth profile drives the engine call; reading itself isn't
   * passed (chat needs all 4 pipelines, not whatever reading_type the existing
   * Reading.calculationData was generated with).
   *
   * Phase 2 — `readingType` is used to compute the per-type
   * `crossSellPivotHint` (deterministic «pivot back to in-topic» example).
   * The hint is added AFTER the engine response is cached, so the same
   * cached engine output serves all reading types — only the hint varies.
   */
  async getChatContextForReading(
    readingId: string,
    readingType?: ReadingType,
  ): Promise<ChatContext> {
    const reading = await this.prisma.baziReading.findUnique({
      where: { id: readingId },
      include: { birthProfile: true },
    });
    if (!reading) {
      throw new NotFoundException(`Reading not found: ${readingId}`);
    }

    const profile = reading.birthProfile;
    const targetYear = reading.targetYear ?? new Date().getUTCFullYear();
    const targetMonth = new Date().getUTCMonth() + 1; // current month for 流月

    const birthHash = this.computeBirthHash(profile, targetYear);
    const versions = this.computeVersionString();
    const cacheKey = `chat-context:${birthHash}:${versions}`;

    // Try Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const ctx = JSON.parse(cached) as ChatContext;
        // Compute pivot hint AFTER cache hit — hint depends on readingType
        // so it can't be baked into the shared engine cache.
        return this.withCrossSellPivotHint(ctx, readingType);
      } catch (err) {
        this.logger.warn(`Failed to parse cached chat-context for key ${cacheKey}: ${err}`);
      }
    }

    // Cache miss — call Python engine. Note: crossSellPivotHint is computed
    // post-fetch (TS-side) since it derives from existing engine fields and
    // doesn't need engine wiring.
    const engineCtx = await this.fetchChatContextFromEngine({
      birthDate: profile.birthDate.toISOString().slice(0, 10),
      birthTime: profile.birthTime,
      birthCity: profile.birthCity,
      birthTimezone: profile.birthTimezone,
      gender: profile.gender.toLowerCase(),
      birthLongitude: profile.birthLongitude,
      birthLatitude: profile.birthLatitude,
      targetYear,
      targetMonth,
    });

    // Cache the engine output WITHOUT the pivot hint (shared across all
    // reading types). Hint is added per-call below.
    try {
      await this.redis.set(cacheKey, JSON.stringify(engineCtx), CHAT_CONTEXT_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Failed to cache chat-context for key ${cacheKey}: ${err}`);
    }

    return this.withCrossSellPivotHint(engineCtx, readingType);
  }

  /**
   * Phase 3 — get the chat context for a given BaziComparison. Mirrors
   * `getChatContextForReading` but routes to `/build-chat-context-compat`
   * (two-chart slim). Cache key: `chat-context-compat:${sha256(birthHashA +
   * '|' + birthHashB).slice(0, 16)}:${comparisonType}:${versions}` —
   * **order-sensitive** (A=user, B=partner; do NOT sort hashes) so swapping
   * A↔B produces a different key.
   */
  async getChatContextForComparison(
    comparisonId: string,
    readingType: ReadingType = 'COMPATIBILITY',
  ): Promise<ChatContext> {
    const comparison = await this.prisma.baziComparison.findUnique({
      where: { id: comparisonId },
      include: { profileA: true, profileB: true },
    });
    if (!comparison) {
      throw new NotFoundException(`Comparison not found: ${comparisonId}`);
    }

    const profileA = comparison.profileA;
    const profileB = comparison.profileB;
    const targetYear = comparison.lastCalculatedYear ?? new Date().getUTCFullYear();
    const targetMonth = new Date().getUTCMonth() + 1;

    const birthHashA = this.computeBirthHash(profileA, targetYear);
    const birthHashB = this.computeBirthHash(profileB, targetYear);
    // Order-sensitive: A is user, B is partner. Sorting would create
    // cross-session collision if both A and B ever became platform users.
    const pairHash = createHash('sha256')
      .update(birthHashA + '|' + birthHashB)
      .digest('hex')
      .slice(0, 16);
    const versions = this.computeVersionString(readingType);
    const cacheKey = `chat-context-compat:${pairHash}:${comparison.comparisonType}:${versions}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const ctx = JSON.parse(cached) as ChatContext;
        return this.withCrossSellPivotHint(ctx, readingType);
      } catch (err) {
        this.logger.warn(`Failed to parse cached compat chat-context for key ${cacheKey}: ${err}`);
      }
    }

    const engineCtx = await this.fetchChatContextFromEngineCompat({
      profileA: {
        birthDate: profileA.birthDate.toISOString().slice(0, 10),
        birthTime: profileA.birthTime,
        birthCity: profileA.birthCity,
        birthTimezone: profileA.birthTimezone,
        gender: profileA.gender.toLowerCase(),
        birthLongitude: profileA.birthLongitude,
        birthLatitude: profileA.birthLatitude,
      },
      profileB: {
        birthDate: profileB.birthDate.toISOString().slice(0, 10),
        birthTime: profileB.birthTime,
        birthCity: profileB.birthCity,
        birthTimezone: profileB.birthTimezone,
        gender: profileB.gender.toLowerCase(),
        birthLongitude: profileB.birthLongitude,
        birthLatitude: profileB.birthLatitude,
      },
      comparisonType: comparison.comparisonType.toLowerCase(), // engine matches lowercase
      targetYear,
      targetMonth,
    });

    try {
      await this.redis.set(cacheKey, JSON.stringify(engineCtx), CHAT_CONTEXT_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Failed to cache compat chat-context for key ${cacheKey}: ${err}`);
    }

    return this.withCrossSellPivotHint(engineCtx, readingType);
  }

  /**
   * Phase Fortune — get the chat context for a FORTUNE chat session.
   * Subject: `(profileId, anchorDate)` — neither `readingId` nor
   * `comparisonId`. Mirrors `getChatContextForReading` but routes to
   * `/build-chat-context-fortune` and additionally fetches the persisted
   * `DailyFortuneSnapshot.engineOutputJson` for the same
   * `(chartHash, anchorDate)` to pass through as `precomputed_daily`
   * (Issue 1 — avoid double-compute when the fortune page already
   * generated the day's output).
   *
   * Cache key: `chat-context-fortune:{birthHash}:{anchorDateIso}:{versions}`.
   * Versions string is per-readingType-conditional (Issue 11 + NEW-A —
   * `pa-fort` only appended for FORTUNE; existing other-type cached
   * contexts remain valid).
   */
  async getChatContextForFortune(
    profileId: string,
    anchorDate: string,
    readingType: ReadingType = 'FORTUNE',
  ): Promise<ChatContext> {
    const profile = await this.prisma.birthProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      throw new NotFoundException(`Birth profile not found: ${profileId}`);
    }

    const anchorYear = parseInt(anchorDate.slice(0, 4), 10);
    const anchorMonth = parseInt(anchorDate.slice(5, 7), 10);
    if (
      Number.isNaN(anchorYear) ||
      Number.isNaN(anchorMonth) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)
    ) {
      throw new Error(
        `Invalid anchorDate format: ${anchorDate} (expected YYYY-MM-DD)`,
      );
    }

    const birthHash = this.computeBirthHash(profile, anchorYear);
    const versions = this.computeVersionString(readingType);
    const cacheKey = `chat-context-fortune:${birthHash}:${anchorDate}:${versions}`;

    // Try Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const ctx = JSON.parse(cached) as ChatContext;
        return this.withCrossSellPivotHint(ctx, readingType);
      } catch (err) {
        this.logger.warn(
          `Failed to parse cached fortune chat-context for key ${cacheKey}: ${err}`,
        );
      }
    }

    // Reuse persisted DailyFortuneSnapshot when available (Issue 1 — skip
    // recompute). Note: we use the chartHash convention from
    // fortune.service.ts (which includes birthTimezone in the hash —
    // mirrored in computeBirthHash above via profile.birthTimezone).
    // Snapshot lookup uses the engine's chart_hash (separate from chat
    // birthHash — `fortune.service.ts` writes it). Resolve via the
    // `(birthProfileId, anchorDate)` index already on the snapshot table.
    let precomputedDaily: Record<string, unknown> | undefined;
    try {
      const snapshot = await this.prisma.dailyFortuneSnapshot.findFirst({
        where: {
          birthProfileId: profileId,
          scope: 'DAY',
          anchorDate: new Date(anchorDate + 'T00:00:00.000Z'),
        },
        orderBy: { generatedAt: 'desc' },
      });
      if (snapshot?.engineOutputJson) {
        precomputedDaily = snapshot.engineOutputJson as Record<string, unknown>;
      }
    } catch (err) {
      // Non-fatal — fall back to engine recompute path
      this.logger.warn(
        `Failed to fetch DailyFortuneSnapshot for (${profileId}, ${anchorDate}): ${err}`,
      );
    }

    const engineCtx = await this.fetchChatContextFromEngineFortune({
      birthDate: profile.birthDate.toISOString().slice(0, 10),
      birthTime: profile.birthTime,
      birthCity: profile.birthCity,
      birthTimezone: profile.birthTimezone,
      gender: profile.gender.toLowerCase(),
      birthLongitude: profile.birthLongitude,
      birthLatitude: profile.birthLatitude,
      anchorDate,
      targetYear: anchorYear,
      targetMonth: anchorMonth,
      precomputedDaily,
    });

    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(engineCtx),
        CHAT_CONTEXT_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to cache fortune chat-context for key ${cacheKey}: ${err}`,
      );
    }

    return this.withCrossSellPivotHint(engineCtx, readingType);
  }

  /**
   * Add the per-readingType `crossSellPivotHint` field to a chat context
   * payload. Round-1 HIGH-#2 + round-2 NEW#1 + round-3 NEW#10.
   *
   * Source per reading type:
   * - LOVE → top-scored romance candidate's `year_ganzhi (label/archetype)`
   * - CAREER → top auspicious career year (active luck period or peak month)
   * - ANNUAL → top-1 month from `monthlyForecast12` by auspiciousness
   * - LIFETIME / others → null (no refuse template, no pivot needed)
   *
   * Returns the SAME context object with `crossSellPivotHint` added (or
   * null when no compelling in-topic example exists; the prompt builder
   * strips the entire pivot clause via regex when null).
   */
  private withCrossSellPivotHint(
    ctx: ChatContext,
    readingType: ReadingType | undefined,
  ): ChatContext {
    return {
      ...ctx,
      crossSellPivotHint: this.extractCrossSellPivotHint(ctx, readingType),
    };
  }

  private extractCrossSellPivotHint(
    ctx: ChatContext,
    readingType: ReadingType | undefined,
  ): string | null {
    if (!readingType) return null;
    try {
      switch (readingType) {
        case 'LOVE':
          return this.extractLovePivotHint(ctx);
        case 'CAREER':
          return this.extractCareerPivotHint(ctx);
        case 'ANNUAL':
          return this.extractAnnualPivotHint(ctx);
        case 'COMPATIBILITY':
          return this.extractCompatPivotHint(ctx);
        case 'FORTUNE':
          return this.extractFortunePivotHint(ctx);
        default:
          return null; // LIFETIME never refuses; no pivot needed
      }
    } catch (err) {
      this.logger.warn(
        `Failed to extract crossSellPivotHint for readingType=${readingType}: ${err}`,
      );
      return null;
    }
  }

  /**
   * FORTUNE pivot — prefers the day's pre-rendered headliner signal
   * narrative (rich Chinese sentence from
   * `daily_enhanced._compute_headliner_signals`), e.g. «今日紅鸞動，子卯刑配偶宮».
   * Falls back to `{dayGanZhi}日（{auspiciousness}，{energyScore}分）` when
   * no headliner narrative is present. Used in FORTUNE refuse templates'
   * «...回到今日命局：{crossSellPivotHint}» pivot clause to keep the
   * refused conversation grounded in today (the load-bearing F-2 «cite-today-
   * first» pattern from the Bazi-master few-shot draft).
   */
  private extractFortunePivotHint(ctx: ChatContext): string | null {
    const daily = ctx.dailyFortune as Record<string, unknown> | undefined;
    if (!daily) return null;

    // 1. Prefer headliner signal — pre-rendered narrative from engine
    const headliner = daily.headlinerSignals as
      | Record<string, unknown>
      | undefined;
    if (headliner) {
      const triggers = (headliner.triggers ?? []) as Array<Record<string, unknown>>;
      if (Array.isArray(triggers) && triggers.length > 0) {
        const top = triggers[0];
        const narrative = top?.narrative as string | undefined;
        if (typeof narrative === 'string' && narrative.length > 0) {
          return narrative;
        }
      }
    }

    // 2. Fallback: dayGanZhi（auspiciousness，energyScore分）
    const dayGanZhi = daily.dayGanZhi as string | undefined;
    const auspiciousness = daily.auspiciousness as string | undefined;
    const energyScore = daily.energyScore as number | undefined;
    if (dayGanZhi && auspiciousness && typeof energyScore === 'number') {
      return `${dayGanZhi}日（${auspiciousness}，${energyScore}分）`;
    }
    if (dayGanZhi) {
      return `${dayGanZhi}日`;
    }
    return null;
  }

  /**
   * COMPATIBILITY pivot — engine emits `verbalLabel` from `COMPATIBILITY_LABELS`
   * (8 base: 天作之合/天生一對/相得益彰/互補雙星/歡喜冤家/需要磨合/挑戰重重/緣分較淺)
   * + 3 SPECIAL overrides (相愛相殺/前世冤家/命中注定). Pair with `adjustedScore`
   * (NOT `overallScore` — `label` is derived from adjustedScore per
   * compatibility_enhanced.py:1751-1759). Format: «合盤總分 78分（互補雙星）».
   */
  private extractCompatPivotHint(ctx: ChatContext): string | null {
    // M2 (Phase 3 follow-up) — typed access via ChatContext optional compat fields.
    const score = ctx.adjustedScore;
    const label = ctx.verbalLabel;
    if (typeof score === 'number' && label) {
      return `合盤總分 ${score}分（${label}）`;
    }
    return null;
  }

  /**
   * LOVE pivot — top-scored romance candidate. Engine emits
   * `romance.candidates[]` from `lifetime_enhanced._compute_romance_candidates`
   * with shape `{year, tier, signal, signal_names, score,
   *   romance_archetype?, chong_valence?, chong_label?, bidirectional?,
   *   is_kong_wang?}` (lifetime_enhanced.py:1169). Note: NO `ganzhi` —
   * engine doesn't ship it on candidates. We compose ganzhi deterministically
   * from year via the 60-year 干支 cycle (helper `yearToGanzhi` below).
   * Fields are SNAKE_CASE in engine output (Python convention), so use
   * `chong_label` not `chongLabel`.
   * Format: «2031 辛亥（正緣動年）» or fallback «2031 辛亥».
   */
  private extractLovePivotHint(ctx: ChatContext): string | null {
    const romance = ctx.romance as Record<string, unknown> | undefined;
    if (!romance) return null;
    const candidates = (romance.candidates ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    // Engine returns candidates in score-descending order; just take [0].
    const top = candidates[0];
    const year = top.year as number | undefined;
    if (!year) return null;
    const ganzhi = yearToGanzhi(year);
    // Prefer the human-readable `chong_label` (e.g., '正緣動年', '婚動年').
    // Fall back to a romance_archetype translation; else just year+ganzhi.
    const chongLabel = (top.chong_label ?? top.chongLabel ?? null) as string | null;
    const archetype = (top.romance_archetype ?? top.romanceArchetype ?? null) as string | null;
    const label =
      chongLabel ??
      (archetype === 'zheng_yuan'
        ? '正緣桃花年'
        : archetype === 'pian_yuan'
          ? '偏緣動年'
          : null);
    return label ? `${year} ${ganzhi}（${label}）` : `${year} ${ganzhi}`;
  }

  /**
   * CAREER pivot — top-scored career year. Phase 2 acceptable simplification:
   * use the current 大運 (active luck period) name if it has positive career
   * indicators, else fall back to top auspicious month from annual forecast.
   * The plan's «new ~30 LOC engine helper» is a future enhancement; this
   * TS-side approximation works for Phase 2 launch.
   */
  private extractCareerPivotHint(ctx: ChatContext): string | null {
    const career = ctx.career as Record<string, unknown> | undefined;
    if (!career) return null;
    // Engine shape (career_enhanced.py:1504): `activeLuckPeriod` carries
    // {stem, branch, tenGod, startYear, endYear} as SEPARATE fields — not
    // pre-composed `ganzhi`/`period`. Compose them here. snake_case fallbacks
    // for the deterministic sibling field at career_enhanced.py:1528.
    const activeLp = career.activeLuckPeriod as Record<string, unknown> | undefined;
    if (activeLp) {
      const stem = (activeLp.stem ?? '') as string;
      const branch = (activeLp.branch ?? '') as string;
      const startYear = (activeLp.startYear ?? activeLp.start_year ?? 0) as number;
      const endYear = (activeLp.endYear ?? activeLp.end_year ?? 0) as number;
      const tenGod = (activeLp.tenGod ?? activeLp.ten_god ?? '') as string;
      const ganzhi = stem && branch ? `${stem}${branch}` : '';
      const period = startYear && endYear ? `${startYear}-${endYear}` : '';
      if (ganzhi && period) {
        return tenGod
          ? `現行${ganzhi}大運（${period}，${tenGod}）`
          : `現行${ganzhi}大運（${period}）`;
      }
    }
    // Fallback: top auspicious month. Engine shape (chat_context.py:500-507):
    // {month, stem, branch, auspiciousness, ...} — ganzhi is NOT pre-composed.
    // CAREER audit pass 2026-05-12 — mirror ANNUAL extractor's polish:
    // (a) prefer 大吉 over 吉, (b) normalize integer month → «N月».
    const monthly = ctx.monthlyForecast12 as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(monthly) && monthly.length > 0) {
      const top = monthly.find((m) => m.auspiciousness === '大吉')
        ?? monthly.find((m) => m.auspiciousness === '吉')
        ?? monthly[0];
      const rawMonth = top.month ?? top.monthLabel ?? '';
      let month: string;
      if (typeof rawMonth === 'number') {
        month = `${rawMonth}月`;
      } else if (typeof rawMonth === 'string') {
        month = rawMonth && !rawMonth.includes('月') && /^\d+$/.test(rawMonth) ? `${rawMonth}月` : rawMonth;
      } else {
        month = '';
      }
      const stem = (top.stem ?? '') as string;
      const branch = (top.branch ?? '') as string;
      const ganzhi = stem && branch ? `${stem}${branch}` : '';
      if (month && ganzhi) {
        return `${month}（${ganzhi}）`;
      }
    }
    return null;
  }

  /**
   * ANNUAL pivot — top-1 month from `monthlyForecast12` by auspiciousness.
   * Engine shape (chat_context.py:500-507): {month, stem, branch,
   * auspiciousness, ...}. `ganzhi` is composed here from stem+branch.
   * Month is normalized to «N月» form when engine emits a bare integer
   * (annual_enhanced.py:2217 falls back to int monthIndex when month_data
   * has no string label) so the pivot reads as «5月癸巳（吉）» not «5癸巳（吉）».
   */
  private extractAnnualPivotHint(ctx: ChatContext): string | null {
    const monthly = ctx.monthlyForecast12 as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(monthly) || monthly.length === 0) return null;
    // Prefer 大吉 (more auspicious) over plain 吉; fallback to first month.
    // Earlier impl used a single `find()` with «大吉 || 吉» which returned
    // the FIRST match regardless of tier — a plain 吉 in month 1 would
    // beat a 大吉 in month 11. ANNUAL audit fix 2026-05-12.
    const top = monthly.find((m) => m.auspiciousness === '大吉')
      ?? monthly.find((m) => m.auspiciousness === '吉')
      ?? monthly[0];
    const rawMonth = top.month ?? top.monthLabel ?? '';
    // Normalize: integer → «N月»; string without 月 suffix → append 月; else as-is.
    let month: string;
    if (typeof rawMonth === 'number') {
      month = `${rawMonth}月`;
    } else if (typeof rawMonth === 'string') {
      month = rawMonth && !rawMonth.includes('月') && /^\d+$/.test(rawMonth) ? `${rawMonth}月` : rawMonth;
    } else {
      month = '';
    }
    const stem = (top.stem ?? '') as string;
    const branch = (top.branch ?? '') as string;
    const ganzhi = stem && branch ? `${stem}${branch}` : '';
    const auspicious = (top.auspiciousness ?? '') as string;
    if (!month || !ganzhi) return null;
    return auspicious
      ? `${month}${ganzhi}（${auspicious}）`
      : `${month}${ganzhi}`;
  }

  /**
   * Returns the cache key version string. Phase 2 (round-2 NEW#2): the
   * lifetime prompt version is per-readingType; the pre-analysis hash
   * still aggregates 4 base pipelines (lifetime/love/career/annual) +
   * compat because the engine merges them regardless of which reading-type
   * chat is invoked from (Phase 1 Layer 1 fix). The cache key includes
   * the readingType so a LOVE session's cache entry doesn't get
   * invalidated when only CAREER's prompt version bumps.
   *
   * Phase Fortune (plan Issue 11 + NEW-A re-review): `pa-fort` is
   * conditionally appended ONLY for `readingType === 'FORTUNE'`. Adding
   * `FORTUNE` to `PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH` therefore does NOT
   * change the version string for any non-FORTUNE session, so existing
   * LIFETIME/LOVE/CAREER/ANNUAL/COMPAT cached contexts stay valid. Same
   * conditional applied in `getCurrentSnapshotVersions` below to keep the
   * drift-check semantics aligned (`chat.service.ts:514+`).
   */
  computeVersionString(readingType: ReadingType = 'LIFETIME'): string {
    const parts: string[] = [
      `${readingType.toLowerCase()}=${getChatPromptVersion(readingType)}`,
      // Pre-analysis hash stays aggregate — engine merges all 4 (or all 4 + compat for COMPATIBILITY).
      `pa-life=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LIFETIME}`,
      `pa-love=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LOVE}`,
      `pa-car=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.CAREER}`,
      `pa-ann=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.ANNUAL}`,
      `pa-compat=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.COMPATIBILITY}`,
    ];
    if (readingType === 'FORTUNE') {
      parts.push(`pa-fort=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE}`);
    }
    return parts.join('|');
  }

  /**
   * Returns the version snapshot strings used for `ChatSession.contextVersion`
   * AND `ChatSession.preAnalysisVersion` snapshots. The mid-session drift
   * check compares stored snapshots to these returns; if they diverge the
   * session is forced to end (user starts a new session).
   *
   * Phase 2 (round-2 NEW#2): `contextVersion` is now per-readingType so a
   * LOVE-only prompt change doesn't invalidate active LIFETIME sessions
   * (and vice versa). `preAnalysisVersion` stays aggregate since the
   * engine output it represents merges all 4 pipelines regardless of
   * which reading-type chat is invoked from.
   */
  getCurrentSnapshotVersions(readingType: ReadingType = 'LIFETIME'): {
    contextVersion: string;
    preAnalysisVersion: string;
  } {
    // Phase Fortune (plan Issue 11 + NEW-A re-review): `fort=...` is
    // conditionally appended ONLY for FORTUNE sessions. This keeps existing
    // LIFETIME/LOVE/CAREER/ANNUAL/COMPAT sessions' stored
    // `preAnalysisVersion` snapshot byte-identical pre- and post-ship — no
    // mass `CONTEXT_VERSION_DRIFTED` eviction on the next message
    // (`chat.service.ts:517` drift check).
    const paParts: string[] = [
      `life=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LIFETIME}`,
      `love=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LOVE}`,
      `car=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.CAREER}`,
      `ann=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.ANNUAL}`,
      `compat=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.COMPATIBILITY}`,
    ];
    if (readingType === 'FORTUNE') {
      paParts.push(`fort=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE}`);
    }
    return {
      contextVersion: getChatPromptVersion(readingType),
      preAnalysisVersion: paParts.join('|'),
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private computeBirthHash(
    profile: {
      birthDate: Date;
      birthTime: string;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    },
    targetYear: number,
  ): string {
    const inputs = [
      profile.birthDate.toISOString().slice(0, 10),
      profile.birthTime,
      profile.birthCity,
      profile.birthTimezone,
      profile.gender.toLowerCase(),
      profile.birthLongitude ?? '',
      profile.birthLatitude ?? '',
      targetYear,
    ].join('|');
    return createHash('sha256').update(inputs).digest('hex').slice(0, 16);
  }

  private async fetchChatContextFromEngine(args: {
    birthDate: string;
    birthTime: string;
    birthCity: string;
    birthTimezone: string;
    gender: string;
    birthLongitude: number | null;
    birthLatitude: number | null;
    targetYear: number;
    targetMonth: number;
  }): Promise<ChatContext> {
    const response = await fetch(`${this.baziEngineUrl}/build-chat-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        birth_date: args.birthDate,
        birth_time: args.birthTime,
        birth_city: args.birthCity,
        birth_timezone: args.birthTimezone,
        gender: args.gender,
        birth_longitude: args.birthLongitude,
        birth_latitude: args.birthLatitude,
        target_year: args.targetYear,
        target_month: args.targetMonth,
      }),
      // 4-pipeline merge is heavier than single-pipeline; allow extra time
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.error(
        `Engine /build-chat-context returned ${response.status}: ${errBody}`,
      );
      throw new Error(`Bazi engine returned ${response.status}`);
    }

    const result = await response.json();
    if (!result.chatContext) {
      throw new Error('Engine response missing chatContext');
    }
    return result.chatContext as ChatContext;
  }

  /**
   * Phase 3 — fetch compat chat context (two-chart slim) from Python engine.
   */
  private async fetchChatContextFromEngineCompat(args: {
    profileA: {
      birthDate: string;
      birthTime: string;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    };
    profileB: {
      birthDate: string;
      birthTime: string;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    };
    comparisonType: string;
    targetYear: number;
    targetMonth: number;
  }): Promise<ChatContext> {
    const buildPayload = (p: typeof args.profileA) => ({
      birth_date: p.birthDate,
      birth_time: p.birthTime,
      birth_city: p.birthCity,
      birth_timezone: p.birthTimezone,
      gender: p.gender,
      birth_longitude: p.birthLongitude,
      birth_latitude: p.birthLatitude,
      target_year: args.targetYear,
      target_month: args.targetMonth,
    });
    const response = await fetch(`${this.baziEngineUrl}/build-chat-context-compat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_a: buildPayload(args.profileA),
        profile_b: buildPayload(args.profileB),
        comparison_type: args.comparisonType,
        target_year: args.targetYear,
        target_month: args.targetMonth,
      }),
      // Dual-chart pipeline is heavier than single-chart; allow extra time
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.error(
        `Engine /build-chat-context-compat returned ${response.status}: ${errBody}`,
      );
      throw new Error(`Bazi engine returned ${response.status}`);
    }

    const result = await response.json();
    if (!result.chatContext) {
      throw new Error('Engine response missing chatContext');
    }
    return result.chatContext as ChatContext;
  }

  /**
   * Phase Fortune — fetch FORTUNE chat context from Python engine. When
   * `precomputedDaily` is provided (from a persisted `DailyFortuneSnapshot`
   * for the same `(chartHash, anchorDate)`), the engine skips its own
   * `compute_daily_fortune()` call and uses the snapshot verbatim
   * (Issue 1 — ~50ms saved on warm-snapshot path). Cold path computes from
   * scratch.
   *
   * Timeout: 45s — matches `/build-chat-context-compat`. Two heavy ops
   * (chart slim + daily fortune) but snapshot-reuse path keeps typical
   * latency under 200ms.
   */
  private async fetchChatContextFromEngineFortune(args: {
    birthDate: string;
    birthTime: string;
    birthCity: string;
    birthTimezone: string;
    gender: string;
    birthLongitude: number | null;
    birthLatitude: number | null;
    anchorDate: string;
    targetYear: number;
    targetMonth: number;
    precomputedDaily?: Record<string, unknown>;
  }): Promise<ChatContext> {
    const response = await fetch(
      `${this.baziEngineUrl}/build-chat-context-fortune`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birth_date: args.birthDate,
          birth_time: args.birthTime,
          birth_city: args.birthCity,
          birth_timezone: args.birthTimezone,
          gender: args.gender,
          birth_longitude: args.birthLongitude,
          birth_latitude: args.birthLatitude,
          anchor_date: args.anchorDate,
          target_year: args.targetYear,
          target_month: args.targetMonth,
          precomputed_daily: args.precomputedDaily ?? null,
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.error(
        `Engine /build-chat-context-fortune returned ${response.status}: ${errBody}`,
      );
      throw new Error(`Bazi engine returned ${response.status}`);
    }

    const result = await response.json();
    if (!result.chatContext) {
      throw new Error('Engine response missing chatContext');
    }
    return result.chatContext as ChatContext;
  }
}

// ============================================================
// Phase Fortune — day-pillar TRANSIENT doctrine injector (Issue 14)
// ============================================================

/**
 * Build a deterministic Chinese «今日X日触發的教義事件» block from the day's
 * `dailyFortune.dimensions[].signals[]` array. Mirrors the Phase 12g.6 Gap 2
 * pattern at `ai.service.ts:3794+::interpolateLoveV2Fields`: the engine emits
 * structured signal types (e.g., `shangguan_jian_guan_transient`,
 * `bijie_duo_cai_*`, `chong_day_branch_*`, `honluan_triggered`); the
 * interpolator pre-formats Chinese sentences for the AI to consume verbatim
 * — anti-hallucination via deterministic phrasing.
 *
 * Returns null when no transient findings are present (so the
 * chat-prompt-builder can omit the block cleanly).
 *
 * This is INTENTIONALLY exported as a free function (not a class method) so
 * `chat-prompt-builder.ts` can call it after pulling the FORTUNE-typed
 * ChatContext without depending on the service singleton.
 */
export function interpolateFortuneV1Fields(ctx: ChatContext): string | null {
  const daily = ctx.dailyFortune as Record<string, unknown> | undefined;
  if (!daily) return null;

  const dayGanZhi = daily.dayGanZhi as string | undefined;
  if (!dayGanZhi) return null;

  const dims = daily.dimensions as Record<string, unknown> | undefined;
  if (!dims || typeof dims !== 'object') return null;

  const lines: string[] = [];
  const DIM_LABELS: Record<string, string> = {
    romance: '感情',
    career: '事業',
    finance: '財運',
    travel: '出行',
    health: '健康',
  };

  for (const [dimKey, dimLabel] of Object.entries(DIM_LABELS)) {
    const dim = dims[dimKey] as Record<string, unknown> | undefined;
    if (!dim) continue;
    const signals = (dim.signals ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(signals) || signals.length === 0) continue;

    for (const sig of signals) {
      // Engine schema (daily_enhanced.py): each signal has a `type` field
      // (snake_case) + optional `valence` / `narrative` / domain-specific
      // metadata (e.g., `tenGod`, `role`, `element`).
      const sigType = sig?.type as string | undefined;
      const valence = sig?.valence as string | undefined;
      const sigNarrative = sig?.narrative as string | undefined;
      if (!sigType) continue;

      // Phase 12h.B Item 2 — 傷官見官 day-transient (daily_enhanced.py:325/334)
      if (sigType === 'shangguan_jian_guan_transient') {
        const valenceCN =
          valence === 'beneficial'
            ? '反吉（正官為忌神，傷官制官有利）'
            : valence === 'harmful'
              ? '為禍（正官為用神或喜神，受制反凶）'
              : '中性';
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日触發 傷官見官 流日 — 性質判定：${valenceCN}` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
      // Phase 12h.B Item 8 — 比劫奪財 day-transient (daily_enhanced.py:477/488)
      else if (sigType === 'bi_jie_duo_cai_transient') {
        const valenceCN =
          valence === 'beneficial'
            ? '反吉（財為忌神，比劫敵財有利）'
            : valence === 'harmful'
              ? '為禍（財為用神或喜神，比劫奪之）'
              : valence === 'not_applicable'
                ? '不適用（日主弱不主奪）'
                : '中性';
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日触發 比劫奪財 流日 — 性質判定：${valenceCN}` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
      // 沖日支 — universal caution (3 dim-specific variants from daily_enhanced.py:372/555/627)
      else if (
        sigType === 'chong_day_branch_career' ||
        sigType === 'chong_day_branch_travel' ||
        sigType === 'chong_day_branch_health' ||
        sigType === 'spouse_palace_chong'
      ) {
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日触發 沖日支 — 配偶宮震動／流日波動` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
      // 紅鸞星 (year-relative) — daily_enhanced.py:208
      else if (sigType === 'honluan_triggered') {
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日触發 紅鸞星動 — 流日感情訊號（非命局婚緣定論）` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
      // 配偶星透干 — daily_enhanced.py:187
      else if (sigType === 'spouse_star_transparent') {
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日触發 配偶星透干 — 流日感情訊號` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
      // 七殺/正官 day - daily_enhanced.py:284/292/299
      else if (
        sigType === 'guan_sha_day' ||
        sigType === 'guan_sha_favorable' ||
        sigType === 'guan_sha_unfavorable'
      ) {
        const valenceCN =
          valence === 'beneficial' || sigType === 'guan_sha_favorable'
            ? '正官/七殺為用，今日宜接受新責任'
            : valence === 'harmful' || sigType === 'guan_sha_unfavorable'
              ? '正官/七殺為忌，今日宜避免衝突'
              : '官殺日，今日易遇權威/壓力';
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日触發 官殺流日 — ${valenceCN}` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
    }
  }

  // Phase 1.5.z — folk content block (吉色/吉數/吉食含忌食/吉時).
  // All 4 chart-level fields are 用神-keyed; 吉時 per-day. Emitted when engine
  // provides folkContent + at least one non-null field. AI prompt at prompts.ts:3940
  // permits chat to discuss these topics ONLY because this injector grounds them.
  const folkLines = renderFortuneFolkContentLines(daily);

  // Compose final block
  if (lines.length === 0 && folkLines.length === 0) return null;

  const out: string[] = [];
  if (lines.length > 0) {
    out.push(
      `📅 今日 ${dayGanZhi} 日触發的教義事件（必須以下列文字為主敘述，不可省略）：`,
      ...lines,
      `⚠️ 上述為流日 trigger，非命局定論。引用必須使用「今日宜/今日易於/今日傾向」軟觸發語氣。`,
    );
  }
  if (folkLines.length > 0) {
    if (out.length > 0) out.push('');
    out.push(
      `🎨 今日民俗內容（必須以下列文字為主敘述）：`,
      ...folkLines,
      `⚠️ 「民俗參考」前綴的欄位（吉數）不可與典籍級別混段落呈現。「今日忌食」必須引用 reason。飲食建議僅為命理參考，不取代醫療建議。`,
    );
  }
  return out.join('\n');
}

/** Render folk-content lines for chat-scope injection (Phase 1.5.z).
 *  Returns empty array when folkContent absent OR when all fields are null
 *  (chart with unresolved 用神 — auspiciousHours still emits since it's per-day).
 */
function renderFortuneFolkContentLines(daily: Record<string, unknown>): string[] {
  const folk = daily.folkContent as Record<string, unknown> | undefined;
  if (!folk) return [];

  const lines: string[] = [];

  const wealthDir = folk.wealthDirection as { element?: string; direction?: string; note?: string } | undefined;
  if (wealthDir?.direction) {
    lines.push(`• 用神方位 [典籍]：${wealthDir.element} → ${wealthDir.direction}（${wealthDir.note ?? ''}）`);
  }

  const color = folk.luckyColor as
    | { primary?: string; secondary?: string; tertiary?: string; cite?: string }
    | null | undefined;
  if (color?.primary) {
    lines.push(
      `• 吉色 [典籍]：${color.primary}（次選：${color.secondary ?? '—'}；典籍：${color.cite ?? '—'}）`,
    );
  }

  const number = folk.luckyNumber as { numbers?: number[]; cite?: string } | null | undefined;
  if (number?.numbers?.length) {
    lines.push(
      `• 吉數 [民俗]：${number.numbers.join('、')}（${number.cite ?? '—'}）` +
        ` — narrative 必須以「民俗參考」開頭引用`,
    );
  }

  const foodFav = folk.luckyFoodFavor as
    | { category?: string; examples?: string[]; cite?: string }
    | null | undefined;
  if (foodFav?.category) {
    lines.push(
      `• 今日宜食 [典籍]：${foodFav.category}（例：${(foodFav.examples ?? []).join('、')}；典籍：${foodFav.cite ?? '—'}）`,
    );
  }

  const foodAvoid = folk.luckyFoodAvoid as
    | { category?: string; reason?: string; cite_sources?: string[] }
    | null | undefined;
  if (foodAvoid?.category) {
    lines.push(
      `• 今日忌食 [典籍]：${foodAvoid.category}；原因：${foodAvoid.reason ?? '—'}` +
        `（典籍：${(foodAvoid.cite_sources ?? []).join('；')}）` +
        ` — narrative 必須引用 reason，不可僅列食物名稱`,
    );
  }

  const hours = folk.auspiciousHours as
    | Array<{ branch?: string; hour_range?: string; classical_name?: string }>
    | undefined;
  if (hours?.length) {
    const rendered = hours
      .map((h) => `${h.classical_name}時 ${h.branch}（${h.hour_range}）`)
      .join('、');
    lines.push(
      `• 今日吉時 [典籍]：${rendered}` +
        ` — 黃道吉時僅依日支推算，與月支無關（協紀辨方書 卷十）。narrative 提及 1-2 個與情境相關的時辰即可，不必全列`,
    );
  }

  return lines;
}
