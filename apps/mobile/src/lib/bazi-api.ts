/**
 * Bazi 排盤 (calculate) client — hits the NestJS public passthrough
 * (POST /api/bazi/calculate → Python engine /calculate). Public route, no token.
 */

import { apiFetch } from './api';
import type { BaziChartData } from './bazi-types';

export interface CalculateBaziInput {
  birth_date: string; // "YYYY-MM-DD" (solar)
  birth_time: string | null; // "HH:mm"; null when hour unknown
  hour_known: boolean;
  birth_city: string;
  birth_timezone: string;
  gender: string; // "male" | "female"
  target_year?: number;
}

/** Engine envelope is { status, calculationTimeMs, data }; we unwrap `.data`. */
export async function calculateBazi(input: CalculateBaziInput): Promise<BaziChartData> {
  const res = await apiFetch<{ data?: BaziChartData } & Partial<BaziChartData>>(
    '/api/bazi/calculate',
    { method: 'POST', body: input },
  );
  return (res.data ?? (res as unknown as BaziChartData));
}
