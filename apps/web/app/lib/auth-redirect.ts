/**
 * Layer C — shared mid-session 401 redirect helper (Global Signed-Out Handler).
 *
 * Cross-origin fetches to the NestJS API (`:4000`) bypass Next middleware, so a
 * token-revoked-mid-session 401 needs a client catch. Clerk auto-refreshes JWTs
 * via `getToken()`, so a genuine 401 reliably means the session is invalid →
 * redirecting is safe.
 *
 * Wire this on `response.status === 401` in the shared fetch wrappers. Only call
 * it for AUTHENTICATED requests (a token was attached) — tokenless `@Public()`
 * endpoints can legitimately 401 without meaning "your session expired".
 *
 * Uses a full `window.location.href` navigation (not `router.replace`) so the
 * redirect ALSO passes through middleware for consistency, and tears down +
 * reloads the page — which naturally clears the module-level single-flight flag.
 */
let redirecting = false;

export function redirectToSignInOnExpiry(): void {
  if (typeof window === 'undefined') return;

  // E2E cookie bypass — never redirect the `__e2e_auth=1` cookie-bypass specs.
  if (document.cookie.includes('__e2e_auth=1')) return;

  // Module-level single-flight — guards against a redirect storm when multiple
  // in-flight requests 401 simultaneously. The full navigation below resets it.
  if (redirecting) return;
  redirecting = true;

  const back = window.location.pathname + window.location.search;
  window.location.href = `/sign-in?redirect_url=${encodeURIComponent(back)}`;
}
