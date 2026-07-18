/**
 * API client for creating, fetching + streaming paid AI readings via the NestJS
 * backend. RN port of apps/web/app/lib/readings-api.ts, trimmed to the five
 * Bazi reading surfaces (LIFETIME / ANNUAL / CAREER / LOVE + COMPATIBILITY
 * 合盤). ZWDS is a v1 non-goal. The COMPATIBILITY (M5) additions are grouped
 * at the bottom of the file.
 *
 * The SSE stream uses `event: <type>\ndata: <json>` frames (type in the SSE
 * event line, NOT inside the JSON like the fortune streams), so it passes a
 * custom `parseFrame` to the shared `openSseStream` seam.
 */
import { env } from './env';
import { apiFetch } from './api';
import { openSseStream } from './stream';
import { LOVE_V2_SECTION_KEYS } from '@repo/shared';

const API_BASE = env.apiUrl;

// ============================================================
// Slug → Backend Enum Mapping (Bazi only)
// ============================================================

const READING_TYPE_MAP: Record<string, string> = {
  lifetime: 'LIFETIME',
  annual: 'ANNUAL',
  career: 'CAREER',
  love: 'LOVE',
};

/** Compat frontend slug → backend ComparisonType enum. */
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
  // Bazi Annual V2 sections (keys not already in V1 lifetime above)
  annual_tai_sui: '太歲分析',
  annual_dayun_context: '大運背景',
  annual_relationships: '人際關係',
  annual_family: '家庭關係',
  monthly_01: '一月運程', monthly_02: '二月運程', monthly_03: '三月運程',
  monthly_04: '四月運程', monthly_05: '五月運程', monthly_06: '六月運程',
  monthly_07: '七月運程', monthly_08: '八月運程', monthly_09: '九月運程',
  monthly_10: '十月運程', monthly_11: '十一月運程', monthly_12: '十二月運程',
  // Bazi Love V2 sections
  love_personality: '你的戀愛性格',
  peach_blossom_analysis: '先天桃花運',
  natal_marriage: '本命姻緣',
  partner_matching: '婚配建議',
  spouse_appearance: '對象性格與相貌',
  romance_good_years: '桃花運好的年份',
  romance_danger_years: '需要注意桃花劫的年份',
  marriage_change_years: '感情容易生變的年份',
  love_summary: '感情綜合建議',
  // V1 legacy keys (for existing cached readings)
  career_annual: '事業運勢',
  love_annual: '感情運勢',
  health_annual: '健康運勢',
  // Compatibility (合盤) V2 romance sections
  compatibility_basis: '配對基礎分析',
  chart_profile_a: '男方命局特點',
  chart_profile_b: '女方命局特點',
  love_personality_a: '男方戀愛性格',
  love_personality_b: '女方戀愛性格',
  spouse_enrichment_a: '旺妻/旺夫程度',
  spouse_enrichment_b: '旺夫/旺妻程度',
  marriage_wealth_a: '男方婚前婚後財富',
  marriage_wealth_b: '女方婚前婚後財富',
  post_marriage_sweetness: '婚後感情甜蜜度',
  post_marriage_stability: '婚後生活穩定度',
  marriage_crisis_a: '男方婚變情況預測',
  marriage_crisis_b: '女方婚變情況預測',
  combined_crisis_analysis: '兩人合婚危機分析',
  marriage_advice: '經營婚姻建議',
  annual_love_a: '男方感情運',
  annual_love_b: '女方感情運',
  compatibility_summary: '感情綜合總結',
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
  // Annual V2
  annual_overview: '流年總述',
  annual_tai_sui: '太歲分析',
  annual_dayun_context: '大運背景',
  annual_career: '事業運勢',
  annual_finance: '財運收入',
  annual_relationships: '人際關係',
  annual_love: '愛情姻緣',
  annual_family: '家庭關係',
  annual_health: '健康狀況',
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
// Types (verbatim from web)
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
  periodOrdinal?: number;
  stemElement?: string;
  branchElement?: string;
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
  dayPillarDetailed?: {
    title: string;
    subtitle: string;
    coreImage: string;
    personality: string;
    career: string;
    relationships: string;
    advice: string;
  } | null;
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

