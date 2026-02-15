import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/zwds-calculate(.*)',
  '/api/bazi-calculate(.*)',
  '/reading(.*)',
  '/pricing(.*)',
  '/store(.*)',
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
