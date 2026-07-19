/**
 * Fortune — Mobile API client.
 *
 * Faithful port of apps/web/app/lib/fortune-api.ts. Mobile adaptations:
 *  - API_BASE comes from `env.apiUrl` (Android localhost→10.0.2.2 rewrite).
 *  - The 3 SSE stream helpers (daily/monthly/yearly) are thin wrappers over the
 *    shared `openSseStream` seam (src/lib/stream.ts, backed by `expo/fetch`) —
 *    verified incremental on iOS + Android in the M2.1 spike.
 *  - The 2 non-streaming fetches use `notifyUnauthorized` (session-expiry sign
 *    out) in place of web's `redirectToSignInOnExpiry`.
 *  - All type definitions + pure Intl/window helpers are copied verbatim; they
 *    MUST stay in sync with apps/api/src/fortune/dto/index.ts (Phase 1.5.z
 *    lesson: mirror drift breaks the build).
 */

import { env } from './env';
import { notifyUnauthorized } from './api';
import { openSseStream } from './stream';

const API_BASE = env.apiUrl;

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
  score: number; // 0-100
  label: string; // 極佳/順遂/平穩/需謹慎/不利
  signals: FortuneSignal[];
}

export interface DailyFortuneNarrative {
  daily_overview: string;
  daily_romance: string;
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
  type: string;
  label: string;
}

// ---- Folk content (Phase 1.5.z) ----

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
  /** UI shows 「民俗」 badge — source classical (河圖) but 子平 modern-app density low. */
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
  /** 五行 mechanism reason MUST be cited in narrative. */
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
  auspiciousness: string; // 7-label
  energyScore: number; // 0-100 derived advisory
  metaFraming: 'soft_trigger';
  dimensions: Record<'romance' | 'career' | 'finance' | 'travel' | 'health', FortuneDimension>;
  dayEnergyAlignment?: {
    type: string;
    shift: number;
    valence: 'beneficial' | 'harmful' | 'neutral';
    narrative: string;
    metaFraming?: string;
    hehua?: Record<string, unknown>;
    kongWang?: Record<string, unknown>;
  };
  folkContent: {
    wealthDirection: {
      element: string;
      direction: string;
      provenance: 'classical';
      note: string;
    };
    luckyColor: FortuneLuckyColor | null;
    luckyNumber: FortuneLuckyNumber | null;
    luckyFoodFavor: FortuneLuckyFoodFavor | null;
    luckyFoodAvoid: FortuneLuckyFoodAvoid | null;
    auspiciousHours: FortuneAuspiciousHour[];
  };
  ruleTrace: string[];
  preAnalysisVersion: string;
  headlinerSignals?: {
    chartContext: HeadlinerAnchor[];
    triggers: HeadlinerAnchor[];
  };
}

export interface DailyFortuneResponse {
  date: string;
  profileId: string;
  profileBirthDate: string;
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
// Stream event unions — match backend fortune-stream.service.ts
// ============================================================

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
  | { type: 'done'; narrative: DailyFortuneNarrative | null; cacheHit: boolean }
  | { type: 'error'; code: string; message: string };

export type FortuneMonthlyStreamEvent =
  | {
      type: 'engine_ready';
      engineOutput: MonthlyFortuneResponse['engineOutput'];
      intraMonthBreakdown?: IntraMonthBreakdown;
      profileId: string;
      profileBirthDate: string;
      profileBirthTime: string;
      month: string;
      flowYear: number;
      cacheHit: boolean;
    }
  | { type: 'section_complete'; key: string; value: unknown }
  | { type: 'done'; narrative: MonthlyFortuneNarrative | null; cacheHit: boolean }
  | { type: 'error'; code: string; message: string };

/** Umbrella union for all scopes (single hook signature). */
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
  month?: string; // 'YYYY-MM'
  onEvent: (event: FortuneStreamEvent) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/**
 * Open an SSE stream from `GET /api/fortune/daily/stream`. Returns a teardown
 * function that aborts the underlying fetch + reader. Thin wrapper over the
 * shared `openSseStream` seam (expo/fetch).
 */
export function streamDailyFortune(opts: StreamOpts): () => void {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.date) params.set('date', opts.date);
  const url = `${API_BASE}/api/fortune/daily/stream${params.toString() ? `?${params}` : ''}`;
  return openSseStream<FortuneStreamEvent>({
    url,
    token: opts.token,
    label: 'DailyFortune',
    onEvent: opts.onEvent,
    onError: opts.onError,
    onClose: opts.onClose,
  });
}

/** Open an SSE stream from `GET /api/fortune/monthly/stream`. */
export function streamMonthlyFortune(opts: MonthlyStreamOpts): () => void {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.month) params.set('month', opts.month);
  const url = `${API_BASE}/api/fortune/monthly/stream${params.toString() ? `?${params}` : ''}`;
  return openSseStream<FortuneStreamEvent>({
    url,
    token: opts.token,
    label: 'MonthlyFortune',
    onEvent: opts.onEvent,
    onError: opts.onError,
    onClose: opts.onClose,
  });
}

// ============================================================
// Non-streaming fetch — GET /api/fortune/daily (engineOnly fast path)
// ============================================================