/** V2 deterministic data (not AI-generated) — Annual */
export interface AnnualV2DeterministicData {
  flowYear: { stem: string; branch: string; year: number; tenGod: string; auspiciousness: string };
  flowYearHarmony: { pattern: string; description: string };
  taiSui: {
    hasTaiSui: boolean;
    summary: string;
    pillarResults: Array<{
      pillar: string;
      types: string[];
      branchRole: string;
      isActuallyFavorable: boolean;
      affectedPalace: string;
    }>;
  };
  dayunContext: {
    available: boolean;
    stem: string;
    branch: string;
    tenGod: string;
    role: string;
    favorability: string;
    startYear: number;
    endYear: number;
  };
  career: {
    flowYearTenGod: string;
    tenGodRole: string;
    auspiciousness: string;
    signals: Array<{ type: string; impact: string }>;
    shenShaSignals: string[];
  };
  finance: {
    wealthPresent: boolean;
    wealthCondition: string;
    signals: Array<{ type: string; impact: string; detail: string }>;
  };
  marriageStar: {
    romanceLevel: string;
    romanceScore: number;
    trackCount: number;
    tracks: Array<{ track: string; active: boolean; trackType: string; detail: string }>;
  };
  relationships: {
    palaceRelationships: Record<string, {
      palace: string;
      status: string;
      interactions: Array<{ type: string; detail: string }>;
    }>;
  };
  sealStar: {
    isSealYear: boolean;
    sealRole: string;
    signals: Array<{ type: string; impact: string }>;
  };
  health: {
    lifeStage: string;
    healthVitality: { vitality: string; label: string };
    yangrenDanger: boolean;
    riskOrgans: Array<{ element: string; organs: string; source: string }>;
    elementWarnings: Array<{ element: string; condition: string; source: string; detail: string }>;
  };
  luYangRen: {
    luShen: { active: boolean; favorable: boolean };
    yangRen: { active: boolean; favorable: boolean; dangerLevel: string };
  };
  monthlyForecasts: Array<{
    monthIndex: number;
    monthStem: string;
    monthBranch: string;
    monthTenGod: string;
    auspiciousness: string;
    isKongWang: boolean;
    stemBase: string;
    branchBase: string;
    aspects: {
      career: { tenGod: string; signals: string[] };
      finance: { signals: string[] };
      romance: { signals: string[] };
      health: { signals: string[] };
    };
  }>;
}

/** V2 deterministic data (not AI-generated) — Love */
export interface LoveV2DeterministicData {
  spouseStar?: {
    star: string; visibility: string; role: string;
    balance: string; balanceDesc: string;
    challenges: string[]; hourWealthNote: string;
  };
  peachBlossoms?: {
    summary: string; positiveCount: number; negativeCount: number;
    positiveTypes: string[]; negativeTypes: string[];
  };
  marriagePalace?: {
    dayBranch: string; element: string; tenGod: string;
    twelveStage: string; isKongWang: boolean;
    appearanceGrade: string; appearanceNote: string;
  };
  partnerRecommendations?: {
    favorable: string[]; favorableSecondary: string[];
    avoidance: string[];
    favorableSeasons: Array<{ element: string; role: string; season: string; months: string }>;
  };
  romanceTimeline?: {
    goodYears: Array<{ year: number; type: string; conflicted: boolean; conflictedDetail: string }>;
    dangerYears: Array<{ year: number; trigger: string }>;
    changeYears: Array<{ year: number; type: string }>;
  };
  lovePersonality?: {
    archetypeLabel: string; archetypeTrait: string;
    elementStyle: string; strengthClass: string;
    dominantTenGod: string; dominantCount: number;
  };
  timingIndicators?: {
    earlySignals: string[]; lateSignals: string[];
  };
  annualForecasts?: Array<{
    year: number; stem: string; branch: string;
    auspiciousness: string; stemRole: string; stemTenGod: string;
    hasRomanceStar: boolean; lpContext: string;
    isGoodYear: boolean; goodYearType: string;
    isDangerYear: boolean; dangerYearTrigger: string;
    isChangeYear: boolean; changeYearType: string;
    isVoid: boolean; interactions: string[];
  }>;
  monthlyForecasts?: Array<{
    month: number; stem: string; branch: string;
    auspiciousness: string; stemRole: string; stemTenGod: string;
    hasRomanceStar: boolean; isVoid: boolean;
    interactions: string[]; lpContext: string;
  }>;
  activeLuckPeriod?: {
    stem: string; branch: string; tenGod: string;
    startYear: number; endYear: number;
  };
}

