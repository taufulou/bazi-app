/**
 * DTOs for the 八字日運/月運/年運 (Fortune) feature endpoints.
 *
 * Plan: .claude/plans/ok-next-big-feature-merry-cake.md
 * Phase 1: daily only. Monthly + yearly DTOs reserved for Phase 2/3.
 */
import { IsString, IsOptional, IsUUID, Matches, IsBooleanString, IsDateString } from 'class-validator';

// ============================================================
// GET /api/fortune/daily
// ============================================================

export class GetDailyFortuneQueryDto {
  /** Birth profile to compute fortune for. Falls back to user's primary profile when omitted. */
  @IsOptional()
  @IsUUID()
  profileId?: string;

  /**
   * Target Bazi day in YYYY-MM-DD format. The CLIENT is responsible for
   * resolving the 23:00 子時 boundary (caller should send tomorrow's date
   * when local clock is 23:00+).
   *
   * Defaults to today (server-side) when omitted.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  // Review fix: @Matches checks format but accepts impossible dates (2026-02-30);
  // strict ISO-8601 rejects them → clean 400 instead of a DB 500.
  @IsDateString({ strict: true }, { message: 'date must be a valid calendar date' })
  date?: string;

  /**
   * Progressive-loading hint (Phase Fortune+ UX). When 'true', the service
   * returns the deterministic engine output (energy score, dimensions, folk
   * content, ganzhi labels) WITHOUT running the AI narration step. Saves
   * ~3-5s on cold cache.
   *
   * Cache behavior:
   *  - Cache HIT: returns the full cached payload (narrative included as bonus)
   *  - Cache MISS: runs engine only, returns engine data, DOES NOT persist to
   *    DB or Redis (the subsequent full-fetch will persist with narrative)
   *
   * Frontend pattern: issue 2 parallel fetches on cold-load
   *  - `engineOnly=true` → renders score/dims/folk immediately (~500ms)
   *  - `engineOnly=false` (or omitted) → swaps narrative skeleton with prose (~3-5s)
   *
   * Validation as IsBooleanString since Express query strings are always strings.
   * Service interprets 'true' (case-insensitive) as the engine-only path.
   */
  @IsOptional()
  @IsBooleanString()
  engineOnly?: string;
}

// ============================================================
// Response shape (subset of engine output + AI narrative)
// ============================================================

export interface DailyFortuneDimension {
  score: number;            // 0-100
  label: string;            // 極佳/順遂/平穩/需謹慎/不利
  signals: Array<{
    type: string;
    narrative: string;
    valence?: 'beneficial' | 'harmful' | 'neutral' | 'not_applicable';
    role?: string;
    [key: string]: unknown;
  }>;
}

export interface DailyFortuneAINarrative {
  daily_overview: string;
  daily_romance: string;
  /** Optional ≤25 字 pull-quote takeaway shown above romance narrative (UX
   *  Sprint R1.6 + S3.1). Backward-compat: when missing, frontend renders
   *  narrative only. */
  daily_romance_takeaway?: string;
  daily_career: string;
  daily_career_takeaway?: string;
  daily_finance: string;
  daily_finance_takeaway?: string;
  daily_travel: string;
  daily_travel_takeaway?: string;
  daily_health: string;
  daily_health_takeaway?: string;
  daily_advice: {
    canTry: string[];
    shouldHold: string[];
  };
}

