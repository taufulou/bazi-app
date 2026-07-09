/**
 * Fortune — Frontend API client.
 *
 * Wraps the NestJS Fortune endpoints. Phase 1 covers /api/fortune/daily;
 * monthly + yearly endpoints arrive in Phase 2/3.
 *
 * Pattern mirrors `apps/web/app/lib/chat-api.ts`.
 */

import { redirectToSignInOnExpiry } from './auth-redirect';

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
  /** Global 用神-alignment shift (Plan Phase 1, MC-8) — one signal for the whole
   *  day; the 5 dimension scores already carry the effect. Absent when the
   *  baseline flag is off. */
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
  /**
   * Phase Fortune+ progressive loading: when true, the server returns the
   * engine output (energy score, dimensions, folk content, ganzhi labels)
   * WITHOUT running AI narration. Saves ~3-5s on cold cache.
   *
   * Pattern: issue 2 parallel fetches — one with `engineOnly: true` (fast),
   * one without (slow). Render engine immediately + swap narrative skeleton
   * with prose when full arrives. The narrative field will be null on
   * engine-only responses (cache hits return full payload as bonus).
   */
  engineOnly?: boolean;
}

/**
 * Phase Fortune Streaming — DAY scope wire event types matching backend
 * `FortuneDailyStreamEvent` from `apps/api/src/fortune/fortune-stream.service.ts`.
 *
 * Sequence:
 *   engine_ready    — engine output + chart anchors (frontend paints score/dims/folk)
 *   section_complete × N — one per `sections.<key>` as detected by clarinet
 *   done            — full sanitized narrative + cacheHit flag
 *
 * Cache hit: only engine_ready + done are emitted (no section_complete).
 */
export type FortuneDailyStreamEvent =
  | {
      type: 'engine_ready';
      engineOutput: DailyFortuneEngineOutput;
      profileId: string;
      profileBirthDate: string;
      profileBirthTime: string;
      date: string;
    }
  | { type: 'section_complete'; key: string; value: unknown }
  | {
      type: 'done';
      narrative: DailyFortuneNarrative | null;
      cacheHit: boolean;
    }
  | { type: 'error'; code: string; message: string };

/**
 * Phase 2.x Monthly Streaming — MONTH scope wire event types matching backend
 * `FortuneMonthlyStreamEvent` from `apps/api/src/fortune/fortune-stream.service.ts`.
 *
 * Glossary lock: `intraMonthBreakdown` is a SIBLING of `engineOutput` (not nested).
 * `cacheHit` is on `engine_ready` (plan v3 NEW-M1) so warm-cache UI surfaces read
 * the correct value during the engine→success gap. `done` does NOT carry
 * `intraMonthBreakdown` (plan v3 NEW-H1) — L5 handler spreads prev.data instead.
 */
export type FortuneMonthlyStreamEvent =
  | {
      type: 'engine_ready';
      engineOutput: MonthlyFortuneResponse['engineOutput'];
      intraMonthBreakdown?: IntraMonthBreakdown;
      profileId: string;
      profileBirthDate: string;
      profileBirthTime: string;
      month: string;      // 'YYYY-MM' input verbatim
      flowYear: number;
      cacheHit: boolean;
    }
  | { type: 'section_complete'; key: string; value: unknown }
  | {
      type: 'done';
      narrative: MonthlyFortuneNarrative | null;
      cacheHit: boolean;
    }
  | { type: 'error'; code: string; message: string };

/** Umbrella union for all scopes (R3 polish — single hook signature).
 *  Phase 3 adds FortuneYearlyStreamEvent (defined below near the YEARLY
 *  section). Forward reference is fine — TS hoists type aliases. */
export type FortuneStreamEvent =
  | FortuneDailyStreamEvent
  | FortuneMonthlyStreamEvent
  | FortuneYearlyStreamEvent;

