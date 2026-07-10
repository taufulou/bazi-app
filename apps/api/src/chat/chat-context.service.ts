import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ReadingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
// Audit M#2 staff-engineer fix — snapshot staleness check must compare
// against the ENGINE-side version (what the snapshot was stamped with at
// persist time), NOT the chat-side `PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE`
// which is intentionally locked at the legacy value for C#1 byte-identity.
// These two constants are DECOUPLED post-C#1.
import { FORTUNE_PRE_ANALYSIS_VERSIONS } from '../ai/prompts';

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
  FORTUNE: 'v1.1.0',  // Phase 1.5.z — folk content (吉色/吉數/吉食含忌食/吉時) now reaches chat scope via interpolateFortuneV1Fields folk block (2026-05-22). UNCHANGED for Phase 2 month support — that's handled by CHAT_PROMPT_VERSIONS_BY_FORTUNE_SCOPE below.
};

/** Safe lookup with fallback to LIFETIME for unmapped reading types. */
export function getChatPromptVersion(readingType: ReadingType): string {
  return CHAT_PROMPT_VERSIONS[readingType] ?? CHAT_PROMPT_VERSIONS.LIFETIME ?? 'v1.0.0';
}

export type ChatPromptVersionKey = ReadingType;

/**
 * Phase 2 月運 — Separate per-fortune-scope chat prompt version map.
 *
 * Per plan v4 H-new-2 (type-soundness): we do NOT rename
 * `CHAT_PROMPT_VERSIONS.FORTUNE` because the parent map is typed
 * `Partial<Record<ReadingType, string>>`. Adding `FORTUNE_DAY`/`FORTUNE_MONTH`
 * as keys would require a Prisma `ReadingType` enum migration (cascading
 * risk + breaks ~18 reading-type references).
 *
 * Instead: a SEPARATE map keyed by `FortuneScope` ('DAY' | 'MONTH'). Sibling
 * helper `getChatPromptVersionForFortune(scope)` dispatches. Existing FORTUNE
 * chat sessions stored with `contextVersion='v1.1.0'` continue to match
 * `CHAT_PROMPT_VERSIONS_BY_FORTUNE_SCOPE.DAY` (semantic preservation —
 * no DB row backfill, no drift-eviction on this deploy).
 *
 * Reference: `/Users/roger/.claude/plans/ok-next-big-feature-merry-cake.md`
 * Phase 2 月運 section v4 + research-results doc.
 */
export const CHAT_PROMPT_VERSIONS_BY_FORTUNE_SCOPE: Record<
  'DAY' | 'MONTH' | 'YEAR',
  string
> = {
  DAY: 'v1.1.0',   // = existing CHAT_PROMPT_VERSIONS.FORTUNE value (semantic preservation)
  MONTH: 'v1.0.0', // NEW for Phase 2 月運 — first version
  YEAR: 'v1.1.0',  // Tier B2 — bumped (Y-3 pushback few-shot added to system prompt)
};

/** Sibling helper to `getChatPromptVersion` for FORTUNE chat sessions.
 *  Dispatches by `FortuneScope` discriminator. */
