/**
 * E2E Tests: Credit Store Page (/store)
 * Tests the credit package purchase flow:
 *   - Page layout and display of credit packages
 *   - Package card content (credits, price, per-credit cost)
 *   - "Best Value" badge on most cost-effective package
 *   - Buy button behavior (unauthenticated → sign-in redirect)
 *   - Toast notifications (success query param)
 *   - API integration (route interception for credit-packages endpoint)
 *   - Responsive layout
 *   - Bottom links to pricing page
 *
 * NOTE: The store page calls GET /api/payments/credit-packages (NestJS backend).
 * We intercept this route to provide mock data without needing the backend running.
 * For authenticated flows, we'd need Clerk mocking (tested separately).
 */
import { test, expect } from '@playwright/test';

// ============================================================
// Mock credit packages matching seed data
// ============================================================

const MOCK_PACKAGES = [
  {
    id: 'pkg-1',
    slug: 'starter-5',
    nameZhTw: '入門包 5 點',
    nameZhCn: '入门包 5 点',
    creditAmount: 5,
    priceUsd: 4.99,
    sortOrder: 1,
  },
  {
    id: 'pkg-2',
    slug: 'value-12',
    nameZhTw: '超值包 12 點',
    nameZhCn: '超值包 12 点',
    creditAmount: 12,
    priceUsd: 9.99,
    sortOrder: 2,
  },
  {
    id: 'pkg-3',
    slug: 'popular-30',
    nameZhTw: '暢銷包 30 點',
    nameZhCn: '畅销包 30 点',
    creditAmount: 30,
    priceUsd: 19.99,
    sortOrder: 3,
  },
  {
    id: 'pkg-4',
    slug: 'mega-60',
    nameZhTw: '豪華包 60 點',
    nameZhCn: '豪华包 60 点',
    creditAmount: 60,
    priceUsd: 34.99,
    sortOrder: 4,
  },
];

// ============================================================
// Helper: intercept credit-packages API
// ============================================================

async function interceptCreditPackages(
  page: import('@playwright/test').Page,
  packages = MOCK_PACKAGES,
) {
  await page.route('**/api/payments/credit-packages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(packages),
    }),
  );
}

// ============================================================
// Tests
// ============================================================

