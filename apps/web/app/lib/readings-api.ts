/**
 * API client for creating and fetching readings via NestJS backend.
 * Handles slug → backend enum mapping internally.
 */

import { apiFetch } from './api';

// ============================================================
// Slug → Backend Enum Mapping
// ============================================================

const READING_TYPE_MAP: Record<string, string> = {
  lifetime: 'LIFETIME',
  annual: 'ANNUAL',
  career: 'CAREER',
  love: 'LOVE',
  health: 'HEALTH',
  'zwds-lifetime': 'ZWDS_LIFETIME',
  'zwds-annual': 'ZWDS_ANNUAL',
  'zwds-career': 'ZWDS_CAREER',
  'zwds-love': 'ZWDS_LOVE',
  'zwds-health': 'ZWDS_HEALTH',
  'zwds-monthly': 'ZWDS_MONTHLY',
  'zwds-daily': 'ZWDS_DAILY',
  'zwds-major-period': 'ZWDS_MAJOR_PERIOD',
  'zwds-qa': 'ZWDS_QA',
};

// Note: compatibility, zwds-compatibility, cross-system, deep-stars
// use different endpoints — not in this map.

const COMPARISON_TYPE_MAP: Record<string, string> = {
  romance: 'ROMANCE',
  business: 'BUSINESS',
  friendship: 'FRIENDSHIP',
};

// ============================================================
// Section Title Map (backend key → zh-TW display title)
// ============================================================

export const SECTION_TITLE_MAP: Record<string, string> = {
  // Bazi sections (V1)
  personality: '命格性格分析',
  career: '事業發展分析',
  career_analysis: '事業深度分析',
  favorable_industries: '利於發展的行業',
  career_timing: '事業發展時機',
  love: '感情婚姻分析',
  ideal_partner: '理想伴侶特質',
  marriage_timing: '姻緣時機',
  relationship_advice: '感情經營建議',
  finance: '一生財運分析',
  health: '先天健康分析',
  constitution: '先天體質分析',
  wellness_advice: '養生保健建議',
  health_timing: '健康注意時期',
  annual_overview: '年度總覽',
  monthly_forecast: '每月運勢',
  key_opportunities: '關鍵機遇',
  overall_compatibility: '整體契合度分析',
  strengths: '優勢互補',
  challenges: '挑戰與磨合',
  compatibility_advice: '相處建議',
  cross_analysis: '十神交叉分析',
  timing: '時運同步度',
  // Bazi Lifetime V2 sections
  chart_identity: '先天命格解讀',
  finance_pattern: '財運格局解讀',
  career_pattern: '事業格局解讀',
  boss_strategy: '應對上司之道',
  love_pattern: '感情格局解讀',
  children_analysis: '子女分析',
  parents_analysis: '父母情況分析',
  current_period: '當前大運詳解',
  next_period: '下一大運詳解',
  best_period: '有利大運把握',
  annual_love: '本年感情運勢',
  annual_career: '本年事業運勢',
  annual_finance: '本年財運運勢',
  annual_health: '本年健康運勢',
  // Bazi Career V2 sections
  suitable_positions: '適合職位分析',
  career_directions_favorable: '有利行業方向',
  career_directions_unfavorable: '不利行業方向',
  company_type_fit: '公司類型適配',
  entrepreneurship: '創業適合度分析',
  partnership: '合夥適合度分析',
  career_allies: '職場貴人與小人',
  // ZWDS sections
  life_pattern: '人生格局分析',
  major_periods: '大限走勢分析',
  overall_destiny: '一生命運總評',
  annual_advice: '年度建議',
  career_palace: '事業宮分析',
  wealth_palace: '財帛宮分析',
  career_direction: '事業發展方向',
  spouse_palace: '夫妻宮分析',
  love_timing: '感情時機',
  health_palace: '疾厄宮分析',
  element_health: '五行局健康分析',
  health_periods: '健康注意時期',
  palace_interaction: '宮位互動分析',
  star_compatibility: '星曜契合分析',
  advice: '綜合建議',
  // ZWDS Monthly
  monthly_overview: '本月運勢總覽',
  monthly_career: '本月事業運',
  monthly_love: '本月感情運',
  monthly_health: '本月健康運',
  monthly_advice: '本月行動建議',
  // ZWDS Daily
  daily_fortune: '今日運勢',
  // ZWDS Major Period
  period_overview: '大限運勢總覽',
  period_career: '大限事業運',
  period_relationships: '大限人際關係',
  period_health: '大限健康運',
  period_strategy: '大限發展策略',
  // ZWDS Q&A
  answer: '問題解答',
  analysis: '命盤分析',
};

