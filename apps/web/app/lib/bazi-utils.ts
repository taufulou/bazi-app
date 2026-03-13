/**
 * Shared Bazi utility maps — single source of truth.
 * Used by MonthlyFortuneGrid, AnnualForecastTimeline, and AIReadingDisplay.
 */

// ============================================================
// Types
// ============================================================

export type VerdictTone = 'positive' | 'negative' | 'neutral';

// ============================================================
// Auspiciousness → Star Rating Maps
// ============================================================

/** Maps Chinese auspiciousness labels to star ratings (0–5 scale).
 *  Authoritative source: AnnualForecastTimeline (most complete set). */
export const AUSPICIOUSNESS_TO_STARS: Record<string, number> = {
  // Primary 5-level (produced by R6-2 流年-only for annual)
  '大吉': 5.0,
  '吉': 4.0,
  '平': 3.0,
  '凶': 2.0,
  '大凶': 1.0,
  // Legacy/monthly labels (kept for backward compatibility)
  '吉中有凶': 3.5,
  '小凶': 2.5,
  '凶中有吉': 2.5,
  '凶中帶機': 1.5,
  '曇花一現': 3.5,
  '凶上加凶': 0.5,
};

// ============================================================
// Romance Level Maps
// ============================================================

export const ROMANCE_LEVEL_STARS: Record<string, number> = {
  'very_strong': 5.0,
  'strong': 4.0,
  'moderate': 3.0,
  'quiet': 2.0,
};

export const ROMANCE_LEVEL_ZH: Record<string, string> = {
  'very_strong': '極旺',
  'strong': '偏強',
  'moderate': '中等',
  'quiet': '平靜',
};

// ============================================================
// Health Vitality Maps
// ============================================================

export const VITALITY_TO_STARS: Record<string, number> = {
  'peak': 5.0,
  'strong': 4.5,
  'strengthening': 4.0,
  'rising': 3.5,
  'nurturing': 3.5,
  'renewing': 3.0,
  'unstable': 2.5,
  'declining': 2.5,
  'dormant': 2.0,
  'weak': 1.5,
  'very_weak': 1.0,
  'critical': 0.5,
};

export const VITALITY_TONE: Record<string, VerdictTone> = {
  'peak': 'positive',
  'strong': 'positive',
  'strengthening': 'positive',
  'rising': 'neutral',
  'nurturing': 'neutral',
  'renewing': 'neutral',
  'unstable': 'neutral',
  'declining': 'negative',
  'dormant': 'negative',
  'weak': 'negative',
  'very_weak': 'negative',
  'critical': 'negative',
};