export interface DailyFortuneResponse {
  /** ISO date (Bazi-day) */
  date: string;
  /** Birth profile this fortune was computed for */
  profileId: string;
  /** Birth profile's ISO birth date (YYYY-MM-DD) — for subheader chip display */
  profileBirthDate: string;
  /** Birth profile's birth time (HH:MM) — appended to subheader chip when present.
   *  Schema-required so always populated; frontend treats as optional for safety. */
  profileBirthTime: string;
  /** Engine-deterministic output */
  engineOutput: {
    dayStem: string;
    dayBranch: string;
    dayGanZhi: string;
    dayTenGod: string;
    /** Final day verdict (Option 2.5: post-softening, post-subordination-cap).
     *  This is what UI surfaces as the daily label. */
    auspiciousness: string;     // 7-label (final, post-cap)
    energyScore: number;        // 0-100 derived advisory
    metaFraming: 'soft_trigger';
    /** Option 2.5 transparency fields (optional — present when engine emits them) */
    rawStructuralAuspiciousness?: string;   // day-pillar's bare verdict, pre-softening pre-cap
    rawDailyAuspiciousness?: string;        // post-softening, pre-cap
    flowMonthAuspiciousness?: string;       // independent flow-month theme (cap input)
    perDaySoftening?: string[];             // mitigation/acceleration signals that fired
    /** Option 2.5 UI layer — pre-composed pill line for `daily_overview` header.
     *  chartContext = always 3 (gold pills): 日干支, 十神, 整體判定.
     *  triggers = top 2 (red pills): structural + softening signals fired today;
     *  may be empty on quiet days. */
    headlinerSignals?: {
      chartContext: Array<{ type: string; label: string }>;
      triggers: Array<{ type: string; label: string }>;
    };
    dimensions: Record<'romance' | 'career' | 'finance' | 'travel' | 'health', DailyFortuneDimension>;
    /** Global 用神-alignment shift (Plan Phase 1, MC-8) — one signal for the
     *  whole day; the 5 dimension scores already carry the effect. Absent when
     *  the FORTUNE_DIM_YONGSHEN_BASELINE_ENABLED flag is off. */
    dayEnergyAlignment?: {
      type: string;
      shift: number;
      valence: 'beneficial' | 'harmful' | 'neutral';
      narrative: string;
      metaFraming?: string;
      hehua?: Record<string, unknown>;
      kongWang?: Record<string, unknown>;  // DR-3 空亡 role-flip / 沖空則實 note
    };
    folkContent: {
      wealthDirection: {
        element: string;
        direction: string;
        provenance: 'classical';
        note: string;
      };
      /** 用神 element-keyed lucky color (chart-level invariant per Phase 1.5.z research).
       *  null when 用神 unresolved. Cite: 黃帝內經素問·陰陽應象大論. */
      luckyColor: {
        element: string;
        primary: string;
        secondary: string;
        tertiary?: string;
        cite: string;
        provenance: 'classical';
        note: string;
      } | null;
      /** 用神 element-keyed lucky number (folk_tradition tier — UI shows 「民俗」 badge).
       *  Source classical (河圖) but子平 modern-app density low. null when 用神 unresolved. */
      luckyNumber: {
        element: string;
        numbers: number[];
        cite: string;
        provenance: 'folk_tradition';
        note: string;
      } | null;
      /** 用神 element-keyed favorable food (chart-level invariant).
       *  Cite: 黃帝內經素問·陰陽應象大論 + 五常政大論. null when 用神 unresolved. */
      luckyFoodFavor: {
        element: string;
        category: string;
        examples: string[];
        cite: string;
        provenance: 'classical';
      } | null;
      /** 用神受剋之味 — avoid food (3-source classical citations, doctrinal+strong only).
       *  TCM_CONDITIONAL items excluded from engine emission. null when 用神 unresolved. */
      luckyFoodAvoid: {
        element: string;
        category: string;
        reason: string;
        cite_sources: string[];
        classification: 'doctrinal';
        avoid_strength: 'strong';
        provenance: 'classical';
      } | null;
      /** 黃道吉時 — per-day, derived from day_branch ONLY (NOT month_branch).
       *  6 entries per day per 協紀辨方書 卷十 «日上起時神煞» (青龍訣). */
      auspiciousHours: Array<{
        branch: string;
        hour_range: string;
        classical_name: string;
        provenance: 'classical';
      }>;
    };
    ruleTrace: string[];
    preAnalysisVersion: string;
  };
  /** AI-generated narrative — null when engine-only preview (Phase 1 always populates this) */
  narrative: DailyFortuneAINarrative | null;
  /** Cache metadata */
  cacheHit: boolean;
  generatedAt: string;
}


