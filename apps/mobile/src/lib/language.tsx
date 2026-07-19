import * as React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Text, type TextProps } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import type { Language } from '@repo/shared';
import { convertText, ensureConverter, isConverterReady } from './zh-convert';
import { getUserProfile, updateLanguagePref } from './api';

/**
 * Mobile 繁/簡 provider. Mirrors the web LanguageProvider's contract but with no DOM:
 * conversion happens at render via `useZh()` / `<T>`.
 *
 *  - Seeds `lang` synchronously-ish from a SecureStore cache (instant relaunch),
 *    then reconciles against the authoritative DB pref via GET /api/users/me.
 *  - `changeLanguage` persists to the DB (PATCH) + cache, then re-renders in place
 *    (no reload needed — RN re-renders on state change in both directions).
 *  - Crash-safe: the underlying converter degrades to identity if opencc-js fails
 *    to load, so the app stays Traditional and never crashes.
 *
 * `useZh()` / `useLang()` are provider-OPTIONAL (identity / 'zh-TW' default).
 */

const STORE_KEY = 'lang_pref';
const identity = (s: string): string => s;

interface LanguageContextValue {
  lang: Language;
  convert: (s: string) => string;
  changeLanguage: (next: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLang(): Language {
  return useContext(LanguageContext)?.lang ?? 'zh-TW';
}

export function useZh(): (s: string) => string {
  return useContext(LanguageContext)?.convert ?? identity;
}

/** Provider-OPTIONAL — no-op when no provider is mounted. */
export function useChangeLanguage(): (next: Language) => Promise<void> {
  return useContext(LanguageContext)?.changeLanguage ?? (async () => {});
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  const [lang, setLang] = useState<Language>('zh-TW');
  const [ready, setReady] = useState<boolean>(isConverterReady());

  const applyLang = useCallback(async (next: Language) => {
    if (next === 'zh-CN') {
      await ensureConverter();
      setReady(isConverterReady());
    }
    setLang(next);
  }, []);

  // Seed from cache (fast) THEN reconcile against the authoritative DB pref —
  // sequentially in one effect so a slow cache seed can't land after (and clobber)
  // the DB value. Merged to avoid the two-effect race.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Fast path: seed from the SecureStore cache.
      try {
        const cached = await SecureStore.getItemAsync(STORE_KEY);
        if (cancelled) return;
        if (cached === 'zh-CN' || cached === 'zh-TW') {
          await applyLang(cached);
        }
      } catch {
        /* ignore */
      }
      // 2. Authoritative: DB pref when signed in (overwrites the seed).
      if (cancelled || !isSignedIn) return;
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const profile = await getUserProfile(token);
        if (cancelled) return;
        await SecureStore.setItemAsync(STORE_KEY, profile.languagePref).catch(() => {});
        await applyLang(profile.languagePref);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken is a fresh ref each render (Clerk) — omit it, else this always-mounted
    // provider re-fetches /api/users/me on every render (fetch loop). applyLang is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const changeLanguage = useCallback(
    async (next: Language) => {
      await SecureStore.setItemAsync(STORE_KEY, next).catch(() => {});
      try {
        const token = await getToken();
        if (token) await updateLanguagePref(token, next, true);
      } catch {
        /* best-effort persistence; UI follows local state */
      }
      await applyLang(next);
    },
    [getToken, applyLang],
  );

  const convert = useCallback(
    (s: string) => (lang === 'zh-CN' ? convertText(s) : s),
    // `ready` is an intentional dep: consumers re-render once the async converter
    // loads (it's not referenced in the body, so exhaustive-deps flags it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, ready],
  );

  return (
    <LanguageContext.Provider value={{ lang, convert, changeLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

/** Converting <Text> — wraps a string child through the active converter. */
export function T({ children, ...rest }: TextProps & { children: string }) {
  const zh = useZh();
  return <Text {...rest}>{zh(children)}</Text>;
}