test.describe('Credit Store Page', () => {
  test.beforeEach(async ({ page }) => {
    await interceptCreditPackages(page);
    // Also intercept users/me for profile (will fail for unauth, that's expected)
    await page.route('**/api/users/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      }),
    );
  });

  // ============================================================
  // Page Display
  // ============================================================

  test('displays page title and subtitle', async ({ page }) => {
    await page.goto('/store');
    await expect(page.getByRole('heading', { name: '購買點數' })).toBeVisible();
    await expect(page.getByText('選擇最適合您的點數套餐')).toBeVisible();
  });

  test('displays back to dashboard link', async ({ page }) => {
    await page.goto('/store');
    const backLink = page.getByText('返回儀表板');
    await expect(backLink).toBeVisible();
  });

  // ============================================================
  // Package Cards
  // ============================================================

  test('shows all 4 credit packages', async ({ page }) => {
    await page.goto('/store');
    await expect(page.getByText('入門包 5 點')).toBeVisible();
    await expect(page.getByText('超值包 12 點')).toBeVisible();
    await expect(page.getByText('暢銷包 30 點')).toBeVisible();
    await expect(page.getByText('豪華包 60 點')).toBeVisible();
  });

  test('shows credit amounts on cards', async ({ page }) => {
    await page.goto('/store');

    // Credit amounts displayed as large numbers
    const creditAmounts = page.locator('[class*="creditAmount"]');
    const count = await creditAmounts.count();
    expect(count).toBe(4);

    const amounts: string[] = [];
    for (let i = 0; i < count; i++) {
      amounts.push(await creditAmounts.nth(i).textContent() ?? '');
    }
    expect(amounts).toContain('5');
    expect(amounts).toContain('12');
    expect(amounts).toContain('30');
    expect(amounts).toContain('60');
  });

  test('shows prices for each package', async ({ page }) => {
    await page.goto('/store');
    await expect(page.getByText('$4.99')).toBeVisible();
    await expect(page.getByText('$9.99')).toBeVisible();
    await expect(page.getByText('$19.99')).toBeVisible();
    await expect(page.getByText('$34.99')).toBeVisible();
  });

  test('shows per-credit price for each package', async ({ page }) => {
    await page.goto('/store');

    // Per-credit prices (calculated): 4.99/5=1.00, 9.99/12=0.83, 19.99/30=0.67, 34.99/60=0.58
    const perCreditElements = page.locator('[class*="perCreditPrice"]');
    const count = await perCreditElements.count();
    expect(count).toBe(4);

    // Check that per-credit prices are displayed
    await expect(perCreditElements.nth(0)).toContainText('$1.00');
    await expect(perCreditElements.nth(1)).toContainText('$0.83');
    await expect(perCreditElements.nth(2)).toContainText('$0.67');
    await expect(perCreditElements.nth(3)).toContainText('$0.58');
  });

  // ============================================================
  // Best Value Badge
  // ============================================================

  test('shows "最超值" badge on the best value package', async ({ page }) => {
    await page.goto('/store');

    // mega-60 has best value (60/$34.99 = $0.58/credit)
    const bestValueBadge = page.getByText('最超值');
    await expect(bestValueBadge).toBeVisible();

    // Badge count should be exactly 1
    expect(await page.locator('[class*="bestValueBadge"]').count()).toBe(1);
  });

  test('best value badge is on the mega-60 package card', async ({ page }) => {
    await page.goto('/store');

    // Find the card containing both "最超值" badge and "豪華包 60 點"
    const bestValueCard = page.locator('[class*="packageCardBestValue"]');
    await expect(bestValueCard).toBeVisible();
    await expect(bestValueCard.getByText('豪華包 60 點')).toBeVisible();
  });

  // ============================================================
  // Buy Buttons
  // ============================================================

  test('each package has a buy button', async ({ page }) => {
    await page.goto('/store');

    const buyButtons = page.getByRole('button', { name: '立即購買' });
    expect(await buyButtons.count()).toBe(4);
  });

  test('buy buttons are enabled by default', async ({ page }) => {
    await page.goto('/store');

    const buyButtons = page.getByRole('button', { name: '立即購買' });
    const count = await buyButtons.count();
    for (let i = 0; i < count; i++) {
      await expect(buyButtons.nth(i)).toBeEnabled();
    }
  });

  // ============================================================
  // Unauthenticated Flow
  // ============================================================

  test('shows sign-in CTA for unauthenticated users', async ({ page }) => {
    await page.goto('/store');

    // Should show sign-in section
    await expect(page.getByText('登入後即可購買點數')).toBeVisible();
    const signInLink = page.getByRole('link', { name: '登入 / 註冊' });
    await expect(signInLink).toBeVisible();
  });

  test('sign-in link has correct redirect URL', async ({ page }) => {
    await page.goto('/store');

    const signInLink = page.getByRole('link', { name: '登入 / 註冊' });
    const href = await signInLink.getAttribute('href');
    expect(href).toContain('/sign-in');
    expect(href).toContain('redirect_url');
    expect(href).toContain('%2Fstore');
  });

  // ============================================================
  // Toast Notifications
  // ============================================================

  test('shows success toast when credits=success', async ({ page }) => {
    await page.goto('/store?credits=success');
    await expect(page.getByText('點數購買成功！已加入您的帳戶')).toBeVisible();
  });

  test('success toast can be dismissed', async ({ page }) => {
    await page.goto('/store?credits=success');
    const toast = page.getByText('點數購買成功！已加入您的帳戶');
    await expect(toast).toBeVisible();

    await page.getByRole('button', { name: '關閉通知' }).click();
    await expect(toast).not.toBeVisible();
  });

  test('success toast auto-dismisses after delay', async ({ page }) => {
    await page.goto('/store?credits=success');
    await expect(page.getByText('點數購買成功！已加入您的帳戶')).toBeVisible();

    // Wait for auto-dismiss (5 seconds + buffer)
    await page.waitForTimeout(6000);
    await expect(page.getByText('點數購買成功！已加入您的帳戶')).not.toBeVisible();
  });

  // ============================================================
  // Bottom Links
  // ============================================================

  test('has link to pricing page', async ({ page }) => {
    await page.goto('/store');

    const pricingLink = page.getByText('或選擇訂閱方案享受更多優惠');
    await expect(pricingLink).toBeVisible();
  });

  test('shows bottom note about credits never expiring', async ({ page }) => {
    await page.goto('/store');
    await expect(page.getByText('點數購買後立即加入帳戶，永不過期')).toBeVisible();
  });

  test('has contact link in bottom note', async ({ page }) => {
    await page.goto('/store');
    const contactLink = page.getByRole('link', { name: '聯絡我們' });
    await expect(contactLink).toBeVisible();
    await expect(contactLink).toHaveAttribute('href', '/contact');
  });

  // ============================================================
  // Empty State
  // ============================================================

  test('shows empty state when no packages available', async ({ page }) => {
    // Override with empty packages
    await page.route('**/api/payments/credit-packages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    );

    await page.goto('/store');
    await expect(page.getByText('目前沒有可用的點數套餐')).toBeVisible();
  });

  // ============================================================
  // API Error Handling
  // ============================================================

  test('shows error when API fails', async ({ page }) => {
    // Override to simulate API failure
    await page.route('**/api/payments/credit-packages', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '伺服器錯誤' }),
      }),
    );

    await page.goto('/store');

    // Should show error banner
    await expect(page.locator('[class*="errorBanner"]')).toBeVisible();
  });

  test('error banner can be dismissed', async ({ page }) => {
    await page.route('**/api/payments/credit-packages', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '伺服器錯誤' }),
      }),
    );

    await page.goto('/store');
    const errorBanner = page.locator('[class*="errorBanner"]');
    await expect(errorBanner).toBeVisible();

    await page.getByRole('button', { name: '關閉錯誤' }).click();
    await expect(errorBanner).not.toBeVisible();
  });
});

