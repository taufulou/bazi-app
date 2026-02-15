/**
 * E2E Tests: Responsive Design
 * Tests that key pages render correctly on different screen sizes.
 * Verifies dark theme, layout adapts, and no content overflow.
 *
 * NOTE: Use role="switch" for billing toggle (avoids "年繳" text ambiguity).
 * Use [class*="headerTitle"] for reading page titles (avoids duplicate match).
 */
import { test, expect } from '@playwright/test';

test.describe('Responsive - Desktop (1280x720)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('pricing page shows plan cards in grid layout', async ({ page }) => {
    await page.goto('/pricing');

    const basic = page.getByRole('heading', { name: 'Basic' });
    const pro = page.getByRole('heading', { name: 'Pro' });
    const master = page.getByRole('heading', { name: 'Master' });

    await expect(basic).toBeVisible();
    await expect(pro).toBeVisible();
    await expect(master).toBeVisible();

    // On desktop, cards should be side by side (check bounding boxes)
    const basicBox = await basic.boundingBox();
    const proBox = await pro.boundingBox();
    const masterBox = await master.boundingBox();

    if (basicBox && proBox && masterBox) {
      // All should be at roughly the same Y position (same row)
      expect(Math.abs(basicBox.y - proBox.y)).toBeLessThan(50);
      expect(Math.abs(proBox.y - masterBox.y)).toBeLessThan(50);
    }
  });

  test('landing page hero is centered', async ({ page }) => {
    await page.goto('/');

    const title = page.locator('h1');
    await expect(title).toBeVisible();

    const box = await title.boundingBox();
    if (box) {
      // Title should be roughly centered (within 200px of center)
      const centerX = 1280 / 2;
      const titleCenterX = box.x + box.width / 2;
      expect(Math.abs(titleCenterX - centerX)).toBeLessThan(200);
    }
  });
});

test.describe('Responsive - Tablet (768x1024)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('pricing page is usable on tablet', async ({ page }) => {
    await page.goto('/pricing');

    // All plans should be visible
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Master' })).toBeVisible();

    // Toggle should work (use role="switch" to avoid text ambiguity)
    await page.getByRole('switch').click();
    await expect(page.locator('[class*="priceAmount"]').first()).toContainText('3.33');
  });

  test('reading form fits tablet width', async ({ page }) => {
    await page.goto('/reading/lifetime');

    const form = page.locator('form').first();
    if (await form.isVisible()) {
      const box = await form.boundingBox();
      if (box) {
        // Form should not overflow viewport
        expect(box.x + box.width).toBeLessThanOrEqual(768 + 10);
      }
    }
  });
});

test.describe('Responsive - Mobile (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('pricing page is usable on mobile', async ({ page }) => {
    await page.goto('/pricing');

    // All content should be visible (may need scrolling)
    await expect(page.getByText('選擇您的方案')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();

    // Billing toggle should work (use role="switch")
    await page.getByRole('switch').click();
    await expect(page.getByText(/最高省 33%/)).toBeVisible();
  });

  test('reading page form is usable on mobile', async ({ page }) => {
    await page.goto('/reading/zwds-career');

    // Form should be visible and usable (use headerTitle to avoid duplicate text)
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微事業運');

    const nameInput = page.locator('input[type="text"]').first();
    await expect(nameInput).toBeVisible();

    // Input should be tappable
    await nameInput.fill('手機測試');
    await expect(nameInput).toHaveValue('手機測試');
  });

  test('landing page hero fits mobile screen', async ({ page }) => {
    await page.goto('/');

    const title = page.locator('h1');
    await expect(title).toBeVisible();

    const box = await title.boundingBox();
    if (box) {
      // Title should not overflow mobile viewport
      expect(box.x + box.width).toBeLessThanOrEqual(390 + 10);
    }
  });

  test('no horizontal scroll on mobile pricing page', async ({ page }) => {
    await page.goto('/pricing');

    // Check if page has horizontal scroll
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);

    // Allow small tolerance (5px) for sub-pixel rendering
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});

test.describe('Dark Theme Verification', () => {
  test('pricing page has dark background', async ({ page }) => {
    await page.goto('/pricing');

    const bgColor = await page.evaluate(() => {
      const el = document.querySelector('[class*="pageContainer"]') || document.body;
      return window.getComputedStyle(el).backgroundColor;
    });

    // Background should be dark (RGB values low)
    // #1a1a2e = rgb(26, 26, 46)
    // Accept any dark color (R+G+B < 200)
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      expect(r + g + b).toBeLessThan(200);
    }
  });

  test('reading page has dark background', async ({ page }) => {
    await page.goto('/reading/lifetime');

    const bgColor = await page.evaluate(() => {
      const el = document.querySelector('[class*="pageContainer"]') || document.body;
      return window.getComputedStyle(el).backgroundColor;
    });

    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      expect(r + g + b).toBeLessThan(200);
    }
  });
});
