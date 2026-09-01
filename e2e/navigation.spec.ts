/**
 * E2E Tests: Cross-Page Navigation
 * Tests navigation flows between pages, route protection,
 * and link integrity across the platform.
 */
import { test, expect } from '@playwright/test';

/**
 * ⚠️ SKIPPED — this file's premise was removed, not broken.
 *
 * Full lockdown ended anonymous access. This file visits /, /pricing, /admin and /reading/*, so a
 * signed-out run is redirected to sign-in and every assertion below runs
 * against the WRONG PAGE. The failures that produces name missing headings and
 * absent locators, which sends a reader hunting for a UI regression instead of
 * telling them the page needs an account.
 *
 * Left in place rather than deleted: these pages still exist for signed-in
 * users, so this is coverage waiting for an authenticated E2E fixture. The
 * `__e2e_auth` cookie bypass is NOT that fixture — it covers `/reading/*` only,
 * and widening a backdoor through a security control to suit tests is the
 * wrong trade.
 *
 * The behaviour that REPLACED this is covered, and passing:
 * `e2e/signed-out-lockdown.spec.ts`.
 */
test.skip(true, 'anonymous access removed by full lockdown — see e2e/signed-out-lockdown.spec.ts');


test.describe('Navigation - Public Routes', () => {
  test('landing page → pricing', async ({ page }) => {
    await page.goto('/');
    // There should be some way to get to pricing (footer, nav, etc.)
    // For now, verify pricing page loads directly
    await page.goto('/pricing');
    await expect(page.getByText('選擇您的方案')).toBeVisible();
  });

  test('pricing → reading page via direct URL', async ({ page }) => {
    await page.goto('/reading/lifetime');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('八字終身運');
  });

  test('pricing page → contact link exists', async ({ page }) => {
    await page.goto('/pricing');
    const contactLink = page.getByRole('link', { name: '聯絡我們' });
    await expect(contactLink).toHaveAttribute('href', '/contact');
  });

  test('reading page back button works', async ({ page }) => {
    await page.goto('/reading/career');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('八字事業詳批');

    // Click back button (has CSS class backLink)
    const backBtn = page.locator('button[class*="backLink"]');
    await backBtn.click();

    // Should navigate to dashboard (which may redirect to sign-in)
    await page.waitForURL(/dashboard|sign-in/, { timeout: 10000 });
  });
});

test.describe('Navigation - Protected Routes Redirect', () => {
  test('all dashboard routes redirect unauthenticated users', async ({ page }) => {
    const protectedRoutes = [
      '/dashboard',
      '/dashboard/profiles',
      '/dashboard/readings',
      '/dashboard/subscription',
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await page.waitForURL(/sign-in/, { timeout: 10000 }).catch(() => {});

      const currentUrl = page.url();
      const isRedirected =
        currentUrl.includes('sign-in') ||
        (await page.locator('[data-clerk-component]').count()) > 0;

      expect(isRedirected, `${route} should redirect to sign-in`).toBeTruthy();
    }
  });

  test('admin routes redirect unauthenticated users', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL(/sign-in/, { timeout: 10000 }).catch(() => {});

    const currentUrl = page.url();
    const isRedirected =
      currentUrl.includes('sign-in') ||
      (await page.locator('[data-clerk-component]').count()) > 0;

    expect(isRedirected).toBeTruthy();
  });
});

test.describe('Navigation - Public API Routes', () => {
  test('Bazi calculate API route responds', async ({ request }) => {
    // The /api/bazi-calculate route should accept POST
    // (may fail if Python engine isn't running, but should not 404)
    const response = await request.post('/api/bazi-calculate', {
      data: {
        birth_date: '1990-01-15',
        birth_time: '08:00',
        birth_city: '台北',
        birth_timezone: 'Asia/Taipei',
        gender: 'male',
      },
    });

    // Should be 200 (if engine running) or 500/503 (engine not available)
    // but NOT 404 (route exists)
    expect(response.status()).not.toBe(404);
  });

});
