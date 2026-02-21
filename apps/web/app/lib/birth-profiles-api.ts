/**
 * API client for birth profile CRUD operations.
 * Calls NestJS backend endpoints at /api/users/me/birth-profiles.
 */

import { apiFetch } from './api';
import type { BirthDataFormValues } from '../components/BirthDataForm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BirthProfile {
  id: string;
  name: string;
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
  birthLongitude: number | null;
  birthLatitude: number | null;
  gender: 'MALE' | 'FEMALE';
  relationshipTag: 'SELF' | 'FAMILY' | 'FRIEND';
  isPrimary: boolean;
  isLunarDate: boolean;
  lunarBirthDate: string | null;
  isLeapMonth: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBirthProfilePayload {
  name: string;
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
  gender: 'MALE' | 'FEMALE';
  relationshipTag?: 'SELF' | 'FAMILY' | 'FRIEND';
  isPrimary?: boolean;
  isLunarDate?: boolean;
  lunarBirthDate?: string;
  isLeapMonth?: boolean;
}

export type UpdateBirthProfilePayload = Partial<CreateBirthProfilePayload>;

// ---------------------------------------------------------------------------
// Gender Conversion Helpers
// ---------------------------------------------------------------------------

export function genderToApi(g: 'male' | 'female'): 'MALE' | 'FEMALE' {
  return g === 'male' ? 'MALE' : 'FEMALE';
}

export function genderFromApi(g: 'MALE' | 'FEMALE'): 'male' | 'female' {
  return g === 'MALE' ? 'male' : 'female';
}

// ---------------------------------------------------------------------------
// Form ↔ API Conversion Helpers
// ---------------------------------------------------------------------------

/** Convert a backend BirthProfile to frontend BirthDataFormValues. */
export function profileToFormValues(profile: BirthProfile): BirthDataFormValues {
  return {
    name: profile.name,
    gender: genderFromApi(profile.gender),
    birthDate: profile.birthDate.substring(0, 10), // "1990-05-15T00:00:00.000Z" → "1990-05-15"
    birthTime: profile.birthTime,
    birthCity: profile.birthCity,
    birthTimezone: profile.birthTimezone,
    isLunarDate: profile.isLunarDate ?? false,
    isLeapMonth: profile.isLeapMonth ?? false,
  };
}

/** Convert frontend BirthDataFormValues to backend CreateBirthProfilePayload. */
export function formValuesToPayload(
  data: BirthDataFormValues,
  relationshipTag?: string,
  lunarBirthDate?: string,
): CreateBirthProfilePayload {
  return {
    name: data.name,
    birthDate: data.birthDate,
    birthTime: data.birthTime,
    birthCity: data.birthCity,
    birthTimezone: data.birthTimezone,
    gender: genderToApi(data.gender),
    relationshipTag: (relationshipTag as 'SELF' | 'FAMILY' | 'FRIEND') || 'SELF',
    isLunarDate: data.isLunarDate || false,
    lunarBirthDate: data.isLunarDate ? lunarBirthDate : undefined,
    isLeapMonth: data.isLeapMonth || false,
  };
}

// ---------------------------------------------------------------------------
// CRUD Functions
// ---------------------------------------------------------------------------

/** Fetch all birth profiles for the current user. */
export async function fetchBirthProfiles(token: string): Promise<BirthProfile[]> {
  return apiFetch<BirthProfile[]>('/api/users/me/birth-profiles', { token });
}

/** Create a new birth profile. */
export async function createBirthProfile(
  token: string,
  payload: CreateBirthProfilePayload,
): Promise<BirthProfile> {
  return apiFetch<BirthProfile>('/api/users/me/birth-profiles', {
    method: 'POST',
    token,
    body: JSON.stringify(payload),
  });
}

/** Update an existing birth profile. */
export async function updateBirthProfile(
  token: string,
  id: string,
  payload: UpdateBirthProfilePayload,
): Promise<BirthProfile> {
  return apiFetch<BirthProfile>(`/api/users/me/birth-profiles/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(payload),
  });
}

/** Delete a birth profile. */
export async function deleteBirthProfile(
  token: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/users/me/birth-profiles/${id}`, {
    method: 'DELETE',
    token,
  });
}
