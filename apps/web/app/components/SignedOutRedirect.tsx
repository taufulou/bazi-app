'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Layer A — Global client-side signed-out watcher (Global Signed-Out Handler).
 *
 * Mounted ONCE in `app/layout.tsx` inside `<ClerkProvider>`. Renders `null`.
 *
 * This is the uniform redirect mechanism for the WHOLE app:
 *  - It is the LOAD-BEARING guard for the `/reading(.*)` subtree, which is kept
 *    middleware-PUBLIC so the `__e2e_auth=1` cookie-bypass Playwright specs
 *    (compatibility + career-reading) keep working. Real signed-out users on
 *    those pages are redirected here, client-side.
 *  - Everywhere else it is a client backstop behind the server-side middleware
 *    lockdown (Layer B) — it also catches `isSignedIn` flipping false
 *    mid-session (cross-tab sign-out, <UserButton> sign-out).
 *
 * Mid-session NestJS-API 401s are handled separately by Layer C
 * (`app/lib/auth-redirect.ts`), because cross-origin fetches don't traverse
 * Next middleware OR re-render this component.
 */
export default function SignedOutRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // Single-flight latch — prevents repeat redirects within one signed-out
  // streak. Resets when the user becomes signed-in (see below) so a
  // sign-out → sign-in → sign-out cycle within the same mounted tree re-fires.
  const redirectedRef = useRef(false);

  useEffect(() => {
    // Don't act until Clerk has hydrated — avoids a false-positive redirect of
    // a signed-in user during the initial loading window.
    if (!isLoaded) return;

    // Reset the latch whenever the user is signed-in.
    if (isSignedIn) {
      redirectedRef.current = false;
      return;
    }

    // Already on an auth page — never redirect (avoids a loop).
    if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) {
      return;
    }

    // E2E cookie bypass — mirror the existing `__e2e_auth=1` pattern used by the
    // compatibility + career-reading Playwright specs (they have no real Clerk
    // session, so without this guard they'd be bounced to /sign-in).
    if (
      typeof document !== 'undefined' &&
      document.cookie.includes('__e2e_auth=1')
    ) {
      return;
    }

    // Single-flight — only fire one redirect per signed-out streak.
    if (redirectedRef.current) return;
    redirectedRef.current = true;

    // Build the return URL from the reactive `pathname` (guaranteed current —
    // it's this effect's trigger) for the path, plus window.location.search for
    // the query. This runs inside a 'use client' effect, so `window` is always
    // defined (no typeof guard needed). We avoid useSearchParams() here, which
    // would force a <Suspense> boundary around the layout.
    const back = (pathname || window.location.pathname) + window.location.search;
    router.replace(`/sign-in?redirect_url=${encodeURIComponent(back)}`);
  }, [isLoaded, isSignedIn, pathname, router]);

  return null;
}
