/**
 * API client for ZWDS (紫微斗數) endpoints on the NestJS backend.
 * ZWDS calculations run natively in NestJS via iztro — no Python engine needed.
 */

import { apiFetch } from './api';

// ============================================================
// Types (matching backend ZwdsChartData)
// ============================================================

export interface ZwdsStar {
  name: string;
  type: 'major' | 'minor' | 'adjective';
  brightness?: string; // 廟/旺/得/利/平/不/陷
  mutagen?: string;    // 祿/權/科/忌
}

export interface ZwdsPalace {
  name: string;
  index: number;
  isBodyPalace: boolean;
  heavenlyStem: string;
  earthlyBranch: string;
  majorStars: ZwdsStar[];
  minorStars: ZwdsStar[];
  adjectiveStars: ZwdsStar[];
  changsheng12: string;
  decadal: {
    startAge: number;
    endAge: number;
    stem: string;
    branch: string;
  };
  ages: number[];
}

export interface ZwdsHoroscopeItem {
  name: string;
  stem: string;
  branch: string;
  mutagen: string[];
}

export interface ZwdsHoroscope {
  decadal: ZwdsHoroscopeItem;
  yearly: ZwdsHoroscopeItem;
  monthly?: ZwdsHoroscopeItem;
  daily?: ZwdsHoroscopeItem;
}

export interface ZwdsChartData {
  solarDate: string;
  lunarDate: string;
  chineseDate: string;
  birthTime: string;
  timeRange: string;
  gender: string;
  zodiac: string;
  sign: string;
  fiveElementsClass: string;
  soulPalaceBranch: string;
  bodyPalaceBranch: string;
  soulStar: string;
  bodyStar: string;
  palaces: ZwdsPalace[];
  horoscope?: ZwdsHoroscope;
}

export interface ZwdsReadingResponse {
  id: string;
  readingType: string;
  calculationData: ZwdsChartData;
  aiInterpretation: {
    sections: Record<string, { preview: string; full: string }>;
  } | null;
  createdAt: string;
}

// ============================================================
// API Functions
// ============================================================

/**
 * Get a ZWDS chart preview (free, no AI interpretation).
 * POST /api/zwds/chart-preview
 */
export async function getZwdsChartPreview(
  token: string,
  data: { birthProfileId: string },
): Promise<ZwdsChartData> {
  return apiFetch<ZwdsChartData>('/api/zwds/chart-preview', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
}

/**
 * Create a ZWDS reading (chart + AI interpretation).
 * POST /api/zwds/readings
 */
export async function createZwdsReading(
  token: string,
  data: {
    birthProfileId: string;
    readingType: string;
    targetYear?: number;
  },
): Promise<ZwdsReadingResponse> {
  return apiFetch<ZwdsReadingResponse>('/api/zwds/readings', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
}

/**
 * Get a saved ZWDS reading.
 * GET /api/zwds/readings/:id
 */
export async function getZwdsReading(
  token: string,
  readingId: string,
): Promise<ZwdsReadingResponse> {
  return apiFetch<ZwdsReadingResponse>(`/api/zwds/readings/${readingId}`, {
    token,
  });
}

/**
 * Get ZWDS horoscope (大限/流年/流月) for a specific date.
 * POST /api/zwds/horoscope
 */
export async function getZwdsHoroscope(
  token: string,
  data: { birthProfileId: string; targetDate: string },
): Promise<ZwdsChartData> {
  return apiFetch<ZwdsChartData>('/api/zwds/horoscope', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
}

/**
 * Create a ZWDS compatibility comparison.
 * POST /api/zwds/comparisons
 */
export async function createZwdsComparison(
  token: string,
  data: {
    profileAId: string;
    profileBId: string;
    comparisonType: 'ROMANCE' | 'BUSINESS' | 'FRIENDSHIP';
  },
): Promise<ZwdsReadingResponse> {
  return apiFetch<ZwdsReadingResponse>('/api/zwds/comparisons', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
}