/** Guide-style section title overrides (人生攻略 framing) */
export const GUIDE_SECTION_TITLE_MAP: Record<string, string> = {
  // Lifetime V2
  chart_identity: '你的先天屬性',
  finance_pattern: '財富攻略',
  career_pattern: '事業發展路線',
  boss_strategy: '應對上司之道',
  love_pattern: '愛情攻略',
  health: '健康管理',
  children_analysis: '子女關係',
  parents_analysis: '父母關係',
  current_period: '當前大運詳解',
  next_period: '下一大運預覽',
  best_period: '最佳大運攻略',
  // Career V2
  suitable_positions: '適合你的職位',
  career_directions_favorable: '有利行業方向',
  career_directions_unfavorable: '需要注意的行業',
  company_type_fit: '適合的公司類型',
  entrepreneurship: '創業潛力分析',
  partnership: '合夥經營評估',
  career_allies: '職場貴人與小人',
};

// ============================================================
// Types
// ============================================================

/** Career direction entry from deterministic data */
export interface CareerDirectionData {
  anchor: string;
  category: string;
  industries: string[];
}

/** Enriched luck period from deterministic data */
export interface LuckPeriodDetailData {
  stem: string;
  branch: string;
  startAge: number;
  endAge: number;
  startYear: number;
  endYear: number;
  tenGod?: string;
  stemTenGod?: string;
  branchTenGod?: string;
  score: number;
  stemPhase: string;
  branchPhase: string;
  interactions: string[];
  isCurrent: boolean;
  periodOrdinal?: number;  // 1-based period ordinal (第N大運)
  stemElement?: string;    // Five-element of stem (木/火/土/金/水)
  branchElement?: string;  // Five-element of branch main qi
}

/** V2 deterministic data (not AI-generated) — Lifetime */
export interface LifetimeV2DeterministicData {
  favorableInvestments: string[];
  unfavorableInvestments: string[];
  careerDirections: CareerDirectionData[];
  favorableDirection: string;
  careerBenefactorsElement: string[];
  careerBenefactorsZodiac: string[];
  partnerElement: string[];
  partnerZodiac: string[];
  romanceYears: number[];
  romanceWarningYears?: number[];
  parentHealthYears: { father: number[]; mother: number[] };
  luckPeriodsEnriched: LuckPeriodDetailData[];
  bestPeriod: LuckPeriodDetailData | null;
  annualTenGod: string;
}

/** V2 deterministic data (not AI-generated) — Career */
export interface CareerV2DeterministicData {
  weightedElements: Record<string, { percentage: number; level: string; talents: string[] }>;
  weightedTenGods: Record<string, { percentage: number; level: string; capabilities: string[] }>;
  reputationScore: { score: number; level: string; subScores: Record<string, number> };
  wealthScore: { score: number; tier: string; subScores: Record<string, number> };
  fiveQiStates: Record<string, string>;
  pattern: string;
  patternType: string;
  activeLuckPeriod: {
    stem: string;
    branch: string;
    tenGod: string;
    startYear: number;
    endYear: number;
  } | null;
  suitablePositions: Array<{ label: string; description: string; anchors: string[] }>;
  companyTypeFit: { type: string; label: string; description: string };
  entrepreneurshipFit: { score: number; type: string; reasons: string[] };
  partnershipFit: { score: number; suitable: boolean; reasons: string[] };
  careerAllies: {
    nobles: Array<{ type: string; branch: string; description: string }>;
    careerShensha: Array<{ name: string; description: string }>;
    allies: string[];
    mobilityBringers: string[];
    enemies: string[];
    antagonists: Array<{ type: string; description: string }>;
    elementHelpers: string[];
  };
  annualForecasts: Array<{
    year: number;
    stem: string;
    branch: string;
    tenGod: string;
    luckPeriodStem: string;
    luckPeriodBranch: string;
    luckPeriodTenGod: string;
    auspiciousness: string;
    branchInteractions: string[];
    kongWangAnalysis?: { hit: boolean; effect: string; favorable: boolean };
    yimaAnalysis?: { hit: boolean; favorable: boolean; type: string };
    careerIndicators: string[];
  }>;
  monthlyForecasts: Array<{
    month: number;
    stem: string;
    branch: string;
    tenGod: string;
    auspiciousness: string;
    monthName: string;
    solarTermDate: string;
    solarTermEndDate?: string;
    seasonElement: string;
  }>;
  favorableIndustries: string[];
  unfavorableIndustries: string[];
}