/** Union type for V2 deterministic data */
export type V2DeterministicData =
  | LifetimeV2DeterministicData
  | CareerV2DeterministicData
  | AnnualV2DeterministicData
  | LoveV2DeterministicData;

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
    birthTime: string | null;
    hourKnown?: boolean;
    gender: 'MALE' | 'FEMALE';
    birthCity: string;
    birthTimezone: string;
    isLunarDate: boolean;
    isLeapMonth: boolean;
  };
  /** AI failure / refund tracking */
  isDegraded?: boolean;
  failedReason?: string | null;
  refundedAt?: string | null;
  regenerationCount?: number;
  regenerationExhausted?: boolean;
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
  } | null;
  targetYear?: number | null;
  isComparison?: boolean;
  comparisonType?: string;
  profileB?: {
    name: string;
    birthDate: string;
  } | null;
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

// ============================================================
// Reading CRUD
// ============================================================

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
    body: {
      birthProfileId: params.birthProfileId,
      readingType: READING_TYPE_MAP[params.readingType], // slug → enum
      targetYear: params.targetYear,
      ...(params.stream && { stream: true }),
    },
  });
}

/** Fetch a saved reading by ID. */
export async function getReading(token: string, id: string): Promise<NestJSReadingResponse> {
  return apiFetch<NestJSReadingResponse>(`/api/bazi/readings/${id}`, { token });
}

/** Fetch reading history for the current user. */
export async function getReadingHistory(
  token: string,
  page = 1,
  limit = 20,
): Promise<ReadingHistoryResponse> {
  return apiFetch<ReadingHistoryResponse>(`/api/users/me/readings?page=${page}&limit=${limit}`, { token });
}

/**
 * Fetch reading history filtered to a single reading category. Accepts a
 * frontend slug (e.g. "lifetime"); maps to the backend enum internally.
 */
export async function getReadingHistoryByType(
  token: string,
  slug: string,
  page = 1,
  limit = 50,
): Promise<ReadingHistoryResponse> {
  const backendType = READING_TYPE_MAP[slug];
  if (!backendType) {
    throw new Error(`Unknown reading type slug: ${slug}`);
  }
  return apiFetch<ReadingHistoryResponse>(
    `/api/users/me/readings?type=${backendType}&page=${page}&limit=${limit}`,
    { token },
  );
}

// ============================================================
// Section order + dynamic titles
// ============================================================

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

export const CAREER_V2_ALL_SECTION_KEYS = [
  'career_pattern',
  'suitable_positions',
  'career_directions_favorable',
  'career_directions_unfavorable',
  'company_type_fit',
  'entrepreneurship',
  'partnership',
  'career_allies',
];

/** = static + dynamic (5 annual + 12 monthly per Call 2 prompt). */
export const CAREER_V2_EXPECTED_TOTAL = CAREER_V2_ALL_SECTION_KEYS.length + 5 + 12; // 25

export const LOVE_V2_SECTION_ORDER = [
  'love_personality',
  'peach_blossom_analysis',
  'natal_marriage',
  'partner_matching',
  'spouse_appearance',
  'romance_good_years',
  'romance_danger_years',
  'marriage_change_years',
  'love_summary',
  // annual_love_YYYY and monthly_love_MM are appended dynamically
];

export const LOVE_V2_ALL_SECTION_KEYS = Object.values(LOVE_V2_SECTION_KEYS);

export const LOVE_V2_EXPECTED_TOTAL = LOVE_V2_ALL_SECTION_KEYS.length + 5 + 12; // 26

export const ANNUAL_V2_SECTION_ORDER = [
  'annual_overview',
  'annual_tai_sui',
  'annual_dayun_context',
  'annual_career',
  'annual_finance',
  'annual_relationships',
  'annual_love',
  'annual_family',
  'annual_health',
  'monthly_01', 'monthly_02', 'monthly_03', 'monthly_04',
  'monthly_05', 'monthly_06', 'monthly_07', 'monthly_08',
  'monthly_09', 'monthly_10', 'monthly_11', 'monthly_12',
];

