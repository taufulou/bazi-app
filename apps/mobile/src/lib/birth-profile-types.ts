/**
 * Shared birth-data form value types. Extracted to its own module (vs. the web's
 * BirthDataForm.tsx) so the API client and the form component don't create a
 * component↔lib import cycle in RN.
 */

export interface BirthDataFormValues {
  name: string;
  gender: 'male' | 'female';
  birthDate: string; // "YYYY-MM-DD" — ALWAYS solar when emitted (lunar converted on submit)
  birthTime: string; // "HH:mm" 24h; "" when hourKnown=false
  hourKnown: boolean; // false → 時辰未知 → 3-pillar reading
  birthCity: string;
  birthTimezone: string; // IANA tz, e.g. "Asia/Taipei"
  isLunarDate: boolean;
  isLeapMonth: boolean;
}

export interface SaveProfileIntent {
  wantsSave: boolean;
  relationshipTag: string; // "SELF" | "FAMILY" | "FRIEND"
  existingProfileId?: string;
  lunarBirthDate?: string; // "YYYY-MM-DD" lunar, only when isLunarDate
}
