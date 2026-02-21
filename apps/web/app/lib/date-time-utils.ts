/**
 * Shared date/time utility functions for birth data forms.
 * Extracted from BirthDataForm.tsx for reuse in PersonBirthFields and DualBirthDataForm.
 */

import { getRegionForCity } from "@repo/shared";

// ============================================================
// Types
// ============================================================

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

// ============================================================
// Date/Time Helpers
// ============================================================

/** Get number of days in a given month (handles leap years). */
export function getDaysInMonth(year: string, month: string): number {
  if (!year || !month) return 31;
  return new Date(parseInt(year), parseInt(month), 0).getDate();
}

/** Convert 24-hour string (e.g. "14") to 12-hour + period. */
export function to12Hour(hour24: string): { hour12: string; period: 'AM' | 'PM' } {
  if (hour24 === '') return { hour12: '', period: 'AM' };
  const h = parseInt(hour24);
  if (h === 0) return { hour12: '12', period: 'AM' };
  if (h < 12) return { hour12: String(h), period: 'AM' };
  if (h === 12) return { hour12: '12', period: 'PM' };
  return { hour12: String(h - 12), period: 'PM' };
}

/** Convert 12-hour + period to 24-hour zero-padded string. */
export function to24Hour(hour12: string, period: 'AM' | 'PM'): string {
  if (hour12 === '') return '';
  const h = parseInt(hour12);
  if (period === 'AM') {
    return String(h === 12 ? 0 : h).padStart(2, '0');
  }
  return String(h === 12 ? 12 : h + 12).padStart(2, '0');
}

// ============================================================
// Dropdown Option Constants
// ============================================================

export const CURRENT_YEAR = new Date().getFullYear();
export const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1920 + 1 }, (_, i) => CURRENT_YEAR - i);
export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
export const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
export const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

// ============================================================
// Conversion: PersonFieldValues → BirthDataFormValues
// ============================================================

/**
 * Convert PersonBirthFields state (separate field values) to the
 * BirthDataFormValues format required by birth-profiles-api.ts.
 */
export function toBirthDataFormValues(fields: PersonFieldValues) {
  const birthDate = fields.year && fields.month && fields.day
    ? `${fields.year}-${fields.month.padStart(2, '0')}-${fields.day.padStart(2, '0')}`
    : '';

  const hour24 = to24Hour(fields.hour, fields.period);
  const birthTime = fields.quickMode
    ? ''
    : (hour24 && fields.minute !== ''
      ? `${hour24}:${String(fields.minute).padStart(2, '0')}`
      : '');

  return {
    name: fields.name,
    gender: (fields.gender || 'male') as 'male' | 'female',
    birthDate,
    birthTime,
    birthCity: fields.cityCode,
    birthTimezone: fields.timezone,
    isLunarDate: fields.calendarType === 'lunar',
    isLeapMonth: fields.isLeapMonth,
  };
}

/**
 * Convert a BirthProfile (from API) to PersonFieldValues
 * for pre-filling PersonBirthFields.
 */
export function profileToPersonFields(profile: {
  name: string;
  gender: string;
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
  isLunarDate?: boolean;
  isLeapMonth?: boolean;
}): PersonFieldValues {
  const dateStr = profile.birthDate.substring(0, 10); // "1990-05-15T00:00:00.000Z" → "1990-05-15"
  const [year, month, day] = dateStr.split('-');

  let hour = '';
  let minute = '';
  let period: 'AM' | 'PM' = 'AM';
  if (profile.birthTime) {
    const parts = profile.birthTime.split(':');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const converted = to12Hour(parts[0]);
      hour = converted.hour12;
      minute = parts[1];
      period = converted.period;
    }
  }

  // Determine region code from city
  const regionCode = (profile.birthCity && getRegionForCity(profile.birthCity)) || '';

  return {
    name: profile.name,
    gender: profile.gender.toLowerCase() === 'male' ? 'male' : 'female',
    calendarType: profile.isLunarDate ? 'lunar' : 'solar',
    year: year || '',
    month: month ? String(parseInt(month)) : '', // remove leading zero
    day: day ? String(parseInt(day)) : '',
    hour,
    minute: minute ? String(parseInt(minute)) : '',
    period,
    isLeapMonth: profile.isLeapMonth || false,
    regionCode,
    cityCode: profile.birthCity || '',
    timezone: profile.birthTimezone || '',
    quickMode: !profile.birthTime,
  };
}