// ============================================================
// MONTHLY (八字月運) — Phase 2 DTOs
// ============================================================
// Plan: .claude/plans/ok-next-big-feature-merry-cake.md
// Phase A research: phase-2-yueyun-phase-a-research-results.md
//
// Key locked decisions:
// - Partition LOCKED to `tiangan_dizhi_half` (2-cell: 上半月 stem-governed /
//   下半月 branch-governed) per Sub-Agent A
// - 4 dims locked (career/finance/romance/health) per Sub-Agent B;
//   出行 OMITTED (DAY-only doctrine)
// - Folk content OMITTED from monthly (DAY-only differentiator per locked
//   decision #6)
// - Subscriber window: -1 month / current / +12 months INCLUSIVE
// ============================================================

// ------------------------------------------------------------
// GET /api/fortune/monthly
// ------------------------------------------------------------

export class GetMonthlyFortuneQueryDto {
  /** Birth profile to compute fortune for. Falls back to user's primary profile when omitted. */
  @IsOptional()
  @IsUUID()
  profileId?: string;

  /**
   * Target month in YYYY-MM format. Cross-flow-year is resolved internally
   * via cnlunar's 立春-correct month8Char + Jan-rule (January = 丑月 of
   * PREVIOUS flow year).
   *
   * Defaults to the user's current month (Asia/Taipei TZ) when omitted.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'month must be in YYYY-MM format',
  })
  month?: string;
}

// ------------------------------------------------------------
// PartitionSpec — mirrors monthly_enhanced.py TypedDict
// ------------------------------------------------------------
// Locked from Phase A Sub-Agent A research (2026-05-28).
// Web mirror in apps/web/app/lib/fortune-api.ts must stay in sync per
// Phase 1.5.z lesson (web build breaks otherwise).
// `governing_pillar` field is DOCTRINE-BEARING — referenced by
// anti-hallucination clause 5 in FORTUNE_V1_PROMPTS.monthly.

export interface PartitionBucket {
  /** Display label in zh-TW. '上半月' or '下半月'. */
  label: string;
  /** [start_day, end_day_or_null] within the active 流月 day window
   *  (NOT Gregorian dates). null end_day means «through end of 流月». */
  day_range: [number, number | null];
  /** Which 流月 pillar governs this bucket's qi.
   *  - 'stem' → 上半月 (流月天干 動氣先出)
   *  - 'branch' → 下半月 (流月地支 靜氣後沉)
   *  Per 子平 流月逼進法 (司莹居士《八字泄天机》中卷). */
  governing_pillar: 'stem' | 'branch';
}

export interface PartitionSpec {
  /** LOCKED to 'tiangan_dizhi_half' per Phase A research. Future schemes
   *  would need a new plan iteration. */
  scheme_id: 'tiangan_dizhi_half';
  buckets: PartitionBucket[];
}

// ------------------------------------------------------------
// Monthly dimension (4 dims, no travel)
// ------------------------------------------------------------

export interface MonthlyFortuneDimension {
  score: number;            // 0-100
  label: string;            // 極佳/順遂/平穩/需謹慎/不利
  /** Chinese label for UI (事業/財運/感情/健康) — engine-supplied
   *  for consistency, frontend reuses. */
  labelZh: string;
  /** Signals from `_compute_single_month`'s `aspects[dim].signals[]`.
   *  Plain Chinese strings, NOT typed valence objects (monthly engine
   *  is less granular than daily — Phase 2.x candidate). */
  signals: string[];
}

// ------------------------------------------------------------
// Intra-month breakdown bucket result (L1.b output)
// ------------------------------------------------------------

export interface IntraMonthBucketResult {
  label: string;
  day_range: [number, number | null];
  governing_pillar: 'stem' | 'branch';
  /** Count of days in this bucket with auspicious label (大吉/吉/吉中有凶). */
  auspicious_days: number;
  /** Count of days with challenging label (凶中有吉/小凶/凶/大凶/凶上加凶). */
  challenging_days: number;
  /** Count of days at 平. */
  neutral_days: number;
  /** Top 3 days by abs(energyScore - 50) — biggest movers either direction. */
  peak_signals: Array<{
    date: string | null;          // ISO date string
    energyScore: number;
    label: string;
    signals: string[];            // 1-3 representative signal strings
  }>;
  /** Top 3 most-frequent shensha keywords in the bucket (e.g., 紅鸞 / 比劫). */
  dominant_shensha: string[];
}