interface FetchOpts {
  token: string;
  profileId?: string;
  date?: string; // YYYY-MM-DD; client resolves 23:00 子時 boundary
  signal?: AbortSignal;
  /** When true, server returns engine output WITHOUT AI narration (fast). */
  engineOnly?: boolean;
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
    if (response.status === 401) notifyUnauthorized();
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
// Local helpers (Intl-based — Asia/Taipei is the platform's canonical TZ)
// ============================================================

/**
 * Resolve the current Bazi day from clock time. Bazi day flips at 23:00 (子時)
 * in Asia/Taipei wall-clock time → if Taipei clock is 23:00+, the Bazi day is
 * TOMORROW's Taipei calendar date. Byte-identical to backend todayIsoDate().
 * Returns YYYY-MM-DD.
 */
export function resolveBaziToday(now: Date = new Date()): string {
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
 * counterpart to resolveBaziToday(). Used to detect + explain the 23:00–24:00
 * 子時 rollover in the UI.
 */
export function civilTodayTaipei(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// ---- Subscriber window math (mirrors fortune.service.ts) ----

export const FREE_WINDOW_PAST = 0;
export const FREE_WINDOW_FUTURE = 0;
export const SUBSCRIBER_WINDOW_PAST = 1;
export const SUBSCRIBER_WINDOW_FUTURE = 30;

export type UserTier = 'FREE' | 'BASIC' | 'PRO' | 'MASTER';

/** Add `n` days to an ISO YYYY-MM-DD string. Negative subtracts. */
export function addDaysIso(iso: string, n: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]!), Number(m[2]!) - 1, Number(m[3]!));
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

/** Difference (target - reference) in whole days. Both YYYY-MM-DD. */
export function diffDaysIso(target: string, reference: string): number {
  const tm = target.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const rm = reference.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!tm || !rm) return 0;
  const t = new Date(Number(tm[1]!), Number(tm[2]!) - 1, Number(tm[3]!));
  const r = new Date(Number(rm[1]!), Number(rm[2]!) - 1, Number(rm[3]!));
  return Math.round((t.getTime() - r.getTime()) / 86_400_000);
}

/** True iff `targetIso` is within the user's day window relative to `todayBaziIso`. */
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

/** Map a 7-tier auspiciousness label to a display tier for coloring. */
export function tierOf(label: string): 'positive' | 'neutral' | 'negative' {
  if (['大吉', '吉', '吉中有凶'].includes(label)) return 'positive';
  if (['凶中有吉', '平'].includes(label)) return 'neutral';
  return 'negative';
}

// ============================================================
// MONTHLY (八字月運) — mirror of apps/api dto/index.ts MONTHLY DTOs
// ============================================================

export interface PartitionBucket {
  label: string;
  day_range: [number, number | null];
  /** DOCTRINE-BEARING — referenced by anti-hallucination clause 5. */
  governing_pillar: 'stem' | 'branch';
}

export interface PartitionSpec {
  scheme_id: 'tiangan_dizhi_half';
  buckets: PartitionBucket[];
}

export interface MonthlyFortuneDimension {
  score: number;
  label: string;
  labelZh: string;
  signals: string[];
}

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

export interface MonthlyFortuneResponse {
  month: string; // YYYY-MM
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

interface FetchMonthlyOpts {
  token: string;
  profileId?: string;
  month?: string; // YYYY-MM
  signal?: AbortSignal;
}

export async function fetchMonthlyFortune(opts: FetchMonthlyOpts): Promise<MonthlyFortuneResponse> {
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
    if (response.status === 401) notifyUnauthorized();
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

// ---- Subscriber window — MONTHLY scope (-1 / current / +12 INCLUSIVE) ----

export const FREE_WINDOW_PAST_MONTH = 0;
export const FREE_WINDOW_FUTURE_MONTH = 0;
export const SUBSCRIBER_WINDOW_PAST_MONTH = 1;
export const SUBSCRIBER_WINDOW_FUTURE_MONTH = 12;

/** Add `n` months to a YYYY-MM string (handles year boundary). */
export function addMonthsIso(monthIso: string, n: number): string {
  const m = monthIso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthIso;
  let year = Number(m[1]!);
  let month = Number(m[2]!) - 1 + n; // 0-indexed
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

/** True iff target YYYY-MM is within the user's subscriber window. */
export function isMonthInSubscriberWindow(
  targetMonth: string,
  currentMonth: string,
  tier: UserTier | undefined,
): boolean {
  const diff = diffMonthsIso(targetMonth, currentMonth);
  if (tier === undefined || tier === 'FREE') {
    return diff >= -FREE_WINDOW_PAST_MONTH && diff <= FREE_WINDOW_FUTURE_MONTH;
  }
  return diff >= -SUBSCRIBER_WINDOW_PAST_MONTH && diff <= SUBSCRIBER_WINDOW_FUTURE_MONTH;
}

/** Resolve the current month in Asia/Taipei TZ → YYYY-MM. */
export function resolveCurrentMonthIso(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  });
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
// 年運 (Yearly Fortune) — mirror of apps/api dto/index.ts
// ============================================================

export interface YearlyFortuneDimension {
  score: number;
  label: string;
  stars: number; // ★1-5
  labelZh: string;
}

export interface YearlyRiskOpportunityEntry {
  month: number;
  monthLabel: string; // «N月»
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
  year?: string; // 'YYYY'
  onEvent: (event: FortuneStreamEvent) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/** Open an SSE stream from `GET /api/fortune/yearly/stream`. */
export function streamYearlyFortune(opts: YearlyStreamOpts): () => void {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.year) params.set('year', opts.year);
  const url = `${API_BASE}/api/fortune/yearly/stream${params.toString() ? `?${params}` : ''}`;
  return openSseStream<FortuneStreamEvent>({
    url,
    token: opts.token,
    label: 'YearlyFortune',
    onEvent: opts.onEvent,
    onError: opts.onError,
    onClose: opts.onClose,
  });
}

// ---- Subscriber window — YEARLY scope (-1 / current / +4) ----

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
  return diff >= -SUBSCRIBER_WINDOW_PAST_YEAR && diff <= SUBSCRIBER_WINDOW_FUTURE_YEAR;
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
