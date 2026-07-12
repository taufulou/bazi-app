/**
 * Lunar ↔ Solar calendar conversion utilities.
 * Uses lunar-typescript (6tail) library — supports 1900-2100, handles leap months.
 *
 * Leap month convention: lunar-typescript uses NEGATIVE month numbers for leap months.
 * e.g., -2 = 閏二月 (leap month after month 2).
 * This module abstracts that into a simpler (month, isLeapMonth) boolean interface.
 *
 * Ported verbatim from apps/web/app/lib/lunar-utils.ts (pure — no web deps).
 */

import { Lunar, LunarYear } from 'lunar-typescript';

/**
 * Convert a lunar date to solar (Gregorian) date string YYYY-MM-DD.
 * Throws Error if the date is invalid (bad month/day combo, out of range, etc.).
 */
export function lunarToSolar(
  year: number,
  month: number,
  day: number,
  isLeapMonth: boolean,
): string {
  const lunarMonth = isLeapMonth ? -month : month;
  const lunar = Lunar.fromYmd(year, lunarMonth, day);
  const solar = lunar.getSolar();
  return `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`;
}

/** Get the number of days in a given lunar month (29 or 30). Falls back to 30. */
export function getLunarDaysInMonth(
  year: number,
  month: number,
  isLeapMonth: boolean,
): number {
  try {
    const lunarYear = LunarYear.fromYear(year);
    const months = lunarYear.getMonths();
    const targetMonth = isLeapMonth ? -month : month;
    const found = months.find((m) => m.getMonth() === targetMonth);
    return found ? found.getDayCount() : 30;
  } catch {
    return 30;
  }
}

/**
 * Get the leap month number (1-12) for a lunar year, or null if none.
 * e.g., 2023 → 2 (閏二月), 2024 → null.
 */
export function getLeapMonthInYear(year: number): number | null {
  try {
    const lunarYear = LunarYear.fromYear(year);
    const leapMonth = lunarYear.getLeapMonth();
    return leapMonth === 0 ? null : leapMonth;
  } catch {
    return null;
  }
}

/** Validate a lunar date is in range (1900-2100) and a valid year/month/day combo. */
export function isValidLunarDate(
  year: number,
  month: number,
  day: number,
  isLeapMonth: boolean,
): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  if (isLeapMonth) {
    const leapMonth = getLeapMonthInYear(year);
    if (leapMonth !== month) return false;
  }

  const maxDays = getLunarDaysInMonth(year, month, isLeapMonth);
  if (day > maxDays) return false;

  try {
    const lunarMonth = isLeapMonth ? -month : month;
    Lunar.fromYmd(year, lunarMonth, day);
    return true;
  } catch {
    return false;
  }
}
