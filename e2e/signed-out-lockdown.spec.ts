import { test, expect } from '@playwright/test';

/**
 * The Global Signed-Out Handler, asserted against the app rather than assumed.
 *
 * ## Why this file exists
 *
 * Full lockdown removed anonymous access: everything except sign-in/sign-up and
 * a short list of crawler- and webhook-facing paths now redirects a signed-out
 * visitor to the sign-in page. That deleted the premise of most of the e2e
 * suite, which was written when the landing page, pricing, the store and the
 * free reading funnel were all reachable without an account.
 *
 * Those specs were left failing. Failing tests for behaviour that was removed
 * ON PURPOSE are worse than no tests: a reader takes them for a description of
 * the product, and a real regression hides among them. This file replaces the
 * premise — it asserts the behaviour that took their place, which is a security
 * control and worth covering on its own merits.
 *
 * ## What it does NOT cover
 *
 * Only Layer A (the client watcher) and Layer B (middleware `auth.protect()`).
 * Layer C — the shared 401 handler for a session that expires mid-request — needs
 * a real Clerk session to expire and is out of reach here.
 *
 * ⚠️ Deliberately sets no `__e2e_auth` cookie. That bypass exists so the
 * compatibility and career specs can reach `/reading/*` without a Clerk
 * session, and it short-circuits both layers under test here.
 */

/** Everything a signed-out visitor must NOT reach. */
const LOCKED = [
  '/',
  '/pricing',
  '/store',
  '/dashboard',
  '/dashboard/profiles',
  '/dashboard/readings',
  '/dashboard/subscription',
  '/admin',
];

/**
 * Public BY DESIGN. The three below the auth pages exist to be fetched by
 * something that has no session and never will — a crawler, a verifier — and
 * each was 404ing to exactly those clients before M9, because the middleware
 * matcher does not skip `.txt`/`.xml`.
 */
const PUBLIC = ['/sign-in', '/sign-up', '/robots.txt', '/sitemap.xml'];

test.describe('signed-out lockdown', () => {
  for (const path of LOCKED) {
    test(`${path} sends a signed-out visitor to sign-in`, async ({ page }) => {
      await page.goto(path);
      // Either layer may win the race — middleware rewrites server-side and the
      // client watcher redirects on mount. The requirement is the destination,
      // not which layer got there first.
      await page.waitForURL(/\/sign-in/, { timeout: 15000 });
      expect(page.url()).toContain('/sign-in');
    });

    test(`${path} is refused SERVER-side, with no JS involved`, async ({ request }) => {
      // ⚠️ The browser assertion above is satisfied by Layer A ALONE. Verified:
      // re-opening `/pricing` in the middleware allowlist left it green,
      // because the client watcher still redirected. Defense in depth working
      // as designed — and a spec that cannot separate the layers would report
      // a fully removed server-side lockdown as healthy.
      //
      // So assert Layer B on its own terms: a request with no JS must not be
      // served the page. Clerk answers a protected route for a signed-out
      // caller with a rewrite (`x-clerk-auth-reason: protect-rewrite`), which
      // is not a 200.
      const res = await request.get(path);
      expect(res.status()).not.toBe(200);
    });
  }

  for (const path of PUBLIC) {
    test(`${path} stays reachable without a session`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      // A redirect to sign-in also lands on 200 once followed, so the status
      // alone proves nothing — check the destination too. Skipped for the auth
      // pages themselves, whose own URL trivially matches.
      if (!path.startsWith('/sign-')) {
        expect(new URL(res.url()).pathname).toBe(path);
      }
    });
  }

  test('a locked page preserves where the visitor was going', async ({ page }) => {
    // Without this the visitor signs in and lands on the homepage, having lost
    // the page they asked for — the whole reason the handler builds a
    // redirect_url rather than a bare redirect.
    await page.goto('/dashboard/readings');
    await page.waitForURL(/\/sign-in/, { timeout: 15000 });
    const url = new URL(page.url());
    const target =
      url.searchParams.get('redirect_url') ??
      url.searchParams.get('redirectUrl') ??
      '';
    expect(decodeURIComponent(target)).toContain('/dashboard/readings');
  });

  test('/reading/* is middleware-PUBLIC but still client-locked', async ({ page, request }) => {
    // `/reading(.*)` is deliberately kept out of `auth.protect()` so the
    // `__e2e_auth` cookie-bypass specs keep working. That makes Layer A the
    // only thing standing between a signed-out visitor and the page, so it is
    // the layer most worth asserting.
    const res = await request.get('/reading/lifetime');
    expect(res.status()).toBe(200); // server-side: not protected

    await page.goto('/reading/lifetime');
    await page.waitForURL(/\/sign-in/, { timeout: 15000 }); // client-side: redirected
  });
});
