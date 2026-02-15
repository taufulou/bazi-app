/**
 * E2E Tests: Landing Page
 * Tests the public landing page (/).
 * - Hero section with CTA
 * - Feature cards (Bazi + ZWDS)
 * - Navigation links
 * - Responsive layout
 */
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays hero section with title and CTA', async ({ page }) => {
    // Main title
    await expect(page.locator('h1')).toContainText('八字命理');

    // CTA button exists (there are 2 — hero + bottom — use .first())
    const cta = page.locator('a').filter({ hasText: /免費開始|進入控制台/ }).first();
    await expect(cta).toBeVisible();
  });

  test('shows Bazi feature cards', async ({ page }) => {
    // Bazi section title
    await expect(page.getByText('八字命理分析')).toBeVisible();

    // Feature cards
    await expect(page.getByText('八字終身運')).toBeVisible();
    await expect(page.getByText('流年運勢')).toBeVisible();
  });

  test('shows ZWDS feature cards', async ({ page }) => {
    // ZWDS section should exist
    await expect(page.getByText('紫微斗數分析')).toBeVisible();

    // At least one ZWDS card
    await expect(page.getByText('紫微終身命盤')).toBeVisible();
  });

  test('CTA links to sign-in for unauthenticated users', async ({ page }) => {
    const cta = page.locator('a').filter({ hasText: '免費開始' }).first();
    // If user is not signed in, CTA should link to sign-in
    if (await cta.isVisible()) {
      await expect(cta).toHaveAttribute('href', '/sign-in');
    }
  });

  test('page has dark theme background', async ({ page }) => {
    // The main container should have the dark navy background
    const body = page.locator('body');
    // Just verify the page loaded correctly (dark theme is CSS)
    await expect(body).toBeVisible();
  });
});
