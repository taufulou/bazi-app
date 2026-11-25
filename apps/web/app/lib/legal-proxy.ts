/**
 * Serves the API's public legal pages on this website (1B item 1).
 *
 * ONE source of text: `apps/api/src/legal/legal.controller.ts`. The web cannot
 * import from the API, and `@repo/shared` is off-limits to the NestJS runtime,
 * so the website fetches the API's HTML and returns it. These URLs —
 * tianmingapp.com/privacy, /terms, /support — are what App Store Connect gets.
 *
 * Why route handlers: they render no React tree, so neither the app layout nor
 * `SignedOutRedirect` (the client-side sign-in redirect) ever runs. That, plus
 * the middleware allowlist entries, is what makes them public in a real browser.
 *
 * ⚠️ Do NOT add a top-level `export const revalidate` or `dynamic` to the route
 * files. Either makes `next build` PRERENDER them — i.e. call the API at build
 * time, and fail or bake the fallback page into the image. The fetch-level
 * `next: { revalidate }` below keeps the route dynamic while caching: Next
 * caches only 200 responses and serves the stale copy while it revalidates, so
 * a short API outage does not take the policy down once the cache is warm.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Mirrors `CONTACT_EMAIL` in apps/api/src/legal/legal-constants.ts (parity-tested). */
export const LEGAL_CONTACT_EMAIL = 'TAPPER.FUN@gmail.com';

export type LegalPage = 'privacy' | 'terms' | 'support';

const TIMEOUT_MS = 5000;
const REVALIDATE_SECONDS = 3600;

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' } as const;

function fallbackHtml(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>暫時無法顯示 — 天命</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans TC',sans-serif;max-width:640px;margin:0 auto;padding:40px 20px;color:#3C2415;background:#FFF3E0;line-height:1.7">
<h1 style="font-size:1.4rem">此頁面暫時無法顯示</h1>
<p>請稍後再試。如需協助，請來信 <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>。</p>
</body></html>`;
}

/** Fetch one legal page from the API; a static 503 page on any failure — never a redirect. */
export async function serveLegalPage(
  page: LegalPage,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  try {
    const upstream = await fetchImpl(`${API_URL}/${page}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    } as RequestInit);
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    return new Response(await upstream.text(), { status: 200, headers: HTML_HEADERS });
  } catch {
    return new Response(fallbackHtml(), {
      status: 503,
      headers: { ...HTML_HEADERS, 'retry-after': '60' },
    });
  }
}
