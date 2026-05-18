/**
 * Fortune — Frontend API client.
 *
 * Wraps the NestJS Fortune endpoints. Phase 1 covers /api/fortune/daily;
 * monthly + yearly endpoints arrive in Phase 2/3.
 *
 * Pattern mirrors `apps/web/app/lib/chat-api.ts`.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ============================================================
// Response shape — mirrors apps/api/src/fortune/dto/index.ts
// ============================================================

export type FortuneValence = 'beneficial' | 'harmful' | 'neutral' | 'not_applicable';

export interface FortuneSignal {
  type: string;
  narrative: string;
  valence?: FortuneValence;
  role?: string;
  [key: string]: unknown;
}

export interface FortuneDimension {
  score: number;        // 0-100
  label: string;        // 極佳/順遂/平穩/需謹慎/不利
  signals: FortuneSignal[];
}

export interface DailyFortuneNarrative {
  daily_overview: string;
  daily_romance: string;
  /** Optional ≤25 字 pull-quote takeaway shown above the romance narrative.
   *  Per UX Sprint R1.6 + S3.1. Backward-compat: when missing, frontend
   *  renders narrative only (no pull-quote). */
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

export interface HeadlinerAnchor {
  /** Internal signal/type identifier (e.g. 'day_ganzhi', 'chong_day_branch') */
  type: string;
  /** Human-readable Chinese display label (e.g. '戊子日', '沖配偶宮') */
  label: string;
}

export interface DailyFortuneEngineOutput {
  dayStem: string;
  dayBranch: string;
  dayGanZhi: string;
  dayTenGod: string;
  auspiciousness: string;         // 7-label
  energyScore: number;            // 0-100 derived advisory
  metaFraming: 'soft_trigger';
  dimensions: Record<'romance' | 'career' | 'finance' | 'travel' | 'health', FortuneDimension>;
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
  /** Option 2.5 UI layer — chip line composed by engine. chartContext = always 3
   *  gold pills (日干支, 十神, 整體判定); triggers = top 2 red pills (may be empty
   *  on quiet days). */
  headlinerSignals?: {
    chartContext: HeadlinerAnchor[];
    triggers: HeadlinerAnchor[];
  };
}

export interface DailyFortuneResponse {
  date: string;
  profileId: string;
  /** Birth profile's ISO birth date (YYYY-MM-DD) — displayed in the
   *  subheader chip in place of the previous «我的» tag. */
  profileBirthDate: string;
  /** Birth profile's birth time (HH:MM) — appended to the chip when present.
   *  Optional defensively; backend always populates per Prisma schema. */
  profileBirthTime?: string;
  engineOutput: DailyFortuneEngineOutput;
  narrative: DailyFortuneNarrative | null;
  cacheHit: boolean;
  generatedAt: string;
}

export class FortuneApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FortuneApiError';
  }
}

// ============================================================
// API calls
// ============================================================

interface FetchOpts {
  token: string;
  profileId?: string;
  date?: string;            // YYYY-MM-DD; client must resolve 23:00 子時 boundary
  signal?: AbortSignal;
}

export async function fetchDailyFortune(opts: FetchOpts): Promise<DailyFortuneResponse> {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.date) params.set('date', opts.date);

  const url = `${API_BASE}/api/fortune/daily${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    signal: opts.signal,
  });

  if (!response.ok) {
    let body: { message?: string; code?: string } = {};
    try {
      body = await response.json();
    } catch {
      // ignore
    }
    throw new FortuneApiError(
      response.status,
      body.code ?? `HTTP_${response.status}`,
      body.message ?? `Fortune fetch failed: ${response.status}`,
    );
  }

  return response.json();
}

// ============================================================
// Local helpers
// ============================================================

/**
 * Resolve the current Bazi day from local clock time.
 * Bazi day flips at 23:00 (子時 start). If local clock is 23:00+, the
 * Bazi day is TOMORROW's calendar date.
 *
 * Returns YYYY-MM-DD ready to pass to the API.
 */
export function resolveBaziToday(now: Date = new Date()): string {
  const advanced = new Date(now);
  if (now.getHours() >= 23) {
    advanced.setDate(advanced.getDate() + 1);
  }
  // YYYY-MM-DD in local TZ (sv-SE locale produces ISO-like format)
  return advanced.toLocaleDateString('sv-SE');
}

/** Map a 7-tier auspiciousness label to a UX-friendly mood phrase. */
export function moodKeywordFromLabel(label: string): string {
  const map: Record<string, string> = {
    大吉: '今日順遂',
    吉: '今日宜把握',
    吉中有凶: '吉中需謹慎',
    平: '今日平穩',
    凶中有吉: '凶中可轉機',
    小凶: '今日宜緩',
    凶: '今日宜守',
    大凶: '今日宜避鋒',
    凶上加凶: '今日大忌',
  };
  return map[label] ?? '今日平穩';
}