export function getChatPromptVersionForFortune(
  scope: 'DAY' | 'MONTH' | 'YEAR',
): string {
  return CHAT_PROMPT_VERSIONS_BY_FORTUNE_SCOPE[scope];
}

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
  // Phase Fortune chat — LEGACY DAY-scope chat-context version key. ONLY
  // appended to the version string when readingType === 'FORTUNE' (per-readingType
  // conditional in computeVersionString + getCurrentSnapshotVersions per plan
  // Issue 11 + NEW-A re-review). Adding this entry does NOT invalidate any
  // non-FORTUNE session because the conditional gate prevents it from joining
  // the version string for LIFETIME/LOVE/CAREER/ANNUAL/COMPAT sessions.
  //
  // **IMPORTANT — DECOUPLED FROM ENGINE VERSION** (audit C#1 lock):
  // The `FORTUNE` value here is NOT the engine version (engine is at
  // `FORTUNE_PRE_ANALYSIS_VERSIONS.day = 'v1.5.0'` per ../ai/prompts.ts). It's
  // decoupled so chat-context invalidation is controlled independently of the
  // engine. The engine output shape can evolve (folk content, etc.) without
  // breaking chat sessions because:
  //   1. The chat slim drops/aggregates fields the chat doesn't need.
  //   2. Snapshot-reuse staleness gate compares against ENGINE-side
  //      `FORTUNE_PRE_ANALYSIS_VERSIONS` separately (see
  //      `getChatContextForFortune` snapshot-lookup block).
  // To invalidate chat-context cache for FORTUNE DAY, bump THIS constant — but
  // be aware ALL existing DAY chat sessions will trip CONTEXT_VERSION_DRIFTED
  // and users must restart. MONTH scope uses its own `FORTUNE_MONTH` constant.
  //
  // v1.1.1 → v1.1.2 (PR #55): the chat slim now forwards `dayEnergyAlignment`
  // (a slim-SHAPE change) + the DAY injector emits new 今日整體氣場/驛馬/空亡
  // lines. Bumping here invalidates FORTUNE-DAY chat-context cache; the
  // deliberate consequence is that pre-existing DAY sessions drift (accepted —
  // the byte-identity-with-pre-L3.5b rationale is superseded by shipping the
  // baseline signals to chat). MONTH/YEAR/non-FORTUNE are byte-identical → no
  // mass eviction.
  FORTUNE: 'v1.1.2',       // DAY scope — used by `fort=` (snapshot) + `pa-fort=` (cache key)
  FORTUNE_MONTH: 'v1.0.0', // MONTH scope (Phase 2) — used by `fort-month=` + `pa-fort-month=`
  // YEAR scope (Phase 3.5c) — NEW key, no legacy collision (zero pre-existing
  // YEAR chat sessions). Value mirrors engine `FORTUNE_PRE_ANALYSIS_VERSIONS.year`
  // — no byte-identity lock needed. Used by `fort-year=` + `pa-fort-year=`.
  FORTUNE_YEAR: 'v1.1.0',
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
  /** 時辰未知 (Phase 2d) — false when the chat's birth profile has no known
   *  hour (3-pillar 年/月/日 chart). Emitted top-level by every engine
   *  build_chat_context* slim; gates the prompt-builder's 時辰未知 suppression
   *  directive (mirror of ai.service.ts `data['hourKnown'] === false`). */
  hourKnown?: boolean;
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
   *  `build_chat_context_fortune` shape (DAY branch). Carries the day pillar,
   *  today's auspiciousness label + energy score, 5-dim breakdown, headliner
   *  signals, folk content (wealth direction), plus Option 2.5 transparency
   *  fields used by the anti-incoherence prompt rule. The day-pillar
   *  TRANSIENT findings ride in `dailyFortune.dimensions[].signals[]` and
   *  are consumed by `interpolateFortuneV1Fields` below.
   *
   *  Note (Glossary lock per Phase 2.x): camelCase `dailyFortune` matches the
   *  Python engine emit convention at the chat-context boundary. NEVER confuse
   *  with the AI-output narrative key `daily_*` (snake_case, inside `narrative`).
   */
  dailyFortune?: Record<string, unknown>;
  /** Phase 2.x L3.5b — present only when this payload describes a FORTUNE
   *  MONTH chat scope. Mirrors the engine's `build_chat_context_fortune`
   *  shape (MONTH branch, slimmed via `_slim_monthly_for_chat`). Carries:
   *  monthGanZhi, monthTenGod, auspiciousness, energyScore, 4-dim breakdown
   *  (career/finance/romance/health — NO travel per Phase 2 doctrine), month-
   *  pillar findings (fuYinInteractions / liuHaiInteractions / chongKuRelease /
   *  officerSealActivation), and `intraMonthBreakdown` (per L1.b — sibling
   *  field with `{scheme_id, liuyue_window, buckets}` shape).
   *
   *  Consumed by `interpolateFortuneMonthlyFields` (the MONTH-scope deterministic
   *  injector, mirror of `interpolateFortuneV1Fields`). Folk content is OMITTED
   *  for MONTH scope per Phase 2 locked decision #6 (DAY-only differentiator).
   *
   *  Glossary lock: camelCase `monthlyFortune` (engine emit). The AI narrative
   *  uses snake_case `monthly_*` keys inside `narrative.monthly_*`. Never alias.
   */
  monthlyFortune?: Record<string, unknown>;
  /** Phase 3.5c L3.5c — present only when this payload describes a FORTUNE
   *  YEAR chat scope. Mirrors the engine's `build_chat_context_fortune` shape
   *  (YEAR branch, slimmed via `_slim_yearly_for_chat`). Carries: yearGanZhi,
   *  yearTenGod, auspiciousness, energyScore, 4-dim breakdown with ★ stars
   *  (career/finance/romance/health — NO travel; 感情=romance NOT 人際關係),
   *  and the SIBLING fields `coreRiskOpportunity` ({opportunities, risks,
   *  flatYear}) + `luckMethods` ({cards, weakestDim, disclaimer}).
   *
   *  Consumed by `interpolateFortuneYearlyFields` (the YEAR-scope deterministic
   *  injector, mirror of `interpolateFortuneMonthlyFields`). No folk content.
   *
   *  Glossary lock: camelCase `yearlyFortune` (engine emit). The AI narrative
   *  uses snake_case `yearly_*` keys inside `narrative.yearly_*`. Never alias.
   */
  yearlyFortune?: Record<string, unknown>;
  /** Phase Fortune — ISO `YYYY-MM-DD` anchor date the FORTUNE chat session
   *  is pinned to. Set by engine; mirrored from the
   *  `ChatSession.fortuneAnchorDate` column. For MONTH scope, normalized to
   *  the 1st of the month (YYYY-MM-01). */
  anchorDate?: string;
  /** Tier C — the birth profile this chat is about, surfaced POST-CACHE
   *  (mirrors `crossSellPivotHint` / `withCrossSellPivotHint` — set after the
   *  engine context is Redis-cached so it can NEVER go stale). Used by
   *  `resolveOwnedCrossSellTargets` to gate cross-sell ownership without an
   *  extra query. FORTUNE → session.profileId; LOVE/CAREER/ANNUAL → the
   *  reading's birthProfileId (already loaded); COMPATIBILITY → null (v1 no-op). */
  birthProfileId?: string | null;
}

export interface ChatContextCacheKey {
  birthHash: string;
  /** Combined version key — bump invalidates all cached chat contexts. */
  versions: string;
}

/**
 * Tier C — maps an owned `BaziReading.readingType` to the cross-sell target key
 * used in `CHAT_CROSS_SELL_LINES` / `CHAT_CROSS_SELL_OWNED_LINES`. Only the 4
 * single-profile reading types that appear as cross-sell targets are listed;
 * COMPATIBILITY + HEALTH + ZWDS_* are intentionally absent (never cross-sell
 * targets, or deferred to v1.1).
 */
