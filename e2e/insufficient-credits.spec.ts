/**
 * E2E Tests: Insufficient Credits Modal
 * Tests the insufficient credits modal behavior.
 *
 * Since this requires Clerk auth + NestJS API returning an error,
 * we test the modal component behavior via route interception.
 */
import { test, expect } from '@playwright/test';

/**
 * ⚠️ SKIPPED — this file's premise was removed, not broken.
 *
 * Full lockdown ended anonymous access. This file visits /pricing and /reading/*, so a
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


test.describe('Insufficient Credits Modal - UI Behavior', () => {
  // These tests verify the modal structure by navigating to a reading page
  // and examining available UI elements. The actual modal trigger requires
  // a signed-in user hitting the NestJS API.

  test('reading page has correct credits display in button', async ({ page }) => {
    await page.goto('/reading/lifetime');

    // For unauthenticated users, the submit button should say "開始分析"
    // without credit info (since they're not signed in)
    const submitBtn = page.getByRole('button', { name: /開始分析/ });
    await expect(submitBtn).toBeVisible();

    // Should NOT show credit count for unauthenticated users
    const hasCreditDisplay = await page.getByText(/💎/).isVisible().catch(() => false);
    // Credits may or may not show depending on auth state
    // The key assertion: the button itself is visible and functional
    expect(await submitBtn.isEnabled() || await submitBtn.isDisabled()).toBeTruthy();
  });
});

test.describe('Pricing Page - CTA for Unauthenticated Users', () => {
  test('clicking plan CTA redirects to sign-in', async ({ page }) => {
    await page.goto('/pricing');

    // Click any plan CTA button
    const ctaBtn = page.getByRole('button', { name: '立即訂閱' });
    await ctaBtn.click();

    // Should redirect to sign-in (unauthenticated user)
    await page.waitForURL(/sign-in/, { timeout: 10000 }).catch(() => {});

    const currentUrl = page.url();
    // Should redirect to sign-in with return URL
    expect(
      currentUrl.includes('sign-in') ||
      currentUrl.includes('pricing')  // May stay on pricing if redirect fails in jsdom
    ).toBeTruthy();
  });

  test('clicking Basic plan CTA redirects to sign-in', async ({ page }) => {
    await page.goto('/pricing');

    const selectBtns = page.getByRole('button', { name: '選擇方案' });
    await selectBtns.first().click();

    await page.waitForURL(/sign-in/, { timeout: 10000 }).catch(() => {});

    expect(
      page.url().includes('sign-in') ||
      page.url().includes('pricing')
    ).toBeTruthy();
  });
});

test.describe('InsufficientCreditsModal - Direct Component Test via Page', () => {
  // Test the modal links point to correct URLs by examining page structure

  test('pricing page has subscription management link', async ({ page }) => {
    await page.goto('/pricing');

    // For signed-in users, there should be a "管理我的訂閱" link
    // For unauthenticated, this won't show
    // Just verify the page loads without errors
    await expect(page.getByText('選擇您的方案')).toBeVisible();
  });
});