export interface IntraMonthBreakdown {
  scheme_id: 'tiangan_dizhi_half';
  liuyue_window: {
    start: string;  // ISO date — 流月 start (節氣 boundary)
    end: string;    // ISO date — 流月 last day (NOT next 流月 start)
    days: number;   // window length (~28-32)
  };
  buckets: IntraMonthBucketResult[];
}

// ------------------------------------------------------------
// AI Narrative
// ------------------------------------------------------------

export interface MonthlyFortuneAINarrative {
  /** Hero overview narrative for the month as a whole. */
  monthly_overview: string;
  /** Per-dim narratives — 4 dims only (no travel). */
  monthly_career: string;
  /** Optional ≤25 字 pull-quote takeaway. Backward-compat: null/missing → narrative only. */
  monthly_career_takeaway?: string;
  monthly_finance: string;
  monthly_finance_takeaway?: string;
  monthly_romance: string;
  monthly_romance_takeaway?: string;
  monthly_health: string;
  monthly_health_takeaway?: string;
  /** Concrete advice — symmetric to daily_advice. */
  monthly_advice: {
    canTry: string[];
    shouldHold: string[];
  };
  /** Optional intra-month breakdown narrative — populated when L1.b
   *  data is injected into the prompt. AI fills one entry per bucket
   *  (上半月 / 下半月). Anti-hallucination clause 5: references MUST
   *  come from `intraMonthBreakdown.buckets[].peak_signals/dominant_shensha`,
   *  AI may NOT invent specific dates. */
  intra_month_breakdown?: Array<{
    partition_label: string;  // '上半月' or '下半月'
    narrative: string;
  }>;
}

// ------------------------------------------------------------
// Response shape (engine output + narrative + intra-month breakdown)
// ------------------------------------------------------------

export interface MonthlyFortuneResponse {
  /** Target month in YYYY-MM format (user-input — preserved verbatim). */
  month: string;
  /** Resolved flow year (may differ from target month's year for January queries). */
  flowYear: number;
  /** Birth profile this fortune was computed for. */
  profileId: string;
  /** Birth profile's ISO birth date (YYYY-MM-DD). */
  profileBirthDate: string;
  /** Birth profile's birth time (HH:MM). */
  profileBirthTime: string;
  /** Engine-deterministic output. */
  engineOutput: {
    monthStem: string;
    monthBranch: string;
    monthGanZhi: string;
    monthTenGod: string;
    monthLabel: string;              // e.g., '癸巳月'
    /** Final month verdict. Inherits Phase 12b/12c Fix A-F doctrine. */
    auspiciousness: string;           // 7-label
    energyScore: number;              // 0-100 derived advisory
    metaFraming: 'soft_trigger';
    /** Phase 12b/c transparency fields (optional — present when fired). */
    baseAuspiciousness?: string;
    bareMonthAuspiciousness?: string;
    isKongWang?: boolean;
    /** Phase 12b/c additive fields — surfaced verbatim for deterministic
     *  AI injector at chat-context layer (per L3.5). */
    officerSealActivation?: { pattern: string; direction: string; level: string };
    fuYinInteractions?: Array<{ pillar: string; branch: string; role: string }>;
    /**
     * Audit fix HIGH #2 (2026-05-28): engine emits `releasedStems: List[Dict]`
     * per `annual_enhanced.py:1721-1738` — each item has {stem, position,
     * tenGod, role, weight}. Previously TS DTO had `releasedStems: string[]`
     * which would render `[object Object]` in the prompt. Also `direction`
     * doesn't exist at engine top-level — it's `action: 'downgrade' | 'upgrade'`
     * + `netRoleScore` instead.
     */
    chongKuRelease?: {
      natalPillar: string;
      natalBranch: string;
      releasedStems: Array<{
        stem: string;
        position: 'benqi' | 'zhongqi' | 'yuqi';
        tenGod: string;
        role: string;
        weight: number;
      }>;
      netRoleScore: number;
      action: 'downgrade' | 'upgrade';
      steps: number;
      stemRescueApplied: boolean;
    };
    liuHaiInteractions?: Array<{ pillar: string; pair: string; role: string; kind: string }>;
    /** 4-dim scores. NO travel — Sub-Agent B's 出行 omission is doctrinally
     *  correct per 三命通會 神煞篇 + every modern practitioner write-up. */
    dimensions: Record<'career' | 'finance' | 'romance' | 'health', MonthlyFortuneDimension>;
    /** LOCKED partition scheme (tiangan_dizhi_half) — 2 buckets always. */
    partitionSpec: PartitionSpec;
    ruleTrace: string[];
    preAnalysisVersion: string;
  };
  /** AI-generated narrative — null when engine-only preview. */
  narrative: MonthlyFortuneAINarrative | null;
  /** Per-bucket aggregation from L1.b. Populated when caller opts in.
   *  Drives the MonthlyTimeGrid UI component + intra-month narrative slot. */
  intraMonthBreakdown?: IntraMonthBreakdown;
  /** Cache metadata. */
  cacheHit: boolean;
  generatedAt: string;
}