/** Union type for V2 deterministic data */
export type V2DeterministicData = LifetimeV2DeterministicData | CareerV2DeterministicData;

export interface NestJSReadingResponse {
  id: string;
  readingType: string;
  calculationData: Record<string, unknown>;
  aiInterpretation: {
    schemaVersion?: 'v2';
    sections: Record<string, { preview: string; full: string; score?: number }>;
    summary?: { preview: string; full: string };
    deterministic?: V2DeterministicData;
  } | null;
  creditsUsed: number;
  createdAt: string;
  fromCache?: boolean;
  /** Present when stream=true was requested and AI will be streamed via SSE */
  streamReady?: boolean;
  /** Deterministic data returned immediately for streaming requests */
  deterministic?: V2DeterministicData;
  /** Birth profile data — present when fetching a saved reading (via Prisma include) */
  birthProfile?: {
    name: string;
    birthDate: string;
    birthTime: string;
    gender: 'MALE' | 'FEMALE';
    birthCity: string;
    birthTimezone: string;
    isLunarDate: boolean;
    isLeapMonth: boolean;
  };
}

interface ReadingSectionData {
  key: string;
  title: string;
  preview: string;
  full: string;
  score?: number;
}

export interface AIReadingData {
  sections: ReadingSectionData[];
  summary?: { text: string };
  isV2?: boolean;
  deterministic?: V2DeterministicData;
}

export interface ReadingHistoryItem {
  id: string;
  readingType: string;
  creditsUsed: number;
  createdAt: string;
  birthProfile: {
    name: string;
    birthDate: string;
  };
  // Comparison-specific fields (present when isComparison = true)
  isComparison?: boolean;
  comparisonType?: string;
  profileB?: {
    name: string;
    birthDate: string;
  };
}