interface StreamOpts {
  token: string;
  profileId?: string;
  date?: string;
  onEvent: (event: FortuneStreamEvent) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

interface MonthlyStreamOpts {
  token: string;
  profileId?: string;
  month?: string;        // 'YYYY-MM'
  onEvent: (event: FortuneStreamEvent) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/**
 * Open an SSE stream from `GET /api/fortune/daily/stream`. Returns a teardown
 * function that aborts the underlying fetch + reader.
 *
 * Mirrors `streamChatMessage` from `chat-api.ts`: fetch + ReadableStream
 * (not `EventSource` — no auto-reconnect; we want an authoritative one-shot
 * stream that the frontend can re-open on retry).
 */
export function streamDailyFortune(opts: StreamOpts): () => void {
  const controller = new AbortController();
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.date) params.set('date', opts.date);
  const url = `${API_BASE}/api/fortune/daily/stream${params.toString() ? `?${params}` : ''}`;

  (async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      opts.onError(err as Error);
      opts.onClose();
      return;
    }

    if (!response.ok) {
      // Layer C — pre-flight 401 (session expired). Fortune streams are always
      // authenticated → redirect. Fire BEFORE emitting the error event.
      if (response.status === 401) {
        redirectToSignInOnExpiry();
      }
      // Pre-flight errors (subscription gate, 401, throttle 429) come back
      // as plain JSON with `{ code, message }` (per `AllExceptionsFilter`).
      let body: { message?: string; code?: string } = {};
      try {
        body = await response.json();
      } catch {
        // ignore
      }
      opts.onEvent({
        type: 'error',
        code: body.code || `HTTP_${response.status}`,
        message:
          body.message ||
          `Fortune stream failed: ${response.status} ${response.statusText}`,
      });
      opts.onClose();
      return;
    }

    if (!response.body) {
      opts.onError(new Error('Fortune stream: missing response body'));
      opts.onClose();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          dispatchFortuneFrame(frame, opts.onEvent);
          frameEnd = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim().length > 0) {
        dispatchFortuneFrame(buffer, opts.onEvent);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        opts.onError(err as Error);
      }
    } finally {
      opts.onClose();
    }
  })();

  return () => controller.abort();
}

/**
 * Phase 2.x — Open an SSE stream from `GET /api/fortune/monthly/stream`.
 * Mirror of `streamDailyFortune` for MONTH scope. Returns a teardown function.
 */
export function streamMonthlyFortune(opts: MonthlyStreamOpts): () => void {
  const controller = new AbortController();
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.month) params.set('month', opts.month);
  const url = `${API_BASE}/api/fortune/monthly/stream${params.toString() ? `?${params}` : ''}`;

  (async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      opts.onError(err as Error);
      opts.onClose();
      return;
    }

    if (!response.ok) {
      // Layer C — pre-flight 401 (session expired). Fortune streams are always
      // authenticated → redirect. Fire BEFORE emitting the error event.
      if (response.status === 401) {
        redirectToSignInOnExpiry();
      }
      // Pre-flight errors (subscription gate, 401, throttle 429) come back
      // as plain JSON with `{ code, message }` (per `AllExceptionsFilter`).
      let body: { message?: string; code?: string } = {};
      try {
        body = await response.json();
      } catch {
        // ignore
      }
      opts.onEvent({
        type: 'error',
        code: body.code || `HTTP_${response.status}`,
        message:
          body.message ||
          `Monthly fortune stream failed: ${response.status} ${response.statusText}`,
      });
      opts.onClose();
      return;
    }

    if (!response.body) {
      opts.onError(new Error('Monthly fortune stream: missing response body'));
      opts.onClose();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          dispatchFortuneFrame(frame, opts.onEvent);
          frameEnd = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim().length > 0) {
        dispatchFortuneFrame(buffer, opts.onEvent);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        opts.onError(err as Error);
      }
    } finally {
      opts.onClose();
    }
  })();

  return () => controller.abort();
}

function dispatchFortuneFrame(
  frame: string,
  onEvent: (event: FortuneStreamEvent) => void,
): void {
  const lines = frame.split('\n');
  const dataParts: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('data: ')) dataParts.push(line.slice(6));
    else if (line.startsWith('data:')) dataParts.push(line.slice(5));
  }
  if (dataParts.length === 0) return;
  const payload = dataParts.join('\n');
  try {
    const event = JSON.parse(payload) as FortuneStreamEvent;
    onEvent(event);
  } catch {
    // Drop malformed frames silently
  }
}

