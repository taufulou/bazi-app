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
  birthTime: string | null; // null when hourKnown=false (時辰未知)
  hourKnown: boolean;
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
  birthTime?: string | null; // omit/null when hourKnown=false
  hourKnown?: boolean; // default true
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
    birthTime: profile.birthTime ?? "",
    hourKnown: profile.hourKnown ?? true,
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
    hourKnown: data.hourKnown ?? true,
    // 時辰未知: omit birthTime so the backend stores null and produces a 3-pillar reading.
    birthTime: (data.hourKnown ?? true) ? data.birthTime : undefined,
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
  // hourKnown is IMMUTABLE after creation: the server's UpdateBirthProfileDto
  // deliberately omits it, so the global ValidationPipe (forbidNonWhitelisted)
  // rejects any update carrying it with 400 "property hourKnown should not exist".
  // formValuesToPayload always sets it (needed for CREATE) and BOTH callers pass
  // that full payload — dashboard/profiles/page.tsx and reading/[type]/page.tsx —
  // so every full-payload profile edit was failing. (Set-primary kept working
  // because its payload is just { isPrimary: true }.) Stripping at this one seam
  // covers both paths; mirrors the same fix in apps/mobile.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-to-drop the immutable field
  const { hourKnown: _immutable, ...updatable } = payload;
  return apiFetch<BirthProfile>(`/api/users/me/birth-profiles/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(updatable),
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