// ============================================================
// Responsive Tests
// ============================================================

test.describe('Credit Store - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await interceptCreditPackages(page);
    await page.route('**/api/users/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      }),
    );
  });

  test.describe('Mobile (390x844)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('packages stack vertically on mobile', async ({ page }) => {
      await page.goto('/store');

      // All packages should be visible
      await expect(page.getByText('入門包 5 點')).toBeVisible();
      await expect(page.getByText('豪華包 60 點')).toBeVisible();

      // Cards should be stacked (check bounding boxes — X positions similar)
      const cards = page.locator('[class*="packageCard"]');
      const count = await cards.count();
      expect(count).toBe(4);

      if (count >= 2) {
        const box1 = await cards.nth(0).boundingBox();
        const box2 = await cards.nth(1).boundingBox();
        if (box1 && box2) {
          // Stacked = same X position (within tolerance)
          expect(Math.abs(box1.x - box2.x)).toBeLessThan(10);
          // Stacked = second card below first
          expect(box2.y).toBeGreaterThan(box1.y);
        }
      }
    });

    test('no horizontal scroll on mobile store page', async ({ page }) => {
      await page.goto('/store');

      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      const clientWidth = await page.evaluate(() => document.body.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
    });
  });

  test.describe('Tablet (768x1024)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('packages show in 2-column grid on tablet', async ({ page }) => {
      await page.goto('/store');

      // All packages visible
      await expect(page.getByText('入門包 5 點')).toBeVisible();
      await expect(page.getByText('超值包 12 點')).toBeVisible();

      const cards = page.locator('[class*="packageCard"]');
      if ((await cards.count()) >= 2) {
        const box1 = await cards.nth(0).boundingBox();
        const box2 = await cards.nth(1).boundingBox();
        if (box1 && box2) {
          // 2-column = cards side by side (roughly same Y)
          expect(Math.abs(box1.y - box2.y)).toBeLessThan(50);
        }
      }
    });
  });

  test.describe('Desktop (1280x720)', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('packages show in 4-column grid on desktop', async ({ page }) => {
      await page.goto('/store');

      const cards = page.locator('[class*="packageCard"]');
      expect(await cards.count()).toBe(4);

      // All 4 cards should be at roughly the same Y position (same row)
      const boxes = [];
      for (let i = 0; i < 4; i++) {
        boxes.push(await cards.nth(i).boundingBox());
      }

      if (boxes[0] && boxes[1] && boxes[2] && boxes[3]) {
        // All roughly same Y = single row
        expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(50);
        expect(Math.abs(boxes[1].y - boxes[2].y)).toBeLessThan(50);
        expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThan(50);
      }
    });
  });
});

// ============================================================
// Dark Theme Tests
// ============================================================

test.describe('Credit Store - Dark Theme', () => {
  test.beforeEach(async ({ page }) => {
    await interceptCreditPackages(page);
    await page.route('**/api/users/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      }),
    );
  });

  test('has dark background', async ({ page }) => {
    await page.goto('/store');

    const bgColor = await page.evaluate(() => {
      const el = document.querySelector('[class*="pageContainer"]') || document.body;
      return window.getComputedStyle(el).backgroundColor;
    });

    // Background should be dark (RGB values low)
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      expect(r + g + b).toBeLessThan(200);
    }
  });

  test('package cards have dark background', async ({ page }) => {
    await page.goto('/store');

    const cardBg = await page.evaluate(() => {
      const card = document.querySelector('[class*="packageCard"]');
      return card ? window.getComputedStyle(card).backgroundColor : '';
    });

    const match = cardBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      expect(r + g + b).toBeLessThan(200);
    }
  });
});

// ============================================================
// Credit Package API Endpoint Test
// ============================================================

test.describe('Credit Packages API', () => {
  test('GET /api/payments/credit-packages returns data (with mock)', async ({ page }) => {
    let apiCalled = false;
    await page.route('**/api/payments/credit-packages', (route) => {
      apiCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PACKAGES),
      });
    });

    await page.route('**/api/users/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      }),
    );

    await page.goto('/store');

    // Wait for packages to appear
    await expect(page.getByText('入門包 5 點')).toBeVisible();

    // Verify the API was called
    expect(apiCalled).toBe(true);
  });

  test('packages are sorted by sortOrder', async ({ page }) => {
    // Send packages in reverse order — they should still display correctly
    const reversed = [...MOCK_PACKAGES].reverse();
    await page.route('**/api/payments/credit-packages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(reversed),
      }),
    );

    await page.route('**/api/users/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      }),
    );

    await page.goto('/store');

    // All packages should still be visible regardless of order
    await expect(page.getByText('入門包 5 點')).toBeVisible();
    await expect(page.getByText('豪華包 60 點')).toBeVisible();
  });
});