export async function fetchDailyFortune(opts: FetchOpts): Promise<DailyFortuneResponse> {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.date) params.set('date', opts.date);
  if (opts.engineOnly) params.set('engineOnly', 'true');

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
    // Layer C — this is an authenticated fetch; a 401 means the session expired.
    if (response.status === 401) {
      redirectToSignInOnExpiry();
    }
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

/**
 * The current civil (國曆) calendar date in Asia/Taipei — the un-rolled
 * counterpart to resolveBaziToday(). Equal to resolveBaziToday() for most of
 * the day; during the 23:00–24:00 子時 window the Bazi day is one calendar day
 * AHEAD of this. Used to detect + explain that rollover in the UI so the
 * displayed date (which follows the Bazi 子時 boundary) isn't mistaken for a bug.
 */
export function civilTodayTaipei(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
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

/**
 * Map a 7-tier auspiciousness label to a display tier for coloring
 * (gold / orange / muted). Shared by HomeDailyFortuneCard + WelcomeFortunePill
 * so the classification stays in one place.
 */
export function tierOf(label: string): 'positive' | 'neutral' | 'negative' {
  if (['大吉', '吉', '吉中有凶'].includes(label)) return 'positive';
  if (['凶中有吉', '平'].includes(label)) return 'neutral';
  return 'negative';
}


// ============================================================
// MONTHLY (八字月運) — Phase 2 web mirror
// ============================================================
// MUST stay in sync with apps/api/src/fortune/dto/index.ts MONTHLY DTOs.
// Phase 1.5.z lesson: web build breaks if mirrors drift.
//
// Locked decisions (from Phase A research):
// - Partition `tiangan_dizhi_half` (2-cell: 上半月/下半月)
// - 4 dims (career/finance/romance/health); 出行 OMITTED
// - Folk content OMITTED from monthly
// - Subscriber window: -1 / current / +12 months INCLUSIVE
// ============================================================

// ------------------------------------------------------------
// PartitionSpec — mirror of monthly_enhanced.py TypedDict
// ------------------------------------------------------------

export interface PartitionBucket {
  label: string;
  day_range: [number, number | null];
  /** DOCTRINE-BEARING field — referenced by anti-hallucination clause 5
   *  in FORTUNE_V1_PROMPTS.monthly. Engineering MUST mirror this. */
  governing_pillar: 'stem' | 'branch';
}

export interface PartitionSpec {
  scheme_id: 'tiangan_dizhi_half';
  buckets: PartitionBucket[];
}

// ------------------------------------------------------------
// Monthly dimension (4 dims, no travel)
// ------------------------------------------------------------

export interface MonthlyFortuneDimension {
  score: number;
  label: string;
  labelZh: string;
  signals: string[];
}

// ------------------------------------------------------------
// Intra-month breakdown (L1.b output)
// ------------------------------------------------------------

export interface IntraMonthBucketResult {
  label: string;
  day_range: [number, number | null];
  governing_pillar: 'stem' | 'branch';
  auspicious_days: number;
  challenging_days: number;
  neutral_days: number;
  peak_signals: Array<{
    date: string | null;
    energyScore: number;
    label: string;
    signals: string[];
  }>;
  dominant_shensha: string[];
}

export interface IntraMonthBreakdown {
  scheme_id: 'tiangan_dizhi_half';
  liuyue_window: {
    start: string;
    end: string;
    days: number;
  };
  buckets: IntraMonthBucketResult[];
}

// ------------------------------------------------------------
// Monthly AI narrative
// ------------------------------------------------------------

export interface MonthlyFortuneNarrative {
  monthly_overview: string;
  monthly_career: string;
  monthly_career_takeaway?: string;
  monthly_finance: string;
  monthly_finance_takeaway?: string;
  monthly_romance: string;
  monthly_romance_takeaway?: string;
  monthly_health: string;
  monthly_health_takeaway?: string;
  monthly_advice: {
    canTry: string[];
    shouldHold: string[];
  };
  intra_month_breakdown?: Array<{
    partition_label: string;
    narrative: string;
  }>;
}

// ------------------------------------------------------------
// Engine output
// ------------------------------------------------------------

export interface MonthlyFortuneEngineOutput {
  monthStem: string;
  monthBranch: string;
  monthGanZhi: string;
  monthTenGod: string;
  monthLabel: string;
  auspiciousness: string;
  energyScore: number;
  metaFraming: 'soft_trigger';
  baseAuspiciousness?: string;
  bareMonthAuspiciousness?: string;
  isKongWang?: boolean;
  officerSealActivation?: { pattern: string; direction: string; level: string };
  fuYinInteractions?: Array<{ pillar: string; branch: string; role: string }>;
  /** Audit fix HIGH #2 — engine emits releasedStems as List[Dict] not string[];
   *  no `direction` field (use `action` instead). See API DTO comment. */
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
  dimensions: Record<'career' | 'finance' | 'romance' | 'health', MonthlyFortuneDimension>;
  partitionSpec: PartitionSpec;
  ruleTrace: string[];
  preAnalysisVersion: string;
}

// ------------------------------------------------------------
// Response
// ------------------------------------------------------------

export interface MonthlyFortuneResponse {
  month: string;          // YYYY-MM
  flowYear: number;
  profileId: string;
  profileBirthDate: string;
  profileBirthTime: string;
  engineOutput: MonthlyFortuneEngineOutput;
  narrative: MonthlyFortuneNarrative | null;
  intraMonthBreakdown?: IntraMonthBreakdown;
  cacheHit: boolean;
  generatedAt: string;
}

// ------------------------------------------------------------
// API call — GET /api/fortune/monthly
// ------------------------------------------------------------

interface FetchMonthlyOpts {
  token: string;
  profileId?: string;
  month?: string;          // YYYY-MM
  signal?: AbortSignal;
}

export async function fetchMonthlyFortune(
  opts: FetchMonthlyOpts,
): Promise<MonthlyFortuneResponse> {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.month) params.set('month', opts.month);

  const url = `${API_BASE}/api/fortune/monthly${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    signal: opts.signal,
  });

  if (!response.ok) {
    // Layer C — this is an authenticated fetch; a 401 means the session expired.
    if (response.status === 401) {
      redirectToSignInOnExpiry();
    }
    let body: { message?: string; code?: string } = {};
    try {
      body = await response.json();
    } catch {
      // ignore
    }
    throw new FortuneApiError(
      response.status,
      body.code ?? `HTTP_${response.status}`,
      body.message ?? `Monthly fortune fetch failed: ${response.status}`,
    );
  }

  return response.json();
}

// ------------------------------------------------------------
// Subscriber window — MONTHLY scope
// ------------------------------------------------------------
//
// Per locked plan: -1 month past + current + +12 months future (INCLUSIVE).
// From a 2026-05 anchor, 2027-05 is the last accessible month.
// Free users see current month only (FREE_WINDOW_*_MONTH = 0).

export const FREE_WINDOW_PAST_MONTH = 0;
export const FREE_WINDOW_FUTURE_MONTH = 0;
export const SUBSCRIBER_WINDOW_PAST_MONTH = 1;
export const SUBSCRIBER_WINDOW_FUTURE_MONTH = 12;

/** Add `n` months to a YYYY-MM string. Negative subtracts.
 *  Handles year boundary correctly. */
export function addMonthsIso(monthIso: string, n: number): string {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthIso;
  let year = Number(m[1]!);
  let month = Number(m[2]!) - 1 + n; // 0-indexed
  // Normalize year/month
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
}

/** Difference (target - reference) in whole months. Both YYYY-MM. */
export function diffMonthsIso(target: string, reference: string): number {
  const tm = target.match(/^(\d{4})-(\d{2})$/);
  const rm = reference.match(/^(\d{4})-(\d{2})$/);
  if (!tm || !rm) return 0;
  const ty = Number(tm[1]!),
    tmo = Number(tm[2]!);
  const ry = Number(rm[1]!),
    rmo = Number(rm[2]!);
  return (ty - ry) * 12 + (tmo - rmo);
}

/** True iff target YYYY-MM is within the user's subscriber window relative
 *  to current YYYY-MM. Mirrors backend subscription gate. */
export function isMonthInSubscriberWindow(
  targetMonth: string,
  currentMonth: string,
  tier: UserTier | undefined,
): boolean {
  const diff = diffMonthsIso(targetMonth, currentMonth);
  if (tier === undefined || tier === 'FREE') {
    return diff >= -FREE_WINDOW_PAST_MONTH && diff <= FREE_WINDOW_FUTURE_MONTH;
  }
  return (
    diff >= -SUBSCRIBER_WINDOW_PAST_MONTH &&
    diff <= SUBSCRIBER_WINDOW_FUTURE_MONTH
  );
}

/** Resolve the current month in Asia/Taipei TZ → YYYY-MM.
 *  Mirrors backend convention (FORTUNE_DEFAULT_TZ = 'Asia/Taipei'). */
export function resolveCurrentMonthIso(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  });
  // sv-SE with year+month gives YYYY-MM
  return formatter.format(now);
}

/** Map a 7-tier auspiciousness label to a UX-friendly monthly mood phrase. */
export function moodKeywordFromMonthlyLabel(label: string): string {
  const map: Record<string, string> = {
    大吉: '本月順遂',
    吉: '本月可把握',
    吉中有凶: '本月吉中需謹慎',
    平: '本月平穩',
    凶中有吉: '本月凶中可轉機',
    小凶: '本月宜緩',
    凶: '本月宜守',
    大凶: '本月宜避鋒',
    凶上加凶: '本月大忌',
  };
  return map[label] ?? '本月平穩';
}

// ============================================================
// 年運 (Yearly Fortune) — Phase 3 web mirror of apps/api dto/index.ts
// ============================================================

export interface YearlyFortuneDimension {
  score: number;
  label: string;
  stars: number;        // ★1-5
  labelZh: string;
}

export interface YearlyRiskOpportunityEntry {
  month: number;
  monthLabel: string;   // «N月»
  auspiciousness: string;
  energyScore: number;
  dim: 'career' | 'finance' | 'romance' | 'health';
  dimZh: string;
  deviationSign: 'positive' | 'negative';
  caveat: boolean;
  slot: 'opportunity' | 'risk';
}

export interface YearlyCoreRiskOpportunity {
  opportunities: YearlyRiskOpportunityEntry[];
  risks: YearlyRiskOpportunityEntry[];
  flatYear: boolean;
}

export interface YearlyLuckMethodCard {
  id: string;
  title: string;
  body: string;
  provenance: 'classical' | 'folk_tradition' | 'mixed';
  flavorProvenance?: 'classical';
  usefulGodElement?: string;
  usefulGodDirection?: string;
  usefulGodColor?: string;
}

export interface YearlyLuckMethods {
  cards: YearlyLuckMethodCard[];
  weakestDim: 'career' | 'finance' | 'romance' | 'health';
  weakestDimZh: string;
  disclaimer: string;
}

export interface YearlyFortuneNarrative {
  yearly_headline: string;
  yearly_overview: string;
  yearly_career: string;
  yearly_career_keyword?: string;
  yearly_finance: string;
  yearly_finance_keyword?: string;
  yearly_romance: string;
  yearly_romance_keyword?: string;
  yearly_health: string;
  yearly_health_keyword?: string;
  yearly_advice: string;
  yearly_risk_opportunities?: Array<{
    month_label: string;
    type: 'risk' | 'opportunity';
    keyword: string;
    narrative: string;
  }>;
}

export interface YearlyFortuneEngineOutput {
  yearGanZhi: string;
  yearStem: string;
  yearBranch: string;
  yearTenGod: string;
  auspiciousness: string;
  energyScore: number;
  metaFraming: 'soft_trigger';
  dimensions: Record<'career' | 'finance' | 'romance' | 'health', YearlyFortuneDimension>;
  coreRiskOpportunity: YearlyCoreRiskOpportunity;
  luckMethods: YearlyLuckMethods;
  preAnalysisVersion: string;
}

export interface YearlyFortuneResponse {
  year: number;
  profileId: string;
  profileBirthDate: string;
  profileBirthTime: string;
  engineOutput: YearlyFortuneEngineOutput;
  narrative: YearlyFortuneNarrative | null;
  cacheHit: boolean;
  generatedAt: string;
}

/**
 * Phase 3 Yearly Streaming — YEAR scope wire event types matching backend
 * `FortuneYearlyStreamEvent`. Mirrors monthly: `coreRiskOpportunity` +
 * `luckMethods` are SIBLINGS on `engine_ready` (engine camelCase), `cacheHit`
 * on `engine_ready`, `done` does NOT re-carry siblings (L5 spreads prev.data).
 */
export type FortuneYearlyStreamEvent =
  | {
      type: 'engine_ready';
      engineOutput: YearlyFortuneEngineOutput;
      profileId: string;
      profileBirthDate: string;
      profileBirthTime: string;
      year: number;
      cacheHit: boolean;
    }
  | { type: 'section_complete'; key: string; value: unknown }
  | { type: 'done'; narrative: YearlyFortuneNarrative | null; cacheHit: boolean }
  | { type: 'error'; code: string; message: string };

interface YearlyStreamOpts {
  token: string;
  profileId?: string;
  year?: string;        // 'YYYY'
  onEvent: (event: FortuneStreamEvent) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/**
 * Phase 3 — Open an SSE stream from `GET /api/fortune/yearly/stream`.
 * Mirror of `streamMonthlyFortune` for YEAR scope. Returns a teardown function.
 */
export function streamYearlyFortune(opts: YearlyStreamOpts): () => void {
  const controller = new AbortController();
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.year) params.set('year', opts.year);
  const url = `${API_BASE}/api/fortune/yearly/stream${params.toString() ? `?${params}` : ''}`;

  (async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      opts.onError(err as Error);
      opts.onClose();
      return;
    }

    if (!response.ok) {
      // Layer C — pre-flight 401 (session expired). Fortune streams are always
      // authenticated → redirect. Fire BEFORE emitting the error event.
      if (response.status === 401) {
        redirectToSignInOnExpiry();
      }
      let body: { message?: string; code?: string } = {};
      try {
        body = await response.json();
      } catch {
        // ignore
      }
      opts.onEvent({
        type: 'error',
        code: body.code || `HTTP_${response.status}`,
        message:
          body.message ||
          `Yearly fortune stream failed: ${response.status} ${response.statusText}`,
      });
      opts.onClose();
      return;
    }

    if (!response.body) {
      opts.onError(new Error('Yearly fortune stream: missing response body'));
      opts.onClose();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          dispatchFortuneFrame(frame, opts.onEvent);
          frameEnd = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim().length > 0) {
        dispatchFortuneFrame(buffer, opts.onEvent);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        opts.onError(err as Error);
      }
    } finally {
      opts.onClose();
    }
  })();

  return () => controller.abort();
}

// ------------------------------------------------------------
// Subscriber window — YEARLY scope (-1 / current / +4 per Seer's 6 pills)
// ------------------------------------------------------------

export const FREE_WINDOW_PAST_YEAR = 0;
export const FREE_WINDOW_FUTURE_YEAR = 0;
export const SUBSCRIBER_WINDOW_PAST_YEAR = 1;
export const SUBSCRIBER_WINDOW_FUTURE_YEAR = 4;

/** Resolve the current year in Asia/Taipei TZ → YYYY. */
export function resolveCurrentYearIso(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
  });
  return formatter.format(now);
}

/** True iff target YYYY is within the user's subscriber window. */
export function isYearInSubscriberWindow(
  targetYear: string,
  currentYear: string,
  tier: UserTier | undefined,
): boolean {
  const diff = parseInt(targetYear, 10) - parseInt(currentYear, 10);
  if (tier === undefined || tier === 'FREE') {
    return diff >= -FREE_WINDOW_PAST_YEAR && diff <= FREE_WINDOW_FUTURE_YEAR;
  }
  return (
    diff >= -SUBSCRIBER_WINDOW_PAST_YEAR && diff <= SUBSCRIBER_WINDOW_FUTURE_YEAR
  );
}

/** Map a 7-tier auspiciousness label to a UX-friendly yearly mood phrase. */
export function moodKeywordFromYearlyLabel(label: string): string {
  const map: Record<string, string> = {
    大吉: '今年順遂',
    吉: '今年可把握',
    吉中有凶: '今年吉中需謹慎',
    平: '今年平穩',
    凶中有吉: '今年凶中可轉機',
    小凶: '今年宜緩',
    凶: '今年宜守',
    大凶: '今年宜避鋒',
    凶上加凶: '今年大忌',
  };
  return map[label] ?? '今年平穩';
}
