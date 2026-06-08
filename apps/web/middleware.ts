import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

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

export default clerkMiddleware(async (auth, request) => {
  // All non-public routes require authentication.
  // Admin role check is handled by admin/layout.tsx (checks user.publicMetadata.role directly),
  // which avoids needing Clerk session token customization for publicMetadata.
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
