/**
 * DTOs for the 八字日運/月運/年運 (Fortune) feature endpoints.
 *
 * Plan: .claude/plans/ok-next-big-feature-merry-cake.md
 * Phase 1: daily only. Monthly + yearly DTOs reserved for Phase 2/3.
 */
import { IsString, IsOptional, IsUUID, Matches } from 'class-validator';

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