export interface ReadingHistoryResponse {
  data: ReadingHistoryItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Compatibility-specific types
export type ComparisonType = 'ROMANCE' | 'BUSINESS' | 'FRIENDSHIP';

export interface CompatibilityDimensionScore {
  rawScore: number;
  amplifiedScore: number;
  weightedScore: number;
  weight: number;
  findings?: Array<Record<string, unknown>>;
}

export interface KnockoutCondition {
  type: string;
  severity: string;
  description: string;
  scoreImpact: number;
  mitigated?: boolean;
  originalImpact?: number;
}

export interface CompatibilityCalculationData {
  overallScore: number;
  adjustedScore: number;
  label: string;
  specialLabel: string | null;
  labelDescription: string;
  dimensionScores: Record<string, CompatibilityDimensionScore>;
  knockoutConditions: KnockoutCondition[];
  specialFindings: Record<string, unknown>;
  timingSync: {
    goldenYears: Array<{ year: number; reason: string }>;
    challengeYears: Array<{ year: number; reason: string }>;
    luckCycleSyncScore: number;
  };
  comparisonType: string;
  chartA: Record<string, unknown>;
  chartB: Record<string, unknown>;
}

export interface CompatibilityResponse {
  id: string;
  comparisonType: string;
  calculationData: CompatibilityCalculationData;
  aiInterpretation: {
    sections: Record<string, { preview: string; full: string }>;
    summary?: { preview: string; full: string };
  } | null;
  creditsUsed: number;
  lastCalculatedYear?: number;
  createdAt: string;
  profileA?: { name: string; birthDate: string };
  profileB?: { name: string; birthDate: string };
}

// ============================================================
// API Functions
// ============================================================

/**
 * Create a Bazi reading via NestJS (chart + AI + credits + DB).
 * Slug → enum mapping happens internally.
 */
export async function createBaziReading(
  token: string,
  params: {
    birthProfileId: string;
    readingType: string; // frontend slug e.g. "lifetime"
    targetYear?: number;
    stream?: boolean;
  },
): Promise<NestJSReadingResponse> {
  return apiFetch<NestJSReadingResponse>('/api/bazi/readings', {
    method: 'POST',
    token,
    body: JSON.stringify({
      birthProfileId: params.birthProfileId,
      readingType: READING_TYPE_MAP[params.readingType], // slug → enum
      targetYear: params.targetYear,
      ...(params.stream && { stream: true }),
    }),
  });
}

/**
 * Create a ZWDS reading via NestJS (chart + AI + credits + DB).
 * Slug → enum mapping happens internally.
 */
export async function createZwdsReading(
  token: string,
  params: {
    birthProfileId: string;
    readingType: string; // frontend slug e.g. "zwds-career"
    targetYear?: number;
    targetMonth?: number;
    targetDay?: string;
    questionText?: string;
  },
): Promise<NestJSReadingResponse> {
  return apiFetch<NestJSReadingResponse>('/api/zwds/readings', {
    method: 'POST',
    token,
    body: JSON.stringify({
      birthProfileId: params.birthProfileId,
      readingType: READING_TYPE_MAP[params.readingType], // slug → enum
      ...(params.targetYear && { targetYear: params.targetYear }),
      ...(params.targetMonth && { targetMonth: params.targetMonth }),
      ...(params.targetDay && { targetDay: params.targetDay }),
      ...(params.questionText && { questionText: params.questionText }),
    }),
  });
}

/**
 * Fetch a saved reading by ID.
 * Works for both Bazi and ZWDS readings (same DB table).
 */
export async function getReading(
  token: string,
  id: string,
): Promise<NestJSReadingResponse> {
  return apiFetch<NestJSReadingResponse>(`/api/bazi/readings/${id}`, { token });
}

/**
 * Fetch reading history for the current user.
 */
export async function getReadingHistory(
  token: string,
  page = 1,
  limit = 20,
): Promise<ReadingHistoryResponse> {
  return apiFetch<ReadingHistoryResponse>(
    `/api/users/me/readings?page=${page}&limit=${limit}`,
    { token },
  );
}

// ============================================================
// AI Response Transformer
// ============================================================

/**
 * Career V2 section display order (controls rendering sequence).
 * Annual and monthly forecast sections are dynamically matched by prefix.
 */
export const CAREER_V2_SECTION_ORDER = [
  'career_pattern',
  'suitable_positions',
  'career_directions_favorable',
  'career_directions_unfavorable',
  'company_type_fit',
  'entrepreneurship',
  'partnership',
  'career_allies',
  // annual_forecast_YYYY and monthly_forecast_MM are appended dynamically
];

/** All expected career V2 section keys (for progress tracking) */
export const CAREER_V2_ALL_SECTION_KEYS = [
  'career_pattern',
  'suitable_positions',
  'career_directions_favorable',
  'career_directions_unfavorable',
  'company_type_fit',
  'entrepreneurship',
  'partnership',
  'career_allies',
  // 5 annual + 12 monthly = 17 dynamic keys added at runtime
];

/**
 * Lifetime V2 section display order (controls rendering sequence).
 * Sections not in this list are appended at the end.
 */
const V2_SECTION_ORDER = [
  'chart_identity',
  'finance_pattern',
  'career_pattern',
  'boss_strategy',
  'love_pattern',
  'health',
  'children_analysis',
  'parents_analysis',
  'current_period',
  'next_period',
  'best_period',
  'annual_love',
  'annual_career',
  'annual_finance',
  'annual_health',
];

/**
 * Generate a display title for dynamic section keys (annual/monthly forecasts).
 * e.g., "annual_forecast_2026" → "2026 年度事業運勢"
 * e.g., "monthly_forecast_03" → "3月運勢"
 */
export function getDynamicSectionTitle(key: string): string | null {
  const annualMatch = key.match(/^annual_forecast_(\d{4})$/);
  if (annualMatch) return `${annualMatch[1]} 年度事業運勢`;

  const monthlyMatch = key.match(/^monthly_forecast_(\d{1,2})$/);
  if (monthlyMatch) return `${parseInt(monthlyMatch[1], 10)}月運勢`;

  return null;
}

/**
 * Transform backend AI response (object keyed) → frontend array format.
 * Backend returns: { sections: { personality: { preview, full }, ... }, summary? }
 * Frontend expects: { sections: [{ key, title, preview, full }], summary? }
 *
 * V2 readings (lifetime, career) also carry deterministic data and schemaVersion.
 */
export function transformAIResponse(
  ai: NestJSReadingResponse['aiInterpretation'],
): AIReadingData | null {
  if (!ai || !ai.sections) return null;

  const isV2 = ai.schemaVersion === 'v2';

  // Build sections array — V2 uses explicit order, V1 preserves insertion order
  let sections: ReadingSectionData[];
  if (isV2) {
    const sectionKeys = Object.keys(ai.sections);
    // Detect career V2 by presence of career-specific section keys
    const isCareerV2 = sectionKeys.some(k =>
      k === 'suitable_positions' || k === 'company_type_fit' || k === 'entrepreneurship'
    );
    const orderList = isCareerV2 ? CAREER_V2_SECTION_ORDER : V2_SECTION_ORDER;

    const sectionEntries = Object.entries(ai.sections);
    const ordered: ReadingSectionData[] = [];
    const seen = new Set<string>();

    // First: add sections in the explicit order
    for (const key of orderList) {
      const entry = sectionEntries.find(([k]) => k === key);
      if (entry) {
        const title = getDynamicSectionTitle(entry[0]) || SECTION_TITLE_MAP[entry[0]] || entry[0];
        ordered.push({
          key: entry[0],
          title,
          preview: entry[1].preview,
          full: entry[1].full,
          score: entry[1].score,
        });
        seen.add(entry[0]);
      }
    }

    // For career V2: append annual forecasts sorted by year, then monthly sorted by month
    if (isCareerV2) {
      const annuals = sectionEntries
        .filter(([k]) => k.startsWith('annual_forecast_') && !seen.has(k))
        .sort(([a], [b]) => a.localeCompare(b));
      const monthlies = sectionEntries
        .filter(([k]) => k.startsWith('monthly_forecast_') && !seen.has(k))
        .sort(([a], [b]) => {
          const ma = parseInt(a.replace('monthly_forecast_', ''), 10);
          const mb = parseInt(b.replace('monthly_forecast_', ''), 10);
          return ma - mb;
        });

      for (const [key, { preview, full, score }] of [...annuals, ...monthlies]) {
        const title = getDynamicSectionTitle(key) || SECTION_TITLE_MAP[key] || key;
        ordered.push({ key, title, preview, full, score });
        seen.add(key);
      }
    }

    // Append any remaining sections not in the explicit order
    for (const [key, { preview, full, score }] of sectionEntries) {
      if (!seen.has(key)) {
        const title = getDynamicSectionTitle(key) || SECTION_TITLE_MAP[key] || key;
        ordered.push({ key, title, preview, full, score });
      }
    }

    sections = ordered;
  } else {
    sections = Object.entries(ai.sections).map(([key, { preview, full, score }]) => ({
      key,
      title: SECTION_TITLE_MAP[key] || key,
      preview,
      full,
      score,
    }));
  }

  const summary = ai.summary
    ? { text: ai.summary.full || ai.summary.preview }
    : undefined;

  return {
    sections,
    summary,
    isV2,
    deterministic: isV2 ? ai.deterministic : undefined,
  };
}

// ============================================================
// SSE Streaming Client
// ============================================================

/**
 * Stream AI interpretation for a LIFETIME reading via SSE.
 * Uses fetch() + ReadableStream (NOT EventSource) for proper auth headers.
 * Returns a cleanup handle to abort the stream.
 */
export function streamBaziReading(
  token: string,
  readingId: string,
  callbacks: {
    onSectionComplete: (key: string, section: { preview: string; full: string; score?: number }) => void;
    onCallComplete: (callNumber: number) => void;
    onSummary: (summary: { preview: string; full: string }) => void;
    onDone: (info: { totalSections: number; latencyMs: number }) => void;
    onError: (error: { message: string; partial?: boolean }) => void;
  },
): { close: () => void } {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const url = `${API_BASE}/api/bazi/readings/${readingId}/stream`;
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        callbacks.onError({ message: (err as Record<string, string>).message || `HTTP ${response.status}` });
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer (events separated by double newline)
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep incomplete event in buffer

        for (const eventStr of events) {
          if (!eventStr.trim() || eventStr.startsWith(':')) continue; // Skip heartbeats/comments
          const typeMatch = eventStr.match(/^event:\s*(.+)$/m);
          const dataMatch = eventStr.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;

          const type = typeMatch?.[1]?.trim() || 'message';
          if (type === 'heartbeat') continue;

          try {
            const data = JSON.parse(dataMatch[1]?.trim() || '{}');
            switch (type) {
              case 'section_complete':
                callbacks.onSectionComplete(data.key, data);
                break;
              case 'call_complete':
                callbacks.onCallComplete(data.call);
                break;
              case 'summary':
                callbacks.onSummary(data);
                break;
              case 'done':
                callbacks.onDone(data);
                break;
              case 'error':
                callbacks.onError(data);
                break;
            }
          } catch {
            // Malformed JSON in event data, skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        callbacks.onError({ message: (err as Error).message || 'Stream failed' });
      }
    }
  })();

  return { close: () => controller.abort() };
}

