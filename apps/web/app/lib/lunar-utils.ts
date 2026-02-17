/**
 * Lunar ↔ Solar calendar conversion utilities.
 * Uses lunar-typescript (6tail) library — supports 1900-2100, handles leap months.
 *
 * Leap month convention: lunar-typescript uses NEGATIVE month numbers for leap months.
 * e.g., -2 = 閏二月 (leap month after month 2).
 * This module abstracts that into a simpler (month, isLeapMonth) boolean interface.
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
  // lunar-typescript uses negative month for leap months: -2 = 閏二月
  const lunarMonth = isLeapMonth ? -month : month;
  const lunar = Lunar.fromYmd(year, lunarMonth, day);
  const solar = lunar.getSolar();
  return `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`;
}

/**
 * Get the number of days in a given lunar month (29 or 30).
 * Returns 30 as fallback if month not found.
 */
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
 * Check if a given lunar year has a leap month.
 * Returns the month number (1-12) that has a leap, or null if no leap month in that year.
 * e.g., 2023 → 2 (閏二月), 2024 → null
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

/**
 * Validate that a lunar date is within the library's supported range (1900-2100)
 * and that the year/month/day combination is actually valid.
 */
export function isValidLunarDate(
  year: number,
  month: number,
  day: number,
  isLeapMonth: boolean,
): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  // If user claims leap month, verify that year actually has a leap month for that month
  if (isLeapMonth) {
    const leapMonth = getLeapMonthInYear(year);
    if (leapMonth !== month) return false;
  }

  // Verify day count
  const maxDays = getLunarDaysInMonth(year, month, isLeapMonth);
  if (day > maxDays) return false;

  // Final check: try constructing and converting
  try {
    const lunarMonth = isLeapMonth ? -month : month;
    Lunar.fromYmd(year, lunarMonth, day);
    return true;
  } catch {
    return false;
  }
}
