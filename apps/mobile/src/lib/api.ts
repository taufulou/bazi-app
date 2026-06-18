/**
 * Minimal authed API client for the mobile app — the app's first backend calls,
 * added for the language preference (read on launch, write on toggle).
 */

import type { Language } from '@repo/shared';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

/** Prisma `Language` enum (ZH_TW/ZH_CN) → UI kebab (matches @repo/shared `Language`). */
export function langEnumToKebab(v: string | null | undefined): Language {
  return v === 'ZH_CN' ? 'zh-CN' : 'zh-TW';
}

/** UI kebab → the Prisma `Language` enum value PATCH /api/users/me expects. */
export function langKebabToEnum(v: Language): 'ZH_TW' | 'ZH_CN' {
  return v === 'zh-CN' ? 'ZH_CN' : 'ZH_TW';
}

export interface MobileUserProfile {
  languagePref: Language;
  languageChosen: boolean;
}

/** GET /api/users/me — returns the language fields (server sends the full user). */
export async function getUserProfile(token: string): Promise<MobileUserProfile> {
  const res = await fetch(`${API_BASE}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/users/me failed: ${res.status}`);
  const raw = (await res.json()) as { languagePref?: string | null; languageChosen?: boolean };
  return {
    languagePref: langEnumToKebab(raw.languagePref),
    languageChosen: raw.languageChosen ?? false,
  };
}

/** PATCH /api/users/me — persist the chosen script (marks it explicitly chosen). */
export async function updateLanguagePref(
  token: string,
  pref: Language,
  markChosen = true,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ languagePref: langKebabToEnum(pref), languageChosen: markChosen }),
  });
  if (!res.ok) throw new Error(`PATCH /api/users/me failed: ${res.status}`);
}
