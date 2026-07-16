/**
 * Authed API client for the mobile app. `apiFetch` is the generic wrapper used
 * by all feature code (Clerk Bearer injection + JSON + typed errors + 401
 * handling). The language helpers below predate it and are kept for language.tsx.
 */

import type { Language } from '@repo/shared';
import { env } from './env';

const API_BASE = env.apiUrl;

/** Typed API error carrying the HTTP status + the NestJS error `code` when present. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Global 401 handler. The app sets this once (in the root layout) to redirect an
 * expired session to sign-in — mirrors web's redirectToSignInOnExpiry without
 * hard-coding navigation into the client. No-op until set.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}
/** Invoke the registered 401 handler (session-expiry sign-out + redirect).
 *  Used by the SSE streaming seam, which handles its own responses. No-op until set. */
export function notifyUnauthorized(): void {
  onUnauthorized?.();
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body' | 'headers'> {
  /** Clerk session token (from useAuth().getToken()). Omit for public routes. */
  token?: string | null;
  /** JSON body — serialized automatically; sets Content-Type. */
  body?: unknown;
  /** Extra headers as a plain object (a Headers instance would be lost in the spread). */
  headers?: Record<string, string>;
}

/**
 * Fetch a JSON endpoint on the NestJS API. Injects Auth + JSON headers, parses
 * the typed error envelope, and fires the 401 handler when an authed request is
 * rejected (expired session).
 */
export async function apiFetch<T = unknown>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { token, body, headers, ...rest } = opts;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && token) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    let message = `${rest.method ?? 'GET'} ${path} failed: ${res.status}`;
    let code: string | undefined;
    try {
      const errBody = (await res.json()) as { message?: string; code?: string };
      if (errBody.message) message = errBody.message;
      if (errBody.code) code = errBody.code;
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new ApiError(message, res.status, code);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Language helpers (kept from the original skeleton; used by language.tsx) ---

/** Prisma `Language` enum (ZH_TW/ZH_CN) → UI kebab (matches @repo/shared `Language`). */
export function langEnumToKebab(v: string | null | undefined): Language {
  return v === 'ZH_CN' ? 'zh-CN' : 'zh-TW';
}

/** UI kebab → the Prisma `Language` enum value PATCH /api/users/me expects. */
export function langKebabToEnum(v: Language): 'ZH_TW' | 'ZH_CN' {
  return v === 'zh-CN' ? 'ZH_CN' : 'ZH_TW';
}

export type SubscriptionTier = 'FREE' | 'BASIC' | 'PRO' | 'MASTER';

export interface MobileUserProfile {
  languagePref: Language;
  languageChosen: boolean;
  credits: number;
  subscriptionTier: SubscriptionTier;
}

interface RawUserMe {
  languagePref?: string | null;
  languageChosen?: boolean;
  credits?: number;
  subscriptionTier?: string;
}

/** GET /api/users/me — the full user; we surface language + credits + tier. */
export async function getUserProfile(token: string): Promise<MobileUserProfile> {
  const raw = await apiFetch<RawUserMe>('/api/users/me', { token });
  return {
    languagePref: langEnumToKebab(raw.languagePref),
    languageChosen: raw.languageChosen ?? false,
    credits: raw.credits ?? 0,
    subscriptionTier: (raw.subscriptionTier as SubscriptionTier) ?? 'FREE',
  };
}

/** PATCH /api/users/me — persist the chosen script (marks it explicitly chosen). */
export async function updateLanguagePref(
  token: string,
  pref: Language,
  markChosen = true,
): Promise<void> {
  await apiFetch('/api/users/me', {
    method: 'PATCH',
    token,
    body: { languagePref: langKebabToEnum(pref), languageChosen: markChosen },
  });
}

/**
 * DELETE /api/users/me — permanently anonymize the account (Apple 5.1.1(v)).
 * The backend BLOCKS with an `ACTIVE_IAP_SUBSCRIPTION` code (surfaced as
 * `ApiError.code`) when the user still holds an active App Store / Play
 * subscription — pass `acknowledgeIap=true` after they confirm they cancelled
 * it in the store.
 */
export async function deleteAccount(token: string, acknowledgeIap = false): Promise<void> {
  await apiFetch(`/api/users/me${acknowledgeIap ? '?acknowledgeIap=true' : ''}`, {
    method: 'DELETE',
    token,
  });
}