export const READING_TYPE_TO_CROSSSELL_TARGET: Partial<Record<ReadingType, string>> = {
  LIFETIME: 'lifetime',
  LOVE: 'love',
  CAREER: 'career',
  ANNUAL: 'annual',
};

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
        return this.withCrossSellPivotHint(ctx, readingType, reading.birthProfileId);
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
      hourKnown: profile.hourKnown,
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

    return this.withCrossSellPivotHint(engineCtx, readingType, reading.birthProfileId);
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
        // Tier C — COMPATIBILITY ownership-gating deferred to v1.1 (partner-profile
        // semantics); birthProfileId = null → resolveOwnedCrossSellTargets no-ops.
        return this.withCrossSellPivotHint(ctx, readingType, null);
      } catch (err) {
        this.logger.warn(`Failed to parse cached compat chat-context for key ${cacheKey}: ${err}`);
      }
    }

    const engineCtx = await this.fetchChatContextFromEngineCompat({
      profileA: {
        birthDate: profileA.birthDate.toISOString().slice(0, 10),
        birthTime: profileA.birthTime,
        hourKnown: profileA.hourKnown,  // 時辰未知 (Phase 3b)
        birthCity: profileA.birthCity,
        birthTimezone: profileA.birthTimezone,
        gender: profileA.gender.toLowerCase(),
        birthLongitude: profileA.birthLongitude,
        birthLatitude: profileA.birthLatitude,
      },
      profileB: {
        birthDate: profileB.birthDate.toISOString().slice(0, 10),
        birthTime: profileB.birthTime,
        hourKnown: profileB.hourKnown,  // 時辰未知 (Phase 3b)
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

    return this.withCrossSellPivotHint(engineCtx, readingType, null);
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
    fortuneScope: 'DAY' | 'MONTH' | 'YEAR' = 'DAY',
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
    // Phase 2.x L3.5b — scope-aware version composition. Active-scope-only
    // emission per plan H-new-4: DAY chat keys on `pa-fort-day`, MONTH chat
    // keys on `pa-fort-month`. Bumping one scope's version does NOT invalidate
    // the other scope's cached chat-contexts.
    const versions =
      readingType === 'FORTUNE'
        ? this.computeVersionStringForFortune(fortuneScope)
        : this.computeVersionString(readingType);
    // Cache key includes scope discriminator so DAY + MONTH chat sessions
    // for the same chart on the same anchor never collide.
    const cacheKey = `chat-context-fortune:${birthHash}:${anchorDate}:${fortuneScope}:${versions}`;

    // Try Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const ctx = JSON.parse(cached) as ChatContext;
        return this.withCrossSellPivotHint(ctx, readingType, profileId);
      } catch (err) {
        this.logger.warn(
          `Failed to parse cached fortune chat-context for key ${cacheKey}: ${err}`,
        );
      }
    }

    // Reuse persisted snapshot when available (Issue 1 — skip recompute).
    // Scope dispatch: DAY → look up scope='DAY' row + pass as precomputed_daily;
    // MONTH → look up scope='MONTH' row + pass as precomputed_monthly.
    // For MONTH, the anchor date is normalized to 1st of month (matches fortune.service.ts).
    //
    // Audit M#2 (L3.5b line audit) — gate snapshot reuse on engine pre-analysis
    // version match. A stale snapshot (older preAnalysisVersion) may lack
    // fields the current chat slim expects: for MONTH, pre-v1.1.0 snapshots
    // lack `intraMonthBreakdown` (Phase 2.x L1.b wiring). Passing a stale
    // payload as `precomputed_monthly` would skip recompute → AI loses
    // bucket data silently. For DAY, pre-v1.2.0 snapshots lack `folkContent`
    // (Phase 1.5.z). When stale, null the precomputed_* slot so engine
    // recomputes from scratch.
    //
    // Staff-engineer audit fix (post-M#2): MUST compare against the ENGINE-side
    // `FORTUNE_PRE_ANALYSIS_VERSIONS` (what the snapshot was actually stamped
    // with at persist time by `fortune-snapshot.helpers.ts`), NOT the chat-side
    // `PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE` (started 'v1.1.1' for C#1
    // byte-identity, now 'v1.1.2' per PR #55). These two constants serve different purposes
    // and were decoupled post-C#1 — comparing against the wrong one would
    // flag EVERY fresh snapshot as stale → defeats Issue-1 reuse optimization
    // → ~200-300ms cold-recompute on every chat session (correctness OK,
    // performance regression).
    let precomputedDaily: Record<string, unknown> | undefined;
    let precomputedMonthly: Record<string, unknown> | undefined;
    let precomputedYearly: Record<string, unknown> | undefined;
    // Anchor normalization: MONTH → 1st of month, YEAR → 1st of year (Jan 1),
    // DAY → exact date. Matches how fortune.service persists each scope's
    // DailyFortuneSnapshot.anchorDate.
    const snapshotAnchor =
      fortuneScope === 'MONTH'
        ? new Date(`${anchorDate.slice(0, 7)}-01T00:00:00.000Z`)
        : fortuneScope === 'YEAR'
          ? new Date(`${anchorDate.slice(0, 4)}-01-01T00:00:00.000Z`)
          : new Date(`${anchorDate}T00:00:00.000Z`);
    // Stale-check compares against ENGINE-side FORTUNE_PRE_ANALYSIS_VERSIONS
    // (what the snapshot was stamped with at persist), 3-way per scope. YEAR
    // pre-v1.1.0 snapshots would lack Phase-3 fields → recompute.
    const requiredPreAnalysisVersion =
      fortuneScope === 'MONTH'
        ? FORTUNE_PRE_ANALYSIS_VERSIONS.month
        : fortuneScope === 'YEAR'
          ? FORTUNE_PRE_ANALYSIS_VERSIONS.year
          : FORTUNE_PRE_ANALYSIS_VERSIONS.day;
    try {
      const snapshot = await this.prisma.dailyFortuneSnapshot.findFirst({
        where: {
          birthProfileId: profileId,
          scope: fortuneScope,
          anchorDate: snapshotAnchor,
        },
        orderBy: { generatedAt: 'desc' },
      });
      if (snapshot?.engineOutputJson) {
        // Stale-check: only reuse when the snapshot's pre-analysis version
        // matches the chat slim's required version. Mismatch → null out so
        // engine recomputes (cold-path 200-300ms vs serving stale data).
        const snapshotVersion = snapshot.preAnalysisVersion ?? '';
        if (snapshotVersion === requiredPreAnalysisVersion) {
          if (fortuneScope === 'MONTH') {
            precomputedMonthly = snapshot.engineOutputJson as Record<string, unknown>;
          } else if (fortuneScope === 'YEAR') {
            precomputedYearly = snapshot.engineOutputJson as Record<string, unknown>;
          } else {
            precomputedDaily = snapshot.engineOutputJson as Record<string, unknown>;
          }
        } else {
          this.logger.debug(
            `Stale FortuneSnapshot (${fortuneScope}) for (${profileId}, ${anchorDate}): ` +
              `snapshot=${snapshotVersion}, required=${requiredPreAnalysisVersion} — forcing engine recompute`,
          );
        }
      }
    } catch (err) {
      // Non-fatal — fall back to engine recompute path
      this.logger.warn(
        `Failed to fetch FortuneSnapshot (${fortuneScope}) for (${profileId}, ${anchorDate}): ${err}`,
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
      hourKnown: profile.hourKnown,
      anchorDate,
      targetYear: anchorYear,
      targetMonth: anchorMonth,
      precomputedDaily,
      precomputedMonthly,
      precomputedYearly,
      fortuneScope,
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

    return this.withCrossSellPivotHint(engineCtx, readingType, profileId);
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
    /** Tier C — birth profile this chat is about, surfaced POST-CACHE here so
     *  it never lands in the Redis-cached engine blob. Used by
     *  `resolveOwnedCrossSellTargets` to gate cross-sell ownership query-free.
     *  null for COMPATIBILITY (v1 no-op). */
    birthProfileId?: string | null,
  ): ChatContext {
    return {
      ...ctx,
      crossSellPivotHint: this.extractCrossSellPivotHint(ctx, readingType),
      birthProfileId: birthProfileId ?? null,
    };
  }

  /**
   * Tier C — resolve the set of cross-sell target keys the user ALREADY owns
   * for the relevant birth profile, so the prompt builder can reword
   * "go unlock X" → "you already have X, go view it".
   *
   * Computed FRESH per message (NOT cached — ownership changes on unlock and
   * must not be stale). `birthProfileId` comes from `ChatContext.birthProfileId`
   * (surfaced post-cache by `withCrossSellPivotHint`) → no extra profile lookup.
   * Returns a Set of target keys ('lifetime' | 'love' | 'career' | 'annual').
   * Never throws meaningfully (caller still wraps in try/catch defensively).
   *
   * - ANNUAL is YEAR-SCOPED against `anchorYear`: a 2024 annual reading does NOT
   *   count as owning this year's 流年運勢 (the cross-sell pitch is about THIS year).
   *   Other targets are year-agnostic.
   * - COMPATIBILITY → empty set (v1.1 deferral; partner-profile semantics).
   * - Missing birthProfileId → empty set (cross-sell falls back to "go unlock").
   */
  async resolveOwnedCrossSellTargets(args: {
    userId: string;
    readingType: ReadingType;
    birthProfileId?: string | null;
    anchorYear: number;
  }): Promise<Set<string>> {
    const { userId, readingType, birthProfileId, anchorYear } = args;
    const owned = new Set<string>();
    if (readingType === 'COMPATIBILITY') return owned; // v1.1 deferral
    if (!birthProfileId) return owned;

    // Year-agnostic targets (lifetime/love/career) + year-scoped ANNUAL, in
    // parallel. Both birthProfileId-indexed (~1ms each).
    const [yearAgnostic, annualThisYear] = await Promise.all([
      this.prisma.baziReading.findMany({
        where: {
          userId,
          birthProfileId,
          readingType: { in: ['LIFETIME', 'LOVE', 'CAREER'] },
        },
        select: { readingType: true },
        distinct: ['readingType'],
      }),
      this.prisma.baziReading.findFirst({
        where: { userId, birthProfileId, readingType: 'ANNUAL', targetYear: anchorYear },
        select: { id: true },
      }),
    ]);

    for (const row of yearAgnostic) {
      const target = READING_TYPE_TO_CROSSSELL_TARGET[row.readingType];
      if (target) owned.add(target);
    }
    if (annualThisYear) owned.add('annual');
    return owned;
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
   * FORTUNE pivot — scope-aware. For DAY chat: prefers the day's pre-rendered
   * headliner signal narrative (rich Chinese sentence from
   * `daily_enhanced._compute_headliner_signals`), e.g. «今日紅鸞動，子卯刑配偶宮».
   * Falls back to `{dayGanZhi}日（{auspiciousness}，{energyScore}分）` when
   * no headliner narrative is present.
   *
   * Phase 2.x L3.5b post-audit (staff-engineer LOW #1) — for MONTH chat:
   * reads `monthlyFortune.monthGanZhi` + `monthLabel` + `auspiciousness` +
   * `energyScore` and formats as «{monthGanZhi}月（{auspiciousness}，{energyScore}分）».
   * Pre-fix the MONTH branch returned null → refuse template's
   * «...回到本月解讀：{crossSellPivotHint}» pivot clause was stripped to a
   * generic «您還有其他想了解的嗎?», losing the personalized hook.
   *
   * Used in FORTUNE refuse templates' pivot clause to keep the refused
   * conversation grounded (the load-bearing F-2 «cite-today-first» pattern
   * for DAY; M-2 «cite-this-month-first» for MONTH).
   */
  private extractFortunePivotHint(ctx: ChatContext): string | null {
    // YEAR branch first — if yearlyFortune present (scope-aware dispatch by
    // presence; Phase 3.5c L3.5c). Formats «{yearGanZhi}年（{auspiciousness}，
    // {energyScore}分）» for the refuse template's «回到您今年的年運解讀»。
    const yearly = ctx.yearlyFortune as Record<string, unknown> | undefined;
    if (yearly) {
      const yearGanZhi = yearly.yearGanZhi as string | undefined;
      const auspiciousness = yearly.auspiciousness as string | undefined;
      const energyScore = yearly.energyScore as number | undefined;
      const base = yearGanZhi ? `${yearGanZhi}年` : null;
      if (base && auspiciousness && typeof energyScore === 'number') {
        return `${base}（${auspiciousness}，${energyScore}分）`;
      }
      if (base) {
        return base;
      }
      // yearly present but core fields missing → fall through (defensive).
    }

    // MONTH branch — if monthlyFortune present (scope-aware dispatch
    // by presence — MONTH session ctx has monthlyFortune, DAY ctx has dailyFortune).
    const monthly = ctx.monthlyFortune as Record<string, unknown> | undefined;
    if (monthly) {
      const monthGanZhi = monthly.monthGanZhi as string | undefined;
      const monthLabel = monthly.monthLabel as string | undefined;
      const auspiciousness = monthly.auspiciousness as string | undefined;
      const energyScore = monthly.energyScore as number | undefined;
      // Prefer monthLabel («2026年5月») when available; fall back to monthGanZhi («癸巳月»).
      const base = monthLabel || (monthGanZhi ? `${monthGanZhi}月` : null);
      if (base && auspiciousness && typeof energyScore === 'number') {
        return `${base}（${auspiciousness}，${energyScore}分）`;
      }
      if (base) {
        return base;
      }
      // monthly present but core fields missing → fall through to DAY branch below
      // (defensive — shouldn't happen if monthly snapshot is valid)
    }

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
      // Legacy DAY-scope path (no fortuneScope arg). FORTUNE-scope-aware
      // call-sites should use computeVersionStringForFortune below.
      parts.push(`pa-fort=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE}`);
    }
    return parts.join('|');
  }

  /**
   * Phase 2 月運 — sibling helper to `computeVersionString` for FORTUNE
   * sessions. Emits ACTIVE-SCOPE-ONLY per plan v4 H-new-4:
   * - DAY scope: emits `pa-fort=<FORTUNE>` only (NO pa-fort-month).
   *              ↑ Uses LEGACY `pa-fort=` key + LEGACY `FORTUNE` constant
   *              for FULL byte-identity with pre-L3.5b sessions (audit
   *              fix C#1). Without this, every existing DAY chat session
   *              stored as `pa-fort=v1.1.1` would mismatch a new format
   *              and trip CONTEXT_VERSION_DRIFTED on first message
   *              post-deploy. Future DAY-scope bumps: just update the
   *              `FORTUNE` constant — the KEY stays `pa-fort=` forever.
   * - MONTH scope: emits `pa-fort-month=<FORTUNE_MONTH>` only (NO pa-fort).
   *               No legacy collision — no MONTH sessions existed
   *               pre-L3.5b.
   *
   * Zero cross-scope blast: bumping MONTH version does NOT invalidate
   * cached DAY chat-contexts (and vice versa). Locked by regression spec
   * `chat-context.service.fortune.spec.ts` — bumping either scope's
   * version does NOT alter the other scope's version string.
   *
   * The base composition uses prompt-version for FORTUNE via the new
   * `CHAT_PROMPT_VERSIONS_BY_FORTUNE_SCOPE` map.
   */
  computeVersionStringForFortune(scope: 'DAY' | 'MONTH' | 'YEAR'): string {
    const parts: string[] = [
      `fortune=${getChatPromptVersionForFortune(scope)}`,
      `pa-life=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LIFETIME}`,
      `pa-love=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LOVE}`,
      `pa-car=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.CAREER}`,
      `pa-ann=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.ANNUAL}`,
      `pa-compat=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.COMPATIBILITY}`,
    ];
    // Active-scope-only emission per plan v4 H-new-4.
    // Audit C#1: DAY uses LEGACY `pa-fort=` key + LEGACY `FORTUNE` constant
    // value for byte-identity with pre-L3.5b cache keys; MONTH uses NEW
    // `pa-fort-month=` key; YEAR uses NEW `pa-fort-year=` key (no legacy
    // sessions for either MONTH or YEAR).
    if (scope === 'DAY') {
      parts.push(`pa-fort=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE}`);
    } else if (scope === 'MONTH') {
      parts.push(`pa-fort-month=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE_MONTH}`);
    } else if (scope === 'YEAR') {
      parts.push(`pa-fort-year=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE_YEAR}`);
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
    //
    // Phase 2 月運 NOTE: FORTUNE chat sessions should use the sibling helper
    // `getCurrentSnapshotVersionsForFortune(scope)` below for active-scope-only
    // emission. The legacy path here still emits `fort=` for back-compat.
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

  /**
   * Phase 2 月運 — sibling to `getCurrentSnapshotVersions` for FORTUNE
   * chat sessions. Dispatches by `FortuneScope` discriminator. Per plan v4
   * H-new-3: sibling helper instead of overloading the original (cleaner
   * than optional-arg-with-runtime-check).
   *
   * Returns the same shape `{contextVersion, preAnalysisVersion}` so
   * call-sites just pick the right helper based on session.readingType.
   *
   * Per plan v4 H-new-4: emit ACTIVE-SCOPE-ONLY pa-fort-day OR
   * pa-fort-month (not both) — bumping one scope's pre-analysis version
   * does not invalidate the other scope's cached chat-contexts.
   */
  getCurrentSnapshotVersionsForFortune(scope: 'DAY' | 'MONTH' | 'YEAR'): {
    contextVersion: string;
    preAnalysisVersion: string;
  } {
    const paParts: string[] = [
      `life=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LIFETIME}`,
      `love=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.LOVE}`,
      `car=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.CAREER}`,
      `ann=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.ANNUAL}`,
      `compat=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.COMPATIBILITY}`,
    ];
    // Active-scope-only emission per plan v4 H-new-4.
    // Audit C#1: DAY uses LEGACY `fort=` key + LEGACY `FORTUNE` constant
    // value (NOT `fort-day=v1.2.0`) — byte-identity with pre-L3.5b sessions.
    // Without this, EVERY existing DAY chat session would trip
    // CONTEXT_VERSION_DRIFTED on first message post-deploy because their
    // stored `preAnalysisVersion` ends with `|fort=v1.1.1` but the new
    // format would have emitted `|fort-day=v1.2.0`. MONTH uses new
    // `fort-month=` key; YEAR uses new `fort-year=` key (no legacy concern
    // for either).
    if (scope === 'DAY') {
      paParts.push(`fort=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE}`);
    } else if (scope === 'MONTH') {
      paParts.push(`fort-month=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE_MONTH}`);
    } else if (scope === 'YEAR') {
      paParts.push(`fort-year=${PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE_YEAR}`);
    }
    return {
      contextVersion: getChatPromptVersionForFortune(scope),
      preAnalysisVersion: paParts.join('|'),
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private computeBirthHash(
    profile: {
      birthDate: Date;
      // 時辰未知: birthTime is now nullable (BirthProfile.birthTime).
      birthTime: string | null;
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
      // 時辰未知: 'HOUR_UNKNOWN' sentinel so an unknown hour hashes to a
      // distinct, non-colliding cache key vs a known hour.
      profile.birthTime ?? 'HOUR_UNKNOWN',
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
    // 時辰未知: nullable; engine accepts null birth_time (no default invented).
    birthTime: string | null;
    birthCity: string;
    birthTimezone: string;
    gender: string;
    birthLongitude: number | null;
    birthLatitude: number | null;
    hourKnown: boolean;
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
        hour_known: args.hourKnown,
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
      // 時辰未知: nullable; engine accepts null birth_time (no default invented).
      birthTime: string | null;
      hourKnown: boolean;  // 時辰未知 (Phase 3b): per-party 3-pillar signal
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    };
    profileB: {
      birthDate: string;
      // 時辰未知: nullable; engine accepts null birth_time (no default invented).
      birthTime: string | null;
      hourKnown: boolean;  // 時辰未知 (Phase 3b): per-party 3-pillar signal
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
      hour_known: p.hourKnown,  // 時辰未知 (Phase 3b)
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
    // 時辰未知: nullable; engine accepts null birth_time (no default invented).
    birthTime: string | null;
    birthCity: string;
    birthTimezone: string;
    gender: string;
    birthLongitude: number | null;
    birthLatitude: number | null;
    hourKnown: boolean;
    anchorDate: string;
    targetYear: number;
    targetMonth: number;
    precomputedDaily?: Record<string, unknown>;
    /** Phase 2.x L3.5b — optional MONTH snapshot for Issue-1 reuse path. */
    precomputedMonthly?: Record<string, unknown>;
    /** Phase 3.5c L3.5c — optional YEAR snapshot for Issue-1 reuse path. */
    precomputedYearly?: Record<string, unknown>;
    /** 'DAY' (default, back-compat), 'MONTH' (Phase 2.x), or 'YEAR' (Phase 3.5c). */
    fortuneScope?: 'DAY' | 'MONTH' | 'YEAR';
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
          hour_known: args.hourKnown,
          anchor_date: args.anchorDate,
          target_year: args.targetYear,
          target_month: args.targetMonth,
          precomputed_daily: args.precomputedDaily ?? null,
          precomputed_monthly: args.precomputedMonthly ?? null,
          precomputed_yearly: args.precomputedYearly ?? null,
          fortune_scope: args.fortuneScope ?? 'DAY',
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
 * pattern at `ai.service.ts:3712::interpolateLoveV2Fields`: the engine emits
 * structured signal types (e.g., `shangguan_jian_guan_transient`,
 * `bijie_duo_cai_*`, `chong_day_branch_*`, `honluan_triggered`); the
 * interpolator pre-formats Chinese sentences for the AI to consume verbatim
 * — anti-hallucination via deterministic phrasing.
 *
 * Returns null only when there is no daily payload (no `dailyFortune` /
 * `dayGanZhi` / `dimensions`). NOTE (PR #55): a real DAY context now essentially
 * always yields a non-null block, because the engine emits `dayEnergyAlignment`
 * on every real DAY output (even the neutral case, shift 0). The prior "null
 * when no transient findings" behavior only survives for synthetic contexts that
 * omit `dayEnergyAlignment` entirely.
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
      // PR #55 — domain_affinity (per-dim 藏干 ten-god latent tilt, all 5 dims)
      else if (sigType === 'domain_affinity') {
        const tiltCN =
          valence === 'beneficial'
            ? '氣機偏順'
            : valence === 'harmful'
              ? '宜多加留意'
              : '平和';
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日 藏干十神傾向 — ${tiltCN}` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
      // PR #55 — 驛馬 nuance (逢沖=馬後加鞭 / 逢合=掣足) + pre-existing plain 驛馬
      else if (
        sigType === 'yima_chong_day' ||
        sigType === 'yima_chong_intensified' ||
        sigType === 'yima_he_blocked' ||
        sigType === 'yima_aligned'
      ) {
        const yimaCN =
          valence === 'beneficial'
            ? '動能強、遠行順遂'
            : valence === 'harmful'
              ? '動盪／掣足，遠行宜審慎'
              : '主變動';
        lines.push(
          `• [${dimLabel}] 今日 ${dayGanZhi} 日触發 驛馬流日 — ${yimaCN}` +
            (sigNarrative ? `；${sigNarrative}` : ''),
        );
      }
    }
  }

  // PR #55 — global 用神-alignment shift (dayEnergyAlignment) + nested 合化/空亡.
  // NOTE: the engine emits this on ~EVERY real DAY output (even the neutral case,
  // shift 0), so once this pushes into `lines` the injector effectively always
  // returns non-null for a real DAY ctx (see docstring). Mirrors the reading-page
  // {{dayEnergyAlignment}} render for chat/reading consistency.
  const dea = daily.dayEnergyAlignment as Record<string, unknown> | undefined;
  if (dea && typeof dea.narrative === 'string') {
    const deaValence = (dea.valence as string | undefined) ?? 'neutral';
    // Mirror the reading-page {{dayEnergyAlignment}} render EXACTLY
    // (fortune-prompt-builder.ts:215-216 — `${narrative}（傾向=${valence}）`) so
    // chat + reading ground on identical text (plan §2b consistency goal).
    lines.push(`• 今日整體氣場（用神對位）：${dea.narrative}（傾向=${deaValence}）`);
    const hehua = dea.hehua as Record<string, unknown> | undefined;
    if (hehua && typeof hehua.narrative === 'string') {
      lines.push(`• 今日天干五合：${hehua.narrative}`);
    }
    const kongWang = dea.kongWang as Record<string, unknown> | undefined;
    if (kongWang && typeof kongWang.narrative === 'string') {
      lines.push(`• 今日空亡：${kongWang.narrative}`);
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

// ============================================================
// Phase 2.x L3.5b — MONTH-scope deterministic injector
// ============================================================
// Mirror of `interpolateFortuneV1Fields` (DAY scope) scaled to MONTH semantics.
// Reads `ctx.monthlyFortune` (camelCase sibling per glossary — Python engine
// emits this; DO NOT confuse with AI narrative key `monthly_*` snake_case).
//
// Surfaces:
//   1. month-pillar findings: officerSealActivation (Phase 12c Fix C),
//      fuYinInteractions (Phase 12b Fix B), liuHaiInteractions (Phase 12c
//      Fix E), chongKuRelease (Phase 12c Fix F).
//   2. per-dim signal strings from `dimensions[].signals[]` (4 dims:
//      career / finance / romance / health — NO travel per Phase 2 doctrine).
//   3. intraMonthBreakdown buckets (L1.b — 上半月 stem-governed vs 下半月
//      branch-governed) so AI can answer «本月上半月vs下半月差異?» with the
//      structured per-bucket day counts + dominant 神煞 + peak signals.
//
// Audit C#2 — load-bearing per Phase 12g.6 Gap 2 pattern. Without this,
// MONTH chat got raw JSON only — anti-hallucination contract relied on AI
// luck. Browser test passed because Roger 癸巳月 anchor produced clear
// signals; charts with subtle month-pillar dynamics would silently drift.
export function interpolateFortuneMonthlyFields(ctx: ChatContext): string | null {
  const monthly = ctx.monthlyFortune as Record<string, unknown> | undefined;
  if (!monthly) return null;

  const monthGanZhi = monthly.monthGanZhi as string | undefined;
  if (!monthGanZhi) return null;

  const lines: string[] = [];

  // 1. Month-pillar findings (top-level structured signals from Phase 12b/12c)

  // Fix C — 殺印相生 / 官印相生 transient (officer-seal activation)
  const osa = monthly.officerSealActivation as
    | { pattern?: string; level?: string; direction?: string; seal_source?: string }
    | undefined;
  if (osa?.pattern) {
    const patternCN = osa.pattern === 'sha_yin' ? '殺印相生' : '官印相生';
    const levelCN = osa.level === 'full' ? '全功（本氣印）' : '半功（中氣印）';
    const directionCN =
      osa.direction === 'positive'
        ? '為吉（身弱逢印化煞）'
        : osa.direction === 'reverse'
          ? '為凶（身強逢之反為累）'
          : '中性';
    lines.push(
      `• [月柱] 本月 ${monthGanZhi}月触發 ${patternCN}（Phase 12c Fix C）— ${levelCN}；性質判定：${directionCN}`,
    );
  }

  // Fix B — 多柱伏吟 role-conditional (multi-pillar fu-yin amplification)
  const fyiRaw = monthly.fuYinInteractions as
    | Array<{ pillar?: string; role?: string; direction?: string; weight?: number; applied?: boolean }>
    | undefined;
  if (Array.isArray(fyiRaw) && fyiRaw.length > 0) {
    for (const fy of fyiRaw) {
      const pillar = fy.pillar ?? '?';
      const role = fy.role ?? '?';
      const direction = fy.direction ?? '?';
      const weight = typeof fy.weight === 'number' ? fy.weight : 0;
      const applied = fy.applied === true;
      const directionCN =
        direction === 'upgrade'
          ? '本月吉星伏吟，福上加福'
          : direction === 'downgrade'
            ? '本月忌星伏吟，禍上加禍'
            : '中性';
      const appliedTag = applied ? '（已生效）' : `（重量 ${weight}，未達生效門檻，僅敘述）`;
      lines.push(
        `• [月柱] 本月 ${monthGanZhi}月触發 伏吟 — ${pillar}柱（角色：${role}）— ${directionCN}${appliedTag}`,
      );
    }
  }

  // Fix E — 六害 role-aware penalty + 子卯刑 piggyback
  const lhiRaw = monthly.liuHaiInteractions as
    | Array<{
        pair?: string;
        kind?: string;
        pillar?: string;
        role?: string;
        effectiveScore?: number;
        applied?: boolean;
      }>
    | undefined;
  if (Array.isArray(lhiRaw) && lhiRaw.length > 0) {
    for (const lh of lhiRaw) {
      const pair = lh.pair ?? '?';
      const kind = lh.kind ?? '?';
      const kindCN = kind === 'liuxing_ziwei' ? '子卯無禮之刑（piggyback 害）' : '六害（暗箭友凶）';
      const pillar = lh.pillar ?? '?';
      const role = lh.role ?? '?';
      const score = typeof lh.effectiveScore === 'number' ? lh.effectiveScore : 0;
      const applied = lh.applied === true;
      const appliedTag = applied
        ? `（已生效：score=${score}，本月降一階）`
        : `（score=${score}，未達 -1 步門檻，僅敘述）`;
      lines.push(
        `• [月柱] 本月 ${monthGanZhi}月触發 ${kindCN} — ${pair}（${pillar}柱角色：${role}）${appliedTag}`,
      );
    }
  }

  // Fix F — 沖庫釋放方向性 (downgrade-only v1)
  const cku = monthly.chongKuRelease as
    | {
        natalPillar?: string;
        natalBranch?: string;
        releasedStems?: Array<{ stem?: string; position?: string; tenGod?: string; role?: string }>;
        netRoleScore?: number;
        action?: string;
        steps?: number;
      }
    | undefined;
  if (cku?.action === 'downgrade') {
    const natalPillar = cku.natalPillar ?? '?';
    const natalBranch = cku.natalBranch ?? '?';
    const net = typeof cku.netRoleScore === 'number' ? cku.netRoleScore : 0;
    // 釋放天干 — render each as "stem(tenGod, role)"
    const releasedCN = Array.isArray(cku.releasedStems)
      ? cku.releasedStems
          .map((r) => `${r.stem ?? '?'}(${r.tenGod ?? '?'}, ${r.role ?? '?'})`)
          .join('、')
      : '（無資料）';
    lines.push(
      `• [月柱] 本月 ${monthGanZhi}月触發 沖庫釋放 — ${natalPillar}柱${natalBranch}庫遭沖；` +
        `釋放天干：${releasedCN}；net=${net}，本月降一階（doctrine：天干不可救應庫沖）`,
    );
  }

  // 2. Per-dim signals (4 dims, plain string arrays)
  const dims = monthly.dimensions as Record<string, unknown> | undefined;
  const DIM_LABELS_MONTH: Record<string, string> = {
    career: '事業',
    finance: '財運',
    romance: '感情',
    health: '健康',
  };
  if (dims && typeof dims === 'object') {
    for (const [dimKey, dimLabel] of Object.entries(DIM_LABELS_MONTH)) {
      const dim = dims[dimKey] as Record<string, unknown> | undefined;
      if (!dim) continue;
      const signals = (dim.signals ?? []) as unknown[];
      if (!Array.isArray(signals) || signals.length === 0) continue;
      for (const sig of signals) {
        // Monthly signals are plain strings (NOT typed objects like daily).
        if (typeof sig === 'string' && sig.length > 0) {
          lines.push(`• [${dimLabel}] 本月 ${monthGanZhi}月：${sig}`);
        }
      }
    }
  }

  // 3. intraMonthBreakdown buckets (L1.b)
  // Renders 上半月/下半月 day counts + dominant 神煞 + peak signals so AI can
  // ground answers about within-month dynamics.
  const breakdownLines = renderIntraMonthBreakdownLines(monthly, monthGanZhi);

  // Compose final block
  if (lines.length === 0 && breakdownLines.length === 0) return null;

  const out: string[] = [];
  if (lines.length > 0) {
    out.push(
      `📅 本月 ${monthGanZhi}月触發的教義事件（必須以下列文字為主敘述，不可省略）：`,
      ...lines,
      `⚠️ 上述為流月 trigger，非命局定論。引用必須使用「本月宜/本月易於/本月趨向」軟觸發語氣。` +
        ` 用神/喜神/忌神 為命格層級判定，不可在流月層級重新指派。`,
    );
  }
  if (breakdownLines.length > 0) {
    if (out.length > 0) out.push('');
    out.push(
      `📅 本月內時段分析（必須以下列文字為主敘述）：`,
      ...breakdownLines,
      `⚠️ intraMonthBreakdown 訊號來自 L1.b 流日聚合，引用時段（上半月/下半月）僅可基於下列 day_range / governing_pillar / peak_signals 結構化資料；禁止虛構特定日期。`,
    );
  }
  return out.join('\n');
}

/** Render intraMonthBreakdown bucket lines for MONTH chat injection.
 *  Empty array when L1.b breakdown absent or buckets empty. */
function renderIntraMonthBreakdownLines(
  monthly: Record<string, unknown>,
  monthGanZhi: string,
): string[] {
  const breakdown = monthly.intraMonthBreakdown as
    | {
        scheme_id?: string;
        liuyue_window?: { start?: string; end?: string; days?: number };
        buckets?: Array<{
          label?: string;
          day_range?: [number, number];
          governing_pillar?: string;
          auspicious_days?: number;
          challenging_days?: number;
          neutral_days?: number;
          peak_signals?: Array<{ date?: string; type?: string; valence?: string; narrative?: string }>;
          dominant_shensha?: string[];
        }>;
      }
    | undefined;
  if (!breakdown?.buckets || breakdown.buckets.length === 0) return [];

  const lines: string[] = [];
  const window = breakdown.liuyue_window;
  if (window?.start && window?.end) {
    lines.push(
      `• 流月窗口：${window.start} → ${window.end}（${window.days ?? '?'} 天，${monthGanZhi}月）`,
    );
  }
  for (const bucket of breakdown.buckets) {
    const label = bucket.label ?? '?';
    const range = bucket.day_range
      ? `${bucket.day_range[0]}-${bucket.day_range[1]} 日`
      : '?';
    // Governing pillar: 'stem' → 流月天干主導；'branch' → 流月地支主導
    const govCN =
      bucket.governing_pillar === 'stem'
        ? '流月天干主導（主動氣先出）'
        : bucket.governing_pillar === 'branch'
          ? '流月地支主導（靜氣後沉）'
          : '?';
    const aDays = bucket.auspicious_days ?? 0;
    const cDays = bucket.challenging_days ?? 0;
    const nDays = bucket.neutral_days ?? 0;
    const dominantShensha = (bucket.dominant_shensha ?? []).join('、') || '—';
    lines.push(
      `• ${label}（${range}，${govCN}）— 吉日 ${aDays} 天 / 挑戰日 ${cDays} 天 / 中性日 ${nDays} 天；主要神煞：${dominantShensha}`,
    );
    const peaks = bucket.peak_signals ?? [];
    if (Array.isArray(peaks) && peaks.length > 0) {
      const peakLines = peaks
        .slice(0, 3)
        .map(
          (p) =>
            `  - 峰值：${p.date ?? '?'}（${p.type ?? '?'}，${p.valence ?? '?'}）` +
            (p.narrative ? `：${p.narrative}` : ''),
        );
      lines.push(...peakLines);
    }
  }
  return lines;
}

// ============================================================
// Phase 3.5c L3.5c — YEAR-scope deterministic injector
// ============================================================
// Mirror of `interpolateFortuneMonthlyFields` (MONTH scope) scaled to YEAR
// semantics. Reads `ctx.yearlyFortune` (camelCase sibling per glossary — the
// Python engine emits this; DO NOT confuse with AI narrative key `yearly_*`
// snake_case).
//
// Surfaces (so the chat AI quotes verbatim — anti-hallucination):
//   1. flowYear 干支 + overall 吉凶 + energy score.
//   2. 4-dim ★ trends (career/finance/romance/health — NO travel;
//      感情=romance NOT 人際關係) — score / label / stars.
//   3. coreRiskOpportunity — the named 機會 + 風險 months with dim attribution.
//      LOAD-BEARING: the AI must cite these exact months for «今年哪幾個月最值得
//      把握?» — without the injector it would fabricate months.
//   4. luckMethods (改運建議) cards — titles + 用神 flavor.
//
// Mirrors Phase 12g.6 Gap 2 deterministic-injection pattern. Returns null when
// `yearlyFortune` absent.
export function interpolateFortuneYearlyFields(ctx: ChatContext): string | null {
  const yearly = ctx.yearlyFortune as Record<string, unknown> | undefined;
  if (!yearly) return null;

  const yearGanZhi = yearly.yearGanZhi as string | undefined;
  if (!yearGanZhi) return null;

  const lines: string[] = [];

  // 1. Year-level overview
  const yearTenGod = yearly.yearTenGod as string | undefined;
  const auspiciousness = yearly.auspiciousness as string | undefined;
  const energyScore = yearly.energyScore as number | undefined;
  lines.push(
    `• [流年] 今年 ${yearGanZhi}年（${yearTenGod ?? '?'}）— 整體 ${auspiciousness ?? '?'}` +
      (typeof energyScore === 'number' ? `（能量指數 ${energyScore}）` : ''),
  );

  // 2. 4-dim ★ trends
  const dims = yearly.dimensions as Record<string, unknown> | undefined;
  const DIM_LABELS_YEAR: Record<string, string> = {
    career: '事業',
    finance: '財運',
    romance: '感情',
    health: '健康',
  };
  if (dims && typeof dims === 'object') {
    for (const [dimKey, dimLabel] of Object.entries(DIM_LABELS_YEAR)) {
      const dim = dims[dimKey] as Record<string, unknown> | undefined;
      if (!dim) continue;
      const stars = typeof dim.stars === 'number' ? dim.stars : undefined;
      const starStr =
        typeof stars === 'number'
          ? '★'.repeat(stars) + '☆'.repeat(Math.max(0, 5 - stars))
          : '';
      const label = (dim.labelZh as string | undefined) ?? dimLabel;
      const verdict = (dim.label as string | undefined) ?? '';
      lines.push(`• [${label}] ${starStr}${verdict ? `（${verdict}）` : ''}`);
    }
  }

  // 3. coreRiskOpportunity — named 機會 + 風險 months (LOAD-BEARING).
  const cro = yearly.coreRiskOpportunity as
    | {
        opportunities?: Array<{ monthLabel?: string; dimZh?: string; auspiciousness?: string }>;
        risks?: Array<{ monthLabel?: string; dimZh?: string; auspiciousness?: string }>;
        flatYear?: boolean;
      }
    | undefined;
  if (cro) {
    if (cro.flatYear) {
      lines.push(`• [核心機會&風險] 今年運勢平穩，無顯著起伏月份`);
    } else {
      const opps = Array.isArray(cro.opportunities) ? cro.opportunities : [];
      const risks = Array.isArray(cro.risks) ? cro.risks : [];
      if (opps.length > 0) {
        const oppStr = opps
          .map((o) => `${o.monthLabel ?? '?'}（${o.dimZh ?? '?'}，${o.auspiciousness ?? '?'}）`)
          .join('、');
        lines.push(`• [核心機會月份] ${oppStr}`);
      }
      if (risks.length > 0) {
        const riskStr = risks
          .map((r) => `${r.monthLabel ?? '?'}（${r.dimZh ?? '?'}，${r.auspiciousness ?? '?'}）`)
          .join('、');
        lines.push(`• [核心風險月份] ${riskStr}`);
      }
    }
  }

  // 4. luckMethods (改運建議) — card titles + 用神 flavor.
  const lm = yearly.luckMethods as
    | {
        cards?: Array<{ title?: string; usefulGodElement?: string; usefulGodDirection?: string }>;
        weakestDimZh?: string;
      }
    | undefined;
  const cards = lm && Array.isArray(lm.cards) ? lm.cards : [];
  if (cards.length > 0) {
    const cardStr = cards
      .slice(0, 3)
      .map((c) => {
        const flavor =
          c.usefulGodElement && c.usefulGodDirection
            ? `（用神 ${c.usefulGodElement} → ${c.usefulGodDirection}）`
            : '';
        return `${c.title ?? '?'}${flavor}`;
      })
      .join('、');
    lines.push(
      `• [改運建議] ${cardStr}` +
        (lm?.weakestDimZh ? `；今年最需留意：${lm.weakestDimZh}` : ''),
    );
  }

  if (lines.length === 0) return null;

  return [
    `📅 今年 ${yearGanZhi}年流年教義事件（必須以下列文字為主敘述，不可省略）：`,
    ...lines,
    `⚠️ 上述為流年趨勢，非命局定論。引用必須使用「今年宜/今年易於/今年趨向」軟觸發語氣，禁止「今年會/今年一定/今年必」。` +
      ` 用神/喜神/忌神 為命格層級判定，不可在流年層級重新指派。核心機會/風險月份必須引用上述結構化資料，禁止虛構月份或吉日。`,
  ].join('\n');
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
