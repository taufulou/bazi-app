/**
 * DTOs for the 八字日運/月運/年運 (Fortune) feature endpoints.
 *
 * Plan: .claude/plans/ok-next-big-feature-merry-cake.md
 * Phase 1: daily only. Monthly + yearly DTOs reserved for Phase 2/3.
 */
import { IsString, IsOptional, IsUUID, Matches, IsBooleanString } from 'class-validator';

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
