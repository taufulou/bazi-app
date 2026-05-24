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

// ============================================================
// Folk content (Phase 1.5.z) — 4 new fields layered on Phase 1 wealthDirection.
// All chart-level fields key on 用神 element. auspiciousHours per-day.
// Research artifacts: /Users/roger/.claude/plans/fortune-folk-content-research-results.md
// ============================================================

export interface FortuneLuckyColor {
  element: string;
  primary: string;
  secondary: string;
  tertiary?: string;
  cite: string;
  provenance: 'classical';
  note: string;
}

export interface FortuneLuckyNumber {
  element: string;
  numbers: number[];
  cite: string;
  /** UI shows 「民俗」 badge for this field per Phase A Sub-Agent C verdict —
   *  source classical (河圖) but子平 modern-app density low. */
  provenance: 'folk_tradition';
  note: string;
}

export interface FortuneLuckyFoodFavor {
  element: string;
  category: string;
  examples: string[];
  cite: string;
  provenance: 'classical';
}

export interface FortuneLuckyFoodAvoid {
  element: string;
  category: string;
  /** 五行 mechanism reason MUST be cited in narrative (e.g. 「因金克木傷您命中用神」). */
  reason: string;
  cite_sources: string[];
  classification: 'doctrinal';
  avoid_strength: 'strong';
  provenance: 'classical';
}

export interface FortuneAuspiciousHour {
  branch: string;
  hour_range: string;
  classical_name: string;
  provenance: 'classical';
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
    /** Phase 1.5.z — 用神-keyed lucky color (chart-level invariant). null if 用神 unresolved. */
    luckyColor: FortuneLuckyColor | null;
    /** Phase 1.5.z — 河圖五行數 (folk_tradition tier — UI shows 「民俗」 badge). */
    luckyNumber: FortuneLuckyNumber | null;
    /** Phase 1.5.z — 用神-keyed favorable food (chart-level invariant). */
    luckyFoodFavor: FortuneLuckyFoodFavor | null;
    /** Phase 1.5.z — 用神受剋之味 (doctrinal+strong only; 3-source citations). */
    luckyFoodAvoid: FortuneLuckyFoodAvoid | null;
    /** Phase 1.5.z — 黃道吉時 per-day (day_branch only — NOT month_branch). 6 entries per day. */
    auspiciousHours: FortuneAuspiciousHour[];
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
 * Resolve the current Bazi day from clock time.
 * Bazi day flips at 23:00 (子時 start) in Asia/Taipei wall-clock time.
 * If the Taipei wall clock is 23:00+, the Bazi day is TOMORROW's
 * Taipei calendar date.
 *
 * Phase Fortune chat — Issue 9 fix: previously used browser-local
 * `getHours()` + `toLocaleDateString('sv-SE')` (browser locale). For
 * US-diaspora users on PT 23:30, that resolved to the wrong day relative
 * to backend `fortune.service.ts::todayIsoDate()` which uses Taipei
 * exclusively. Mismatch caused chat anchorDate / fortune-page targetDate
 * to disagree intermittently. Now both resolve in Asia/Taipei → byte-
 * identical anchors regardless of where the user browses from.
 *
 * Returns YYYY-MM-DD ready to pass to the API.
 */
export function resolveBaziToday(now: Date = new Date()): string {
  // Read Taipei wall-clock hour + Taipei calendar date directly via Intl.
  // sv-SE locale guarantees YYYY-MM-DD format; en-GB hour gives 24h numeric.
  const tz = 'Asia/Taipei';
  const taipeiHourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const taipeiHour = parseInt(taipeiHourStr, 10);
  const taipeiDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  if (taipeiHour >= 23) {
    // Advance one calendar day in Taipei time. Use Date arithmetic on the
    // Taipei date string (parsing in UTC is fine since the addition is
    // calendar-relative, not wall-clock).
    //
    // Strict-mode TS: `.split('-').map(Number)` returns `(number|undefined)[]`.
    // YYYY-MM-DD format guarantees exactly 3 elements (sv-SE format is locked
    // above), so we narrow with a cast — runtime-safe + tsc --noEmit clean
    // (audit fix LOW-1).
    const parts = taipeiDate.split('-').map(Number) as [number, number, number];
    const [y, m, d] = parts;
    const advanced = new Date(Date.UTC(y, m - 1, d + 1));
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(advanced);
  }
  return taipeiDate;
}

// ============================================================
// Subscriber window math (mirrors backend at fortune.service.ts:62-68)
// ============================================================

export const FREE_WINDOW_PAST = 0;
export const FREE_WINDOW_FUTURE = 0;
export const SUBSCRIBER_WINDOW_PAST = 1;
export const SUBSCRIBER_WINDOW_FUTURE = 30;

export type UserTier = 'FREE' | 'BASIC' | 'PRO' | 'MASTER';

/** Add `n` days to an ISO YYYY-MM-DD string. Negative `n` subtracts. */
export function addDaysIso(iso: string, n: number): string {
  // Parse YYYY-MM-DD as a local-time date (avoid UTC drift)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]!), Number(m[2]!) - 1, Number(m[3]!));
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

/**
 * Difference (target - reference) in whole days (local TZ). Both inputs are
 * YYYY-MM-DD strings.
 */
export function diffDaysIso(target: string, reference: string): number {
  const tm = target.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const rm = reference.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!tm || !rm) return 0;
  const t = new Date(Number(tm[1]!), Number(tm[2]!) - 1, Number(tm[3]!));
  const r = new Date(Number(rm[1]!), Number(rm[2]!) - 1, Number(rm[3]!));
  // Round to handle DST transitions
  return Math.round((t.getTime() - r.getTime()) / 86_400_000);
}

/**
 * Returns true if `targetIso` is within the user's allowed query window
 * relative to `todayBaziIso`. Tier-aware. Mirrors backend enforcement in
 * `apps/api/src/fortune/fortune.service.ts:208-224` — server is the source of
 * truth; this client-side check is for UX gating only.
 */
export function isDateInSubscriberWindow(
  targetIso: string,
  todayBaziIso: string,
  tier: UserTier | undefined,
): boolean {
  const diff = diffDaysIso(targetIso, todayBaziIso);
  if (tier === undefined || tier === 'FREE') {
    return diff >= -FREE_WINDOW_PAST && diff <= FREE_WINDOW_FUTURE;
  }
  return diff >= -SUBSCRIBER_WINDOW_PAST && diff <= SUBSCRIBER_WINDOW_FUTURE;
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
