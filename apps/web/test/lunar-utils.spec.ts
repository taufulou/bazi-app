/**
 * Unit tests for lunar-utils.ts
 * Tests lunar↔solar conversion using the lunar-typescript library.
 */
import {
  lunarToSolar,
  getLunarDaysInMonth,
  getLeapMonthInYear,
  isValidLunarDate,
} from '../app/lib/lunar-utils';

// ============================================================
// lunarToSolar
// ============================================================

describe('lunarToSolar', () => {
  it('converts known lunar date 1990-04-21 to solar 1990-05-15', () => {
    // 農曆 1990年四月廿一 = 陽曆 1990-05-15
    expect(lunarToSolar(1990, 4, 21, false)).toBe('1990-05-15');
  });

  it('converts lunar 2023-01-01 to solar 2023-01-22', () => {
    // 農曆 2023年正月初一 = 陽曆 2023-01-22 (Chinese New Year)
    expect(lunarToSolar(2023, 1, 1, false)).toBe('2023-01-22');
  });

  it('converts leap month date 2023 閏二月 15 to solar', () => {
    // 2023 has a leap second month (閏二月)
    const result = lunarToSolar(2023, 2, 15, true);
    // 農曆 2023年閏二月十五 should be in April 2023
    expect(result).toBe('2023-04-05');
  });

  it('handles non-leap month 2023 regular 二月 15', () => {
    const result = lunarToSolar(2023, 2, 15, false);
    // Regular 二月15 should be in March 2023
    expect(result).toBe('2023-03-06');
  });

  it('converts edge case: lunar 1900-01-01', () => {
    const result = lunarToSolar(1900, 1, 1, false);
    expect(result).toBe('1900-01-31');
  });

  it('throws for completely invalid date', () => {
    expect(() => lunarToSolar(1990, 13, 1, false)).toThrow();
  });
});

// ============================================================
// getLeapMonthInYear
// ============================================================

describe('getLeapMonthInYear', () => {
  it('returns 2 for 2023 (閏二月)', () => {
    expect(getLeapMonthInYear(2023)).toBe(2);
  });

  it('returns 6 for 2025 (閏六月)', () => {
    expect(getLeapMonthInYear(2025)).toBe(6);
  });

  it('returns null for 2024 (no leap month)', () => {
    expect(getLeapMonthInYear(2024)).toBeNull();
  });

  it('returns a number or null for any valid year', () => {
    // The library supports a wide range; verify return type
    const result = getLeapMonthInYear(1950);
    if (result !== null) {
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(12);
    }
  });
});

// ============================================================
// getLunarDaysInMonth
// ============================================================

describe('getLunarDaysInMonth', () => {
  it('returns 29 or 30 for a regular month', () => {
    const days = getLunarDaysInMonth(2023, 1, false);
    expect([29, 30]).toContain(days);
  });

  it('returns 29 or 30 for leap month in 2023', () => {
    const days = getLunarDaysInMonth(2023, 2, true);
    expect([29, 30]).toContain(days);
  });

  it('returns correct day count for non-leap month', () => {
    const days = getLunarDaysInMonth(1990, 4, false);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('returns 30 as fallback for invalid year', () => {
    // Out of range — should fallback to 30
    const days = getLunarDaysInMonth(1800, 1, false);
    expect(days).toBe(30);
  });
});

// ============================================================
// isValidLunarDate
// ============================================================

describe('isValidLunarDate', () => {
  it('validates a normal lunar date', () => {
    expect(isValidLunarDate(1990, 4, 21, false)).toBe(true);
  });

  it('validates a leap month date in a year that has it', () => {
    // 2023 has leap month 2
    expect(isValidLunarDate(2023, 2, 15, true)).toBe(true);
  });

  it('rejects leap month for a month that is not the leap month', () => {
    // 2023 has leap month 2, not 3
    expect(isValidLunarDate(2023, 3, 15, true)).toBe(false);
  });

  it('rejects leap month for a year with no leap month', () => {
    // 2024 has no leap month
    expect(isValidLunarDate(2024, 2, 15, true)).toBe(false);
  });

  it('rejects month 13', () => {
    expect(isValidLunarDate(1990, 13, 1, false)).toBe(false);
  });

  it('rejects month 0', () => {
    expect(isValidLunarDate(1990, 0, 1, false)).toBe(false);
  });

  it('rejects day 0', () => {
    expect(isValidLunarDate(1990, 1, 0, false)).toBe(false);
  });

  it('rejects day exceeding month days (e.g., day 31 in a 29-day month)', () => {
    // Lunar months have at most 30 days
    expect(isValidLunarDate(1990, 1, 31, false)).toBe(false);
  });

  it('rejects year before 1900', () => {
    expect(isValidLunarDate(1899, 1, 1, false)).toBe(false);
  });

  it('rejects year after 2100', () => {
    expect(isValidLunarDate(2101, 1, 1, false)).toBe(false);
  });

  it('accepts boundary year 1900', () => {
    expect(isValidLunarDate(1900, 1, 1, false)).toBe(true);
  });

  it('accepts boundary year 2100', () => {
    expect(isValidLunarDate(2100, 1, 1, false)).toBe(true);
  });
});
