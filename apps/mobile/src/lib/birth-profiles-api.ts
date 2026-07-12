/**
 * API client for birth-profile CRUD. Calls NestJS /api/users/me/birth-profiles.
 * Ported from apps/web/app/lib/birth-profiles-api.ts — adapted to the mobile
 * apiFetch (which takes a plain `body` object and serializes it, vs the web's
 * pre-stringified body).
 */

import { apiFetch } from './api';
import type { BirthDataFormValues } from './birth-profile-types';

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
  birthTime?: string | null;
  hourKnown?: boolean;
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

export function genderToApi(g: 'male' | 'female'): 'MALE' | 'FEMALE' {
  return g === 'male' ? 'MALE' : 'FEMALE';
}

export function genderFromApi(g: 'MALE' | 'FEMALE'): 'male' | 'female' {
  return g === 'MALE' ? 'male' : 'female';
}

/** Backend BirthProfile → frontend BirthDataFormValues. */
export function profileToFormValues(profile: BirthProfile): BirthDataFormValues {
  return {
    name: profile.name,
    gender: genderFromApi(profile.gender),
    birthDate: profile.birthDate.substring(0, 10),
    birthTime: profile.birthTime ?? '',
    hourKnown: profile.hourKnown ?? true,
    birthCity: profile.birthCity,
    birthTimezone: profile.birthTimezone,
    isLunarDate: profile.isLunarDate ?? false,
    isLeapMonth: profile.isLeapMonth ?? false,
  };
}

/** Frontend BirthDataFormValues → backend CreateBirthProfilePayload. */
export function formValuesToPayload(
  data: BirthDataFormValues,
  relationshipTag?: string,
  lunarBirthDate?: string,
): CreateBirthProfilePayload {
  return {
    name: data.name,
    birthDate: data.birthDate,
    hourKnown: data.hourKnown ?? true,
    // 時辰未知: omit birthTime so the backend stores null → 3-pillar reading.
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

// --- CRUD (mobile apiFetch serializes `body`; pass the object, not a string) ---

export async function fetchBirthProfiles(token: string): Promise<BirthProfile[]> {
  return apiFetch<BirthProfile[]>('/api/users/me/birth-profiles', { token });
}

export async function createBirthProfile(
  token: string,
  payload: CreateBirthProfilePayload,
): Promise<BirthProfile> {
  return apiFetch<BirthProfile>('/api/users/me/birth-profiles', {
    method: 'POST',
    token,
    body: payload,
  });
}

export async function updateBirthProfile(
  token: string,
  id: string,
  payload: UpdateBirthProfilePayload,
): Promise<BirthProfile> {
  // hourKnown is IMMUTABLE after creation: the server's UpdateBirthProfileDto
  // deliberately omits it, so the global ValidationPipe (forbidNonWhitelisted)
  // rejects any update carrying it with 400 "property hourKnown should not exist".
  // formValuesToPayload always sets it (needed for CREATE), so strip it here —
  // this one seam covers both the profile-edit and readings-save-update paths.
  const { hourKnown: _immutable, ...updatable } = payload;
  return apiFetch<BirthProfile>(`/api/users/me/birth-profiles/${id}`, {
    method: 'PATCH',
    token,
    body: updatable,
  });
}

export async function deleteBirthProfile(
  token: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/users/me/birth-profiles/${id}`, {
    method: 'DELETE',
    token,
  });
}
