'use client';

import * as React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { getUserProfile, updateLanguagePref, type LanguagePref } from '../lib/api';
import { LanguageContext, type LanguageContextValue } from './LanguageContext';
import {
  convertSubtree,
  convertText,
  ensureConverter,
  isConverterReady,
  startObserver,
  stopObserver,
} from '../lib/zh-convert';

/**
 * Global 繁/簡 (Traditional/Simplified) display-layer provider.
 *
 * Traditional stays the source of truth; for `zh-CN` users this provider converts
 * the rendered DOM to Simplified at the display edge:
 *  - reads a first-party `lang` cookie SYNCHRONOUSLY (so the variant is known on the
 *    first client render — no Clerk round-trip, root layout stays static);
 *  - on zh-CN, runs a full-document conversion in a layout effect (pre-paint when the
 *    opencc chunk is already cached) + a batched MutationObserver for dynamic content;
 *  - reconciles against the authoritative DB pref via GET /api/users/me;
 *  - clears the cookie on sign-out (no shared-browser leak);
 *  - changing the preference persists to the DB and applies in place (zh-CN) or
 *    reloads (revert to zh-TW — avoids Simplified→Traditional DOM-revert bookkeeping).
 *
 * `useZh()` (render-time `convert`) is provider-OPTIONAL — it returns identity when no
 * provider is mounted, so components/tests render byte-identical Traditional output.
 */

const COOKIE = 'lang';
const ONE_YEAR = 31_536_000;

function readLangCookie(): LanguagePref | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)lang=(zh-TW|zh-CN)(?:;|$)/);
  return (m?.[1] as LanguagePref) ?? null;
}

function writeLangCookie(v: LanguagePref): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
}

function clearLangCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

// Kick off the opencc chunk download as early as module-eval time (client + zh-CN)
// so it's likely cached by the time the layout effect runs → pre-paint conversion.
if (typeof document !== 'undefined' && readLangCookie() === 'zh-CN') {
  void ensureConverter();
}

// Context + consumer hooks (useLanguage/useZh/useLang/useChangeLanguage) live in the
// Clerk-free ./LanguageContext module so leaf components can consume them without
// pulling @clerk/nextjs into their (jest) module graph. This file owns only the
// provider component, which needs useAuth.

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin') ?? false;

  const [lang, setLang] = useState<LanguagePref>(() => readLangCookie() ?? 'zh-TW');
  const [languageChosen, setLanguageChosen] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Flips true once the opencc chunk has loaded. Included in `convert`'s identity so
  // render-time consumers (useZh) re-render and produce Simplified once it's ready
  // (the chunk loads async — a consumer that rendered before then must re-run).
  const [converterReady, setConverterReady] = useState<boolean>(isConverterReady());

  // Activate / refresh conversion for zh-CN. Sets <html data-lang> for fonts always.
  useIsoLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang; // 'zh-TW' | 'zh-CN' — a11y + CJK glyph hinting

    if (lang !== 'zh-CN' || isAdmin) {
      stopObserver();
      return;
    }

    if (isConverterReady()) {
      setConverterReady(true);
      convertSubtree(document.body);
      startObserver();
      return;
    }
    let cancelled = false;
    void ensureConverter().then(() => {
      if (cancelled) return;
      setConverterReady(true);
      convertSubtree(document.body);
      startObserver();
    });
    return () => {
      cancelled = true;
    };
  }, [lang, isAdmin]);

  // Reconcile against the authoritative DB pref (and learn `languageChosen`).
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setProfileLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const profile = await getUserProfile(token);
        if (cancelled) return;
        setLanguageChosen(profile.languageChosen);
        setProfileLoaded(true);

        const cookieLang = readLangCookie();
        if (profile.languagePref !== cookieLang) {
          writeLangCookie(profile.languagePref);
          if (profile.languagePref === 'zh-CN') {
            setLang('zh-CN'); // enable in place (layout effect converts)
          } else if (cookieLang === 'zh-CN') {
            stopObserver();
            window.location.reload(); // authoritative zh-TW but DOM is converted → clean revert
          } else {
            setLang('zh-TW');
          }
        }
      } catch {
        /* non-fatal — fall back to cookie-derived lang */
      }
    })();
    return () => {
      cancelled = true;
    };
    // `lang` intentionally excluded — we reconcile against the cookie, not state,
    // and don't want this to re-run on every local lang change (avoids loops).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, getToken]);

  // Clear the cookie on sign-out so a shared browser doesn't leak the prior user's
  // script to the next user (who reconciles from their own profile).
  const wasSignedInRef = useRef(false);
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      wasSignedInRef.current = true;
    } else if (wasSignedInRef.current) {
      wasSignedInRef.current = false;
      clearLangCookie();
    }
  }, [isLoaded, isSignedIn]);

  const changeLanguage = useCallback(
    async (next: LanguagePref) => {
      const prev = readLangCookie() ?? lang;
      writeLangCookie(next);
      try {
        const token = await getToken();
        if (token) await updateLanguagePref(token, next, true);
      } catch {
        /* best-effort persistence; cookie is already set so the UI follows */
      }
      setLanguageChosen(true);

      if (next === 'zh-CN') {
        await ensureConverter();
        setConverterReady(true);
        setLang('zh-CN');
        convertSubtree(document.body);
        startObserver();
      } else if (prev === 'zh-CN') {
        stopObserver();
        window.location.reload(); // revert to Traditional via a clean re-render
      } else {
        setLang('zh-TW');
      }
    },
    [lang, getToken],
  );

  const convert = useCallback(
    (s: string) => (lang === 'zh-CN' ? convertText(s) : s),
    // `converterReady` is a dep so consumers re-render once the chunk loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, converterReady],
  );

  const value: LanguageContextValue = {
    lang,
    languageChosen,
    profileLoaded,
    convert,
    changeLanguage,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