// ============================================================
// 年運 (Yearly Fortune) — Phase 3
// ============================================================
// Phase A research-locked 2026-05-29
// (.claude/plans/phase-3-nianyun-phase-a-research-results.md):
// - 4 dims (career/finance/romance/health) as ★1-5 STAR ratings + keyword;
//   overall = EnergyScoreRing 0-100. NO travel. 感情=romance NOT 人際關係.
// - 核心風險&機會: top-3 opp + bottom-3 risk MONTHS (gated; flatYear sentinel).
// - 改運建議: deterministic luck-method cards (weakest-dim + 用神).
// - LIGHTER PREVIEW — cross-sells to paid 八字流年運勢 (no 12-month prose /
//   deep 太歲 / 大運 sequence).
// - Subscriber window: -1 year / current / +4 years (matches Seer's 6 pills).
// - Year selection maps DIRECTLY to 立春-anchored flow year (no cross-boundary).
// ============================================================

// ------------------------------------------------------------
// GET /api/fortune/yearly
// ------------------------------------------------------------

export class GetYearlyFortuneQueryDto {
  /** Birth profile to compute fortune for. Falls back to user's primary profile when omitted. */
  @IsOptional()
  @IsUUID()
  profileId?: string;

  /**
   * Target 立春-anchored flow year (YYYY). Defaults to the user's current
   * year (Asia/Taipei TZ) when omitted. NO cross-flow-year resolution
   * complexity like month — a 流年 IS 立春-to-立春 by definition.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'year must be in YYYY format' })
  year?: string;
}

// ------------------------------------------------------------
// Yearly dimension (4 dims with ★ stars + keyword)
// ------------------------------------------------------------

export interface YearlyFortuneDimension {
  score: number;            // 0-100 (aggregated from 12 monthly per-dim scores)
  label: string;            // 極佳/順遂/平穩/需謹慎/不利
  /** ★1-5 (deterministic from score band, aligned to DIMENSION_LABEL_BANDS). */
  stars: number;
  labelZh: string;          // 事業/財運/感情/健康
}

// ------------------------------------------------------------
// 核心風險&機會 (engine-ranked top-3 opp + bottom-3 risk MONTHS)
// ------------------------------------------------------------

export interface YearlyRiskOpportunityEntry {
  /** Calendar month index 1-12. */
  month: number;
  /** Display label «N月» (Seer shows «12月 疲勞信號»). */
  monthLabel: string;
  auspiciousness: string;   // 7-label
  energyScore: number;      // 0-100
  /** Dominant dimension for this month (max-deviation attribution). */
  dim: 'career' | 'finance' | 'romance' | 'health';
  dimZh: string;            // 事業/財運/感情/健康
  deviationSign: 'positive' | 'negative';
  /** True when an opportunity month's dominant dim deviates negative
   *  (吉中有凶 doctrine — UI renders «機會中留意：X» caveat tag). */
  caveat: boolean;
  slot: 'opportunity' | 'risk';
}