/** Lifetime V2 section display order. Sections not in this list are appended. */
export const V2_SECTION_ORDER = [
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
 * Expected streamed-section count per reading type — the denominator for the
 * 解讀中 n/total progress pill. Mirrors web `ACTIVE_V2_TOTAL` (page.tsx:149):
 * lifetime 15 · career 25 · annual 21 · love 26. Falls back to 1 (never /0).
 */
export function expectedSectionTotal(readingType: string): number {
  switch (readingType) {
    case 'career':
      return CAREER_V2_EXPECTED_TOTAL; // 25
    case 'love':
      return LOVE_V2_EXPECTED_TOTAL; // 26
    case 'annual':
      return ANNUAL_V2_SECTION_ORDER.length; // 21
    case 'lifetime':
      return V2_SECTION_ORDER.length; // 15
    default:
      return 1;
  }
}

/** Compatibility Romance V2 section display order (合盤). `compatibility_summary`
 *  arrives on the stream as its own `summary` event → routed to AIReadingData.summary
 *  (not sections), but kept here for saved-comparison rendering. */
export const COMPAT_ROMANCE_V2_SECTION_ORDER = [
  'compatibility_basis',
  'chart_profile_a',
  'chart_profile_b',
  'love_personality_a',
  'love_personality_b',
  'spouse_enrichment_a',
  'spouse_enrichment_b',
  'marriage_wealth_a',
  'marriage_wealth_b',
  'post_marriage_sweetness',
  'post_marriage_stability',
  'marriage_crisis_a',
  'marriage_crisis_b',
  'combined_crisis_analysis',
  'marriage_advice',
  'annual_love_a',
  'annual_love_b',
  'compatibility_summary',
];

/** Display title for dynamic section keys (annual/monthly forecasts). */
export function getDynamicSectionTitle(key: string): string | null {
  const annualMatch = key.match(/^annual_forecast_(\d{4})$/);
  if (annualMatch) return `${annualMatch[1]} 年度事業運勢`;

  const monthlyMatch = key.match(/^monthly_forecast_(\d{1,2})$/);
  if (monthlyMatch?.[1]) return `${parseInt(monthlyMatch[1], 10)}月運勢`;

  const loveAnnualMatch = key.match(/^annual_love_(\d{4})$/);
  if (loveAnnualMatch) return `${loveAnnualMatch[1]} 年度感情運勢`;

  const loveMonthlyMatch = key.match(/^monthly_love_(\d{1,2})$/);
  if (loveMonthlyMatch?.[1]) return `${parseInt(loveMonthlyMatch[1], 10)}月感情運勢`;

  const MONTH_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const annualMonthlyMatch = key.match(/^monthly_(\d{2})$/);
  if (annualMonthlyMatch?.[1]) {
    const monthNum = parseInt(annualMonthlyMatch[1], 10);
    if (monthNum >= 1 && monthNum <= 12) return `${MONTH_NAMES[monthNum - 1]}月運程`;
  }

  return null;
}

// ============================================================
// AI Response Transformer (Bazi V1 + V2; compat/ZWDS omitted)
// ============================================================

/**
 * Transform backend AI response (object keyed) → frontend array format.
 * V2 readings (lifetime/career/annual/love) carry deterministic data + an
 * explicit section order; V1 preserves insertion order.
 */
export function transformAIResponse(
  ai: NestJSReadingResponse['aiInterpretation'],
): AIReadingData | null {
  if (!ai || !ai.sections) return null;

  const isV2 = ai.schemaVersion === 'v2';

  let sections: ReadingSectionData[];
  if (isV2) {
    const sectionKeys = Object.keys(ai.sections);
    const isCareerV2 = sectionKeys.some(
      (k) => k === 'suitable_positions' || k === 'company_type_fit' || k === 'entrepreneurship',
    );
    const isAnnualV2 = sectionKeys.some(
      (k) => k === 'annual_overview' || k === 'annual_tai_sui' || k === 'annual_dayun_context',
    );
    const isLoveV2 = sectionKeys.some(
      (k) => k === 'love_personality' || k === 'peach_blossom_analysis' || k === 'natal_marriage',
    );
    // Compat 合盤 — checked BEFORE isLoveV2 so its annual_love_a/b keys don't
    // trip the love-V2 annual-append branch (compat places them explicitly).
    const isCompatV2 = sectionKeys.some(
      (k) => k === 'compatibility_basis' || k === 'combined_crisis_analysis' || k === 'marriage_advice',
    );
    const orderList = isCompatV2
      ? COMPAT_ROMANCE_V2_SECTION_ORDER
      : isCareerV2
        ? CAREER_V2_SECTION_ORDER
        : isAnnualV2
          ? ANNUAL_V2_SECTION_ORDER
          : isLoveV2
            ? LOVE_V2_SECTION_ORDER
            : V2_SECTION_ORDER;

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

    // For career V2: append annual forecasts by year, then monthly by month
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

    // For love V2: append annual love forecasts by year, then monthly by month
    if (isLoveV2) {
      const annuals = sectionEntries
        .filter(([k]) => k.startsWith('annual_love_') && !seen.has(k))
        .sort(([a], [b]) => a.localeCompare(b));
      const monthlies = sectionEntries
        .filter(([k]) => k.startsWith('monthly_love_') && !seen.has(k))
        .sort(([a], [b]) => {
          const ma = parseInt(a.replace('monthly_love_', ''), 10);
          const mb = parseInt(b.replace('monthly_love_', ''), 10);
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

  const summary = ai.summary ? { text: ai.summary.full || ai.summary.preview } : undefined;

  return {
    sections,
    summary,
    isV2,
    deterministic: isV2 ? ai.deterministic : undefined,
  };
}

// ============================================================
// Deterministic data normalization
// ============================================================

/**
 * Deep camelCase converter for objects from the Python → NestJS pipeline.
 * NestJS only shallow-converts top-level keys; nested keys from Python may
 * remain snake_case. Idempotent — safe to run on already-camel data.
 */
function deepCamelCase(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(deepCamelCase);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = deepCamelCase(value);
    }
    return result;
  }
  return obj;
}

/** Normalize raw annual V2 deterministic data. Returns null if not annual V2. */
export function normalizeAnnualDeterministic(
  raw: Record<string, unknown> | undefined,
): AnnualV2DeterministicData | null {
  if (!raw) return null;
  const hasFlowYear = 'flowYear' in raw || 'flow_year' in raw;
  const hasTaiSui = 'taiSui' in raw || 'tai_sui' in raw;
  const hasMonthly = 'monthlyForecasts' in raw || 'monthly_forecasts' in raw;
  if (!hasFlowYear && !hasTaiSui && !hasMonthly) return null;
  return deepCamelCase(raw) as AnnualV2DeterministicData;
}

/** Normalize raw love V2 deterministic data. Returns null if not love V2. */
export function normalizeLoveDeterministic(
  raw: Record<string, unknown> | undefined,
): LoveV2DeterministicData | null {
  if (!raw) return null;
  const hasSpouseStar = 'spouseStar' in raw || 'spouse_star' in raw;
  const hasPeachBlossoms = 'peachBlossoms' in raw || 'peach_blossoms' in raw;
  if (!hasSpouseStar && !hasPeachBlossoms) return null;
  return deepCamelCase(raw) as LoveV2DeterministicData;
}

// ============================================================
// SSE Streaming Client
// ============================================================

/**
 * Final-event payload — emitted by V2 streams after all retry + fallback
 * attempts. Replaces the old `done` event.
 */
export interface FinalEventPayload {
  status: 'success' | 'degraded' | 'failed';
  totalSections: number;
  expectedSections: number;
  latencyMs: number;
  refunded?: boolean;
  refundedAmount?: number;
  message?: string;
}

/** Retry attempt event — emitted while retrying transient failures. */
export interface RetryAttemptPayload {
  provider: string;
  attempt: number;
  max: number;
  reason: string;
  call: 1 | 2;
}

/** One parsed reading-stream frame: SSE `event:` type + `data:` JSON payload. */
export interface ReadingStreamFrame {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Parse a reading SSE frame (`event: <type>` + `data: <json>`). The readings
 * stream carries the event type in the SSE `event:` line (unlike the fortune
 * streams, which embed `type` in the JSON) — hence the custom parser.
 * Exported for unit testing.
 */
export function parseReadingFrame(frame: string): ReadingStreamFrame | null {
  const lines = frame.split('\n');
  let eventType = 'message';
  const dataParts: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith(':')) continue; // heartbeat/comment
    const em = line.match(/^event:\s*(.+)$/);
    if (em?.[1]) {
      eventType = em[1].trim();
      continue;
    }
    if (line.startsWith('data: ')) dataParts.push(line.slice(6));
    else if (line.startsWith('data:')) dataParts.push(line.slice(5));
  }
  if (eventType === 'heartbeat') return null;
  if (dataParts.length === 0) return null;
  try {
    return { event: eventType, data: JSON.parse(dataParts.join('\n')) as Record<string, unknown> };
  } catch {
    return null; // drop malformed frames
  }
}

export interface StreamBaziReadingCallbacks {
  onSectionComplete: (key: string, section: { preview: string; full: string; score?: number }) => void;
  onCallComplete: (callNumber: number) => void;
  onSummary: (summary: { preview: string; full: string }) => void;
  /** @deprecated — use onFinal. Kept for back-compat with `done`. */
  onDone?: (info: { totalSections: number; latencyMs: number }) => void;
  onError: (error: { message: string; partial?: boolean }) => void;
  /** Called when AI completes (success/degraded/failed). Replaces onDone. */
  onFinal?: (info: FinalEventPayload) => void;
  /** Called while retrying — for UX status ("AI busy, retrying 2/3..."). */
  onRetryAttempt?: (info: RetryAttemptPayload) => void;
}

/**
 * Stream AI interpretation for a Bazi reading via SSE. Wraps the shared
 * `openSseStream` seam (expo/fetch) with the reading `event:`+`data:` frame
 * parser. Returns a `{ close }` handle to abort the stream.
 */
export function streamBaziReading(
  token: string,
  readingId: string,
  callbacks: StreamBaziReadingCallbacks,
): { close: () => void } {
  const teardown = openSseStream<ReadingStreamFrame>({
    url: `${API_BASE}/api/bazi/readings/${readingId}/stream`,
    token,
    parseFrame: parseReadingFrame,
    label: 'Reading stream',
    onPreflightError: (status, body) => ({
      event: 'error',
      data: { message: body.message || `HTTP ${status}` },
    }),
    onEvent: ({ event, data }) => {
      switch (event) {
        case 'section_complete':
          callbacks.onSectionComplete(
            data.key as string,
            data as unknown as { preview: string; full: string; score?: number },
          );
          break;
        case 'call_complete':
          callbacks.onCallComplete(data.call as number);
          break;
        case 'summary':
          callbacks.onSummary(data as unknown as { preview: string; full: string });
          break;
        case 'done':
          callbacks.onDone?.(data as unknown as { totalSections: number; latencyMs: number });
          break;
        case 'final':
          callbacks.onFinal?.(data as unknown as FinalEventPayload);
          break;
        case 'retry_attempt':
          callbacks.onRetryAttempt?.(data as unknown as RetryAttemptPayload);
          break;
        case 'error':
          callbacks.onError(data as unknown as { message: string; partial?: boolean });
          break;
      }
    },
    // Transport-level failure (network / reader) — surface as an error.
    onError: (err) => callbacks.onError({ message: err.message || 'Stream failed' }),
    onClose: () => {
      /* terminal events (final/done/error) drive the UI; nothing to do on close */
    },
  });

  return { close: teardown };
}

/** Regenerate a degraded reading. Free (no credit deduction). Limit: 3 per reading. */
export async function regenerateBaziReading(
  token: string,
  readingId: string,
): Promise<{ readingId: string; regenerationCount: number; regenerationsRemaining: number }> {
  return apiFetch(`/api/bazi/readings/${readingId}/regenerate`, { method: 'POST', token });
}

// ============================================================
// Compatibility (合盤) — M5
// ============================================================

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

/** One party's chart within a comparison (minimal typed surface; full chart is opaque).
 *  `gender` may be 'male'/'female' (engine) or 'MALE'/'FEMALE' — normalize at use. */
export interface CompatChart {
  gender?: string;
  [key: string]: unknown;
}

/** Deterministic romance (V2) pre-analysis block — drives the score reveal + paywall. */
export interface RomancePreAnalysis {
  lovePersonalityA?: { hourUnknown?: boolean; [k: string]: unknown };
  lovePersonalityB?: { hourUnknown?: boolean; [k: string]: unknown };
  postMarriageQuality?: {
    sweetness?: { score?: number };
    stability?: { score?: number };
  };
  combinedCrisis?: { destructiveLevel?: string; overallLevel?: string };
  scoreBreakdown?: {
    baseScore?: number;
    sweetnessScore?: number;
    stabilityScore?: number;
    romanceAvg?: number;
    formula?: string;
  };
  peachBlossomCountA?: number;
  peachBlossomCountB?: number;
  spouseStarCountA?: number;
  spouseStarCountB?: number;
  blendedScore?: number;
  blendedLabel?: string;
  [key: string]: unknown;
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
  chartA: CompatChart;
  chartB: CompatChart;
  /** Present on ROMANCE (V2) comparisons — the flagship path. */
  romancePreAnalysis?: RomancePreAnalysis;
}

export interface CompatibilityResponse {
  id: string;
  comparisonType: string;
  calculationData: CompatibilityCalculationData;
  aiInterpretation: {
    schemaVersion?: 'v2';
    sections: Record<string, { preview: string; full: string }>;
    summary?: { preview: string; full: string };
  } | null;
  creditsUsed: number;
  lastCalculatedYear?: number;
  createdAt: string;
  profileA?: { name: string; birthDate: string };
  profileB?: { name: string; birthDate: string };
  /** V2 romance comparisons set this to 2. */
  aiVersion?: number;
  /** Present when stream=true was requested and AI will be streamed via SSE. */
  streamReady?: boolean;
}

/**
 * Create a Bazi compatibility comparison (chart + optional AI + credits + DB).
 * Frontend slug → backend enum mapping happens internally. NOTE: credits are
 * deducted HERE even with `skipAI:true` — the romance flow pays at create time
 * and the later unlock stream is already-paid (do NOT charge again).
 */
export async function createBaziCompatibility(
  token: string,
  params: {
    profileAId: string;
    profileBId: string;
    comparisonType: string; // slug: 'romance' | 'business' | 'friendship'
    skipAI?: boolean;
  },
): Promise<CompatibilityResponse> {
  return apiFetch<CompatibilityResponse>('/api/bazi/comparisons', {
    method: 'POST',
    token,
    body: {
      profileAId: params.profileAId,
      profileBId: params.profileBId,
      comparisonType: COMPARISON_TYPE_MAP[params.comparisonType] || params.comparisonType,
      ...(params.skipAI && { skipAI: true }),
    },
  });
}

/** Fetch a saved comparison by ID. */
export async function getCompatibility(
  token: string,
  id: string,
): Promise<CompatibilityResponse> {
  return apiFetch<CompatibilityResponse>(`/api/bazi/comparisons/${id}`, { token });
}

/** Re-calculate a comparison with the current year's timing. Costs 1 credit. */
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
 * Generate AI (non-streaming) for an existing comparison created with skipAI.
 * No additional credits charged. Used for the V1 business/friendship path.
 */
export async function generateCompatibilityAI(
  token: string,
  id: string,
): Promise<CompatibilityResponse> {
  return apiFetch<CompatibilityResponse>(`/api/bazi/comparisons/${id}/generate-ai`, {
    method: 'POST',
    token,
  });
}

export interface StreamCompatibilityCallbacks {
  onSectionComplete: (key: string, section: { preview: string; full: string; score?: number }) => void;
  onCallComplete: (callNumber: number) => void;
  onSummary: (summary: { preview: string; full: string }) => void;
  onDone: (info: { totalSections: number; latencyMs: number }) => void;
  onError: (error: { message: string; partial?: boolean }) => void;
}

/**
 * Stream AI interpretation for a ROMANCE (V2) comparison via SSE. Same
 * `event:`+`data:` frame grammar as streamBaziReading → reuses parseReadingFrame.
 * The compat stream emits `done` (not `final`) and `summary` as its own event.
 * Returns a `{ close }` handle to abort the stream.
 */
export function streamCompatibilityReading(
  token: string,
  comparisonId: string,
  callbacks: StreamCompatibilityCallbacks,
): { close: () => void } {
  const teardown = openSseStream<ReadingStreamFrame>({
    url: `${API_BASE}/api/bazi/comparisons/${comparisonId}/stream`,
    token,
    parseFrame: parseReadingFrame,
    label: 'Compat stream',
    onPreflightError: (status, body) => ({
      event: 'error',
      data: { message: body.message || `HTTP ${status}` },
    }),
    onEvent: ({ event, data }) => {
      switch (event) {
        case 'section_complete':
          callbacks.onSectionComplete(
            data.key as string,
            data as unknown as { preview: string; full: string; score?: number },
          );
          break;
        case 'call_complete':
          callbacks.onCallComplete(data.call as number);
          break;
        case 'summary':
          callbacks.onSummary(data as unknown as { preview: string; full: string });
          break;
        case 'done':
          callbacks.onDone(data as unknown as { totalSections: number; latencyMs: number });
          break;
        case 'error':
          callbacks.onError(data as unknown as { message: string; partial?: boolean });
          break;
      }
    },
    onError: (err) => callbacks.onError({ message: err.message || 'Stream failed' }),
    onClose: () => {
      /* terminal events (done/error) drive the UI; nothing to do on close */
    },
  });

  return { close: teardown };
}
