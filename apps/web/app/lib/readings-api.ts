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

const SECTION_TITLE_MAP: Record<string, string> = {
  // Bazi sections
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

// ============================================================
// Types
// ============================================================

export interface NestJSReadingResponse {
  id: string;
  readingType: string;
  calculationData: Record<string, unknown>;
  aiInterpretation: {
    sections: Record<string, { preview: string; full: string }>;
    summary?: { preview: string; full: string };
  } | null;
  creditsUsed: number;
  createdAt: string;
  fromCache?: boolean;
}

interface ReadingSectionData {
  key: string;
  title: string;
  preview: string;
  full: string;
}

export interface AIReadingData {
  sections: ReadingSectionData[];
  summary?: { text: string };
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
  },
): Promise<NestJSReadingResponse> {
  return apiFetch<NestJSReadingResponse>('/api/bazi/readings', {
    method: 'POST',
    token,
    body: JSON.stringify({
      birthProfileId: params.birthProfileId,
      readingType: READING_TYPE_MAP[params.readingType], // slug → enum
      targetYear: params.targetYear,
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
 * Transform backend AI response (object keyed) → frontend array format.
 * Backend returns: { sections: { personality: { preview, full }, ... }, summary? }
 * Frontend expects: { sections: [{ key, title, preview, full }], summary? }
 */
export function transformAIResponse(
  ai: NestJSReadingResponse['aiInterpretation'],
): AIReadingData | null {
  if (!ai || !ai.sections) return null;

  const sections = Object.entries(ai.sections).map(([key, { preview, full }]) => ({
    key,
    title: SECTION_TITLE_MAP[key] || key,
    preview,
    full,
  }));

  const summary = ai.summary
    ? { text: ai.summary.full || ai.summary.preview }
    : undefined;

  return { sections, summary };
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