export interface YearlyCoreRiskOpportunity {
  /** Up to 3 opportunity months (energy >= 58). May be empty for flat years. */
  opportunities: YearlyRiskOpportunityEntry[];
  /** Up to 3 risk months (energy <= 42). May be empty for flat years. */
  risks: YearlyRiskOpportunityEntry[];
  /** True when both lists empty — UI shows «今年運勢平穩，無顯著起伏».
   *  NEVER padded to 3 (padding a 平 month = fabrication). */
  flatYear: boolean;
}

// ------------------------------------------------------------
// 改運建議 (deterministic luck-method cards)
// ------------------------------------------------------------

export interface YearlyLuckMethodCard {
  id: string;
  title: string;            // 運勢整理法 / 社交磁場法 / 養生調息法 / ...
  body: string;
  provenance: 'classical' | 'folk_tradition' | 'mixed';
  /** Present on the 用神-flavored card (provenance 'mixed'). */
  flavorProvenance?: 'classical';
  usefulGodElement?: string;
  usefulGodDirection?: string;
  usefulGodColor?: string;
}

export interface YearlyLuckMethods {
  cards: YearlyLuckMethodCard[];
  weakestDim: 'career' | 'finance' | 'romance' | 'health';
  weakestDimZh: string;
  /** 1-line 民俗/養生 disclaimer (UI shows below cards). */
  disclaimer: string;
}

// ------------------------------------------------------------
// Yearly AI Narrative
// ------------------------------------------------------------

export interface YearlyFortuneAINarrative {
  /** Year headline keyword (≤12 char, e.g. 「穩中求進」). */
  yearly_headline: string;
  /** Hero overview (~120-180 char, high-level all-4-dims). */
  yearly_overview: string;
  /** Per-dim keyword (≤6 char, e.g. 愛意綿長) + prose. */
  yearly_career: string;
  yearly_career_keyword?: string;
  yearly_finance: string;
  yearly_finance_keyword?: string;
  yearly_romance: string;
  yearly_romance_keyword?: string;
  yearly_health: string;
  yearly_health_keyword?: string;
  /** Actionable advice prose (~120-180 char, single paragraph). */
  yearly_advice: string;
  /** Risk/opportunity narratives — one per engine-supplied month, paired
   *  BY ARRAY INDEX with coreRiskOpportunity (L3 injector enforces order).
   *  Anti-hallucination: months MUST come from structured fields. */
  yearly_risk_opportunities?: Array<{
    month_label: string;     // «N月» — must echo engine monthLabel
    type: 'risk' | 'opportunity';
    keyword: string;         // ≤6 char (疲勞信號 / 感情升溫)
    narrative: string;       // 1-liner
  }>;
}

// ------------------------------------------------------------
// Yearly response shape
// ------------------------------------------------------------

export interface YearlyFortuneResponse {
  /** Target flow year (YYYY, user-input preserved). */
  year: number;
  profileId: string;
  profileBirthDate: string;
  profileBirthTime: string;
  engineOutput: {
    yearGanZhi: string;       // e.g. '丙午'
    yearStem: string;
    yearBranch: string;
    yearTenGod: string;       // 流年 vs DM ten god
    auspiciousness: string;   // 7-label (overall year)
    energyScore: number;      // 0-100 (EnergyScoreRing)
    metaFraming: 'soft_trigger';
    /** 4-dim star ratings. NO travel. */
    dimensions: Record<'career' | 'finance' | 'romance' | 'health', YearlyFortuneDimension>;
    /** Engine-ranked top-3 opp + bottom-3 risk months (sibling, not nested
     *  in narrative — glossary discipline: engine camelCase). */
    coreRiskOpportunity: YearlyCoreRiskOpportunity;
    /** Deterministic 改運 luck-method cards. */
    luckMethods: YearlyLuckMethods;
    preAnalysisVersion: string;
  };
  /** AI-generated narrative — null when engine-only preview. */
  narrative: YearlyFortuneAINarrative | null;
  cacheHit: boolean;
  generatedAt: string;
}
