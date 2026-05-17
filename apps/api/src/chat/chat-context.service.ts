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
  FORTUNE: 'v1.0.0',  // Phase Fortune — unified day/month/year chat (scope tag in ChatSession.fortuneScope)
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
   * still aggregates all 4 pipelines because the engine merges all of
   * them regardless of which reading-type chat is invoked from (Phase 1
   * Layer 1 fix). The cache key includes the readingType so a LOVE
   * session's cache entry doesn't get invalidated when only CAREER's
   * prompt version bumps.
   */
  computeVersionString(readingType: ReadingType = 'LIFETIME'): string {
    return [
      `${readingType.toLowerCase()}=${getChatPromptVersion(readingType)}`,
      // Pre-analysis hash stays aggregate — engine merges all 4 (or all 4 + compat for COMPATIBILITY).
      `pa-life=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LIFETIME}`,
      `pa-love=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LOVE}`,
      `pa-car=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.CAREER}`,
      `pa-ann=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.ANNUAL}`,
      `pa-compat=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.COMPATIBILITY}`,
    ].join('|');
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
    return {
      contextVersion: getChatPromptVersion(readingType),
      preAnalysisVersion: [
        `life=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LIFETIME}`,
        `love=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LOVE}`,
        `car=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.CAREER}`,
        `ann=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.ANNUAL}`,
        `compat=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.COMPATIBILITY}`,
      ].join('|'),
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
}
