/**
 * Shared date/time utility functions for birth-data forms.
 * Ported from apps/web/app/lib/date-time-utils.ts (pure — only @repo/shared dep).
 */

import { getRegionForCity } from '@repo/shared';

export interface PersonFieldValues {
  name: string;
  gender: 'male' | 'female' | '';
  calendarType: 'solar' | 'lunar';
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  period: 'AM' | 'PM';
  isLeapMonth: boolean;
  regionCode: string;
  cityCode: string;
  timezone: string;
  quickMode: boolean;
}

export const EMPTY_PERSON_FIELDS: PersonFieldValues = {
  name: '',
  gender: '',
  calendarType: 'solar',
  year: '',
  month: '',
  day: '',
  hour: '',
  minute: '',
  period: 'AM',
  isLeapMonth: false,
  regionCode: '',
  cityCode: '',
  timezone: '',
  quickMode: false,
};

/** Days in a given month (handles leap years). */
export function getDaysInMonth(year: string, month: string): number {
  if (!year || !month) return 31;
  return new Date(parseInt(year), parseInt(month), 0).getDate();
}

/** 24-hour string (e.g. "14") → 12-hour + period. */
export function to12Hour(hour24: string): { hour12: string; period: 'AM' | 'PM' } {
  if (hour24 === '') return { hour12: '', period: 'AM' };
  const h = parseInt(hour24);
  if (h === 0) return { hour12: '12', period: 'AM' };
  if (h < 12) return { hour12: String(h), period: 'AM' };
  if (h === 12) return { hour12: '12', period: 'PM' };
  return { hour12: String(h - 12), period: 'PM' };
}

/** 12-hour + period → 24-hour zero-padded string. */
export function to24Hour(hour12: string, period: 'AM' | 'PM'): string {
  if (hour12 === '') return '';
  const h = parseInt(hour12);
  if (period === 'AM') {
    return String(h === 12 ? 0 : h).padStart(2, '0');
  }
  return String(h === 12 ? 12 : h + 12).padStart(2, '0');
}

export const CURRENT_YEAR = new Date().getFullYear();
export const YEAR_OPTIONS = Array.from(
  { length: CURRENT_YEAR - 1920 + 1 },
  (_, i) => CURRENT_YEAR - i,
);
export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
export const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
export const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

/** Convert a BirthProfile-ish object to PersonFieldValues (for DualBirthDataForm / prefill). */
export function profileToPersonFields(profile: {
  name: string;
  gender: string;
  birthDate: string;
  birthTime: string | null;
  birthCity: string;
  birthTimezone: string;
  isLunarDate?: boolean;
  isLeapMonth?: boolean;
}): PersonFieldValues {
  const dateStr = profile.birthDate.substring(0, 10);
  const [year, month, day] = dateStr.split('-');

  let hour = '';
  let minute = '';
  let period: 'AM' | 'PM' = 'AM';
  if (profile.birthTime) {
    const parts = profile.birthTime.split(':');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const converted = to12Hour(parts[0]);
      hour = converted.hour12;
      minute = parts[1].padStart(2, '0');
      period = converted.period;
    }
  }

  const regionCode = (profile.birthCity && getRegionForCity(profile.birthCity)) || '';

  return {
    name: profile.name,
    gender: profile.gender.toLowerCase() === 'male' ? 'male' : 'female',
    calendarType: profile.isLunarDate ? 'lunar' : 'solar',
    year: year || '',
    month: month ? String(parseInt(month)) : '',
    day: day ? String(parseInt(day)) : '',
    hour,
    minute,
    period,
    isLeapMonth: profile.isLeapMonth || false,
    regionCode,
    cityCode: profile.birthCity || '',
    timezone: profile.birthTimezone || '',
    quickMode: !profile.birthTime,
  };
}
