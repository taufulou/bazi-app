/**
 * Traditional → Simplified conversion for the mobile app (繁 → 簡).
 *
 * Mirror of the web `app/lib/zh-convert.ts`, minus the DOM-walking (React Native has
 * no DOM — conversion happens at render via the `useZh()` hook / `<T>` component).
 *
 * CRASH-SAFETY: `opencc-js` is loaded via a dynamic `import()` wrapped in try/catch.
 * If it fails to bundle/load under Metro/Hermes (the one un-validated runtime unknown),
 * conversion silently degrades to identity — the app stays Traditional and NEVER crashes.
 */

type Converter = (input: string) => string;

let converter: Converter | null = null;
let converterPromise: Promise<Converter | null> | null = null;

/** Lazy-load + memoize the OpenCC `tw → cn` converter. Never throws. */
export async function ensureConverter(): Promise<Converter | null> {
  if (converter) return converter;
  if (!converterPromise) {
    converterPromise = (async () => {
      try {
        const OpenCC = await import('opencc-js');
        const conv = OpenCC.Converter({ from: 'tw', to: 'cn' });
        converter = conv;
        return conv;
      } catch {
        // opencc-js failed to load under Metro/Hermes — degrade to Traditional.
        return null;
      }
    })();
  }
  return converterPromise;
}

export function isConverterReady(): boolean {
  return converter !== null;
}

// CJK Unified (incl. Ext A) + compatibility ideographs — where 繁/簡 differ.
const CJK_RE = /[㐀-鿿豈-﫿]/;

export function isCJK(s: string): boolean {
  return CJK_RE.test(s);
}

/** Synchronous conversion. No-op (returns input) until the converter loads or for
 *  non-Han strings — safe to call anywhere, including before `ensureConverter()`. */
export function convertText(s: string): string {
  if (!converter || !s || !CJK_RE.test(s)) return s;
  return converter(s);
}