// ============================================================
// Compatibility API Functions
// ============================================================

/**
 * Create a Bazi compatibility comparison via NestJS (chart + AI + credits + DB).
 * Frontend slug → backend enum mapping happens internally.
 */
export async function createBaziCompatibility(
  token: string,
  params: {
    profileAId: string;
    profileBId: string;
    comparisonType: string; // frontend slug: 'romance' | 'business' | 'friendship'
    skipAI?: boolean;
  },
): Promise<CompatibilityResponse> {
  return apiFetch<CompatibilityResponse>('/api/bazi/comparisons', {
    method: 'POST',
    token,
    body: JSON.stringify({
      profileAId: params.profileAId,
      profileBId: params.profileBId,
      comparisonType: COMPARISON_TYPE_MAP[params.comparisonType] || params.comparisonType,
      ...(params.skipAI && { skipAI: true }),
    }),
  });
}

/**
 * Fetch a saved compatibility comparison by ID.
 */
export async function getCompatibility(
  token: string,
  id: string,
): Promise<CompatibilityResponse> {
  return apiFetch<CompatibilityResponse>(`/api/bazi/comparisons/${id}`, { token });
}

/**
 * Fetch compatibility comparison history for the current user.
 */
export async function getCompatibilityHistory(
  token: string,
  page = 1,
  limit = 20,
): Promise<ReadingHistoryResponse> {
  return apiFetch<ReadingHistoryResponse>(
    `/api/users/me/comparisons?page=${page}&limit=${limit}`,
    { token },
  );
}

/**
 * Re-calculate a compatibility comparison with the current year's timing.
 * Costs 1 credit. Updates the existing record in-place.
 */
export async function recalculateCompatibility(
  token: string,
  id: string,
): Promise<CompatibilityResponse> {
  return apiFetch<CompatibilityResponse>(`/api/bazi/comparisons/${id}/recalculate`, {
    method: 'POST',
    token,
  });
}

/**
 * Generate AI interpretation for an existing comparison (created with skipAI=true).
 * No additional credits charged. Supports AbortSignal for cancellation.
 */
export async function generateCompatibilityAI(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<CompatibilityResponse> {
  return apiFetch<CompatibilityResponse>(`/api/bazi/comparisons/${id}/generate-ai`, {
    method: 'POST',
    token,
    signal,
  });
}
