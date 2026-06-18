'use client';

import { createContext, useContext } from 'react';
import type { LanguagePref } from '../lib/api';

/**
 * Clerk-FREE context + consumer hooks for the 繁/簡 feature.
 *
 * Split out from LanguageProvider so leaf components (ChatMessage, NarrativeCard,
 * AIReadingDisplay, ShareFortuneButton, …) can consume `useZh()`/`useLang()` WITHOUT
 * pulling `@clerk/nextjs` (ESM) into their module graph — which otherwise breaks the
 * Jest suites that render them (jest can't parse Clerk's ESM). The provider component
 * (which needs `useAuth`) lives in LanguageProvider and imports this context.
 *
 * `useZh()` / `useLang()` / `useChangeLanguage()` are provider-OPTIONAL — they return
 * safe defaults (identity / 'zh-TW' / no-op) when no provider is mounted, so unit tests
 * and out-of-tree renders stay Traditional / byte-identical.
 */

export interface LanguageContextValue {
  lang: LanguagePref;
  /** Whether the user has explicitly picked a script (drives the first-run modal). */
  languageChosen: boolean;
  /** True once the authoritative profile has been fetched. */
  profileLoaded: boolean;
  /** Render-time conversion (no-op for zh-TW or before the converter loads). */
  convert: (s: string) => string;
  /** Persist + apply a script choice (marks it chosen). */
  changeLanguage: (next: LanguagePref) => Promise<void>;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

const identity = (s: string): string => s;

/** Full context — for the first-run modal + settings page (always inside the provider). */
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within <LanguageProvider>');
  }
  return ctx;
}

/** Render-time converter, provider-OPTIONAL (identity when no provider). */
export function useZh(): (s: string) => string {
  const ctx = useContext(LanguageContext);
  return ctx?.convert ?? identity;
}

/** Current language, provider-OPTIONAL ('zh-TW' default). */
export function useLang(): LanguagePref {
  const ctx = useContext(LanguageContext);
  return ctx?.lang ?? 'zh-TW';
}

/** Persist+apply a language choice, provider-OPTIONAL (no-op default). */
export function useChangeLanguage(): (next: LanguagePref) => Promise<void> {
  const ctx = useContext(LanguageContext);
  return ctx?.changeLanguage ?? (async () => {});
}
