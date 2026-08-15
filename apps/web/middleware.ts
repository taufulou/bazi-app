import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { parseAuthorizedParties } from './app/lib/authorized-parties';

// Public routes that don't require authentication.
//
// Global Signed-Out Handler (Layer B lockdown): everything NOT listed here is
// server-locked via `auth.protect()` → instant redirect to sign-in for signed-out
// users (homepage, /pricing, /store, /dashboard/*, /admin/*). `/pricing` + `/store`
// were intentionally REMOVED from this list per the full-lockdown decision.
//
// `/reading(.*)` is deliberately KEPT public so the `__e2e_auth=1` cookie-bypass
// Playwright specs (compatibility + career-reading) keep working (they have no
// real Clerk session, so `auth.protect()` would block them). Real signed-out
// users on `/reading/*` are redirected CLIENT-side by Layer A (SignedOutRedirect),
// which short-circuits when the E2E cookie is present.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/zwds-calculate(.*)',
  '/api/bazi-calculate(.*)',
  '/api/explain-element(.*)',
  '/api/og(.*)', // crawler-facing OG-image routes (social share previews — no auth)
  '/reading(.*)', // kept public for E2E cookie-bypass; guarded client-side by Layer A
]);

// B5 — the SECOND Clerk token verifier in this monorepo.
//
// `clerkMiddleware` runs its own `verifyToken` (and accepts a bearer header, not
// just the session cookie), so leaving it without an `azp` allowlist meant the
// two halves of the app disagreed about what "a valid token" is: the NestJS API
// checked the claim and this did not. The blast radius here is smaller — a
// foreign-origin token buys page SHELLS, since every data path goes to the API,
// which rejects it — but "the other half is stricter" is not a control.
//
// Server-side env, NOT NEXT_PUBLIC_: this is read in middleware (Node/Edge), and
// an allowlist is configuration, not a client secret. Same variable name and
// value as the API service, so the two cannot drift.
//
// Empty/unset = no check (Clerk short-circuits on a zero-length list), matching
// the API's default. See `apps/api/src/auth/clerk.guard.ts` for the full
// reasoning, including why native clients — which send no `azp` — are unaffected.
const authorizedParties = parseAuthorizedParties(
  process.env.CLERK_AUTHORIZED_PARTIES,
  (original, normalised) => {
    // The API logs the same thing at boot. Without it here, a typo'd entry is
    // silently rewritten on the web service only — and the launch-gate rule
    // ("set it on both services, they must not drift") is enforced by nothing.
    console.warn(
      `[middleware] CLERK_AUTHORIZED_PARTIES entry "${original}" normalised to ` +
        `"${normalised}". Clerk matches azp exactly and case-sensitively; fix the ` +
        `env var so both services carry the identical value.`,
    );
  },
);

if (authorizedParties.length === 0) {
  console.warn(
    '[middleware] CLERK_AUTHORIZED_PARTIES is not set — the azp claim is NOT ' +
      'checked here. Set it to the web origin(s) allowed to mint tokens, the same ' +
      'value as the API service.',
  );
}

export default clerkMiddleware(
  async (auth, request) => {
    // All non-public routes require authentication.
    // Admin role check is handled by admin/layout.tsx (checks user.publicMetadata.role directly),
    // which avoids needing Clerk session token customization for publicMetadata.
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
  },
  authorizedParties.length > 0 ? { authorizedParties } : {},
);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
