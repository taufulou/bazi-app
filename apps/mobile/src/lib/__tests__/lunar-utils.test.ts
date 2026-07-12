import {
  lunarToSolar,
  getLunarDaysInMonth,
  getLeapMonthInYear,
  isValidLunarDate,
} from '../lunar-utils';

describe('lunar-utils', () => {
  it('converts 農曆 2024 正月初一 to 2024-02-10 (Chinese New Year 2024)', () => {
    expect(lunarToSolar(2024, 1, 1, false)).toBe('2024-02-10');
  });

  it('detects the leap month per year', () => {
    expect(getLeapMonthInYear(2023)).toBe(2); // 閏二月 in 2023
    expect(getLeapMonthInYear(2024)).toBeNull();
  });

  it('validates lunar dates', () => {
    expect(isValidLunarDate(2024, 1, 1, false)).toBe(true);
    expect(isValidLunarDate(2023, 2, 1, true)).toBe(true); // 2023 has 閏二月
    expect(isValidLunarDate(2024, 2, 1, true)).toBe(false); // 2024 has no leap month
    expect(isValidLunarDate(2100, 13, 1, false)).toBe(false); // month out of range
    expect(isValidLunarDate(1899, 1, 1, false)).toBe(false); // year out of range
    expect(isValidLunarDate(2024, 1, 40, false)).toBe(false); // day too large
  });

  it('returns 29 or 30 days for a lunar month', () => {
    const days = getLunarDaysInMonth(2024, 1, false);
    expect([29, 30]).toContain(days);
  });
});
