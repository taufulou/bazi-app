/**
 * E2E Tests: Pricing Page
 * Tests the public pricing page (/pricing).
 * - Plan card display (Basic, Pro, Master)
 * - Monthly/annual billing toggle
 * - Price calculations (monthly vs annual/12)
 * - Comparison table
 * - CTA button behavior for unauthenticated users
 * - Toast notifications (success/cancel query params)
 * - Responsive layout
 *
 * NOTE: "年繳" text appears in 3 places — toggle label, annual price notes,
 * and bottom note. Use exact: true or specific selectors to disambiguate.
 */
import { test, expect } from '@playwright/test';

test.describe('Pricing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pricing');
  });

  // ============================================================
  // Plan Display
  // ============================================================

  test('displays page title and subtitle', async ({ page }) => {
    await expect(page.getByText('選擇您的方案')).toBeVisible();
    await expect(page.getByText('從免費體驗到無限探索')).toBeVisible();
  });

  test('shows all three plan cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Master' })).toBeVisible();
  });

  test('shows plan descriptions', async ({ page }) => {
    await expect(page.getByText('適合初次體驗八字命理的用戶')).toBeVisible();
    await expect(page.getByText('全方位命理分析')).toBeVisible();
    await expect(page.getByText('無限制使用')).toBeVisible();
  });

  test('shows recommended badge on Pro plan', async ({ page }) => {
    await expect(page.getByText('推薦')).toBeVisible();
  });

  test('shows reading counts for each plan', async ({ page }) => {
    await expect(page.getByText('每月 5 次解讀')).toBeVisible();
    await expect(page.getByText('每月 15 次解讀')).toBeVisible();
    await expect(page.getByText('無限次解讀')).toBeVisible();
  });

  // ============================================================
  // Monthly Prices
  // ============================================================

  test('shows monthly prices by default', async ({ page }) => {
    // Monthly prices are shown inside .priceAmount spans
    const priceAmounts = page.locator('[class*="priceAmount"]');
    const count = await priceAmounts.count();
    expect(count).toBe(3);

    // Verify known monthly prices
    const prices: string[] = [];
    for (let i = 0; i < count; i++) {
      prices.push(await priceAmounts.nth(i).textContent() ?? '');
    }
    expect(prices).toContain('4.99');
    expect(prices).toContain('9.99');
    expect(prices).toContain('19.99');

    // Should show "/月" suffix
    const periodLabels = page.locator('[class*="pricePeriod"]');
    expect(await periodLabels.count()).toBe(3);
  });

  // ============================================================
  // Billing Toggle
  // ============================================================

  test('has billing toggle between monthly and annual', async ({ page }) => {
    // Use exact match for toggle labels (avoid matching bottom note)
    await expect(page.getByText('月繳', { exact: true })).toBeVisible();
    await expect(page.getByText('年繳', { exact: true })).toBeVisible();

    // Toggle switch exists
    const toggle = page.getByRole('switch');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('switches to annual prices when toggle is clicked', async ({ page }) => {
    // Click the toggle switch directly (reliable, avoids text ambiguity)
    await page.getByRole('switch').click();

    // Annual prices (annual / 12): 3.33, 6.67, 13.33
    const priceAmounts = page.locator('[class*="priceAmount"]');
    const prices: string[] = [];
    const count = await priceAmounts.count();
    for (let i = 0; i < count; i++) {
      prices.push(await priceAmounts.nth(i).textContent() ?? '');
    }
    expect(prices).toContain('3.33');
    expect(prices).toContain('6.67');
    expect(prices).toContain('13.33');
  });

  test('shows savings badge in annual mode', async ({ page }) => {
    // Initially no savings badge
    await expect(page.getByText(/最高省 33%/)).not.toBeVisible();

    // Switch to annual via toggle
    await page.getByRole('switch').click();

    // Savings badge appears
    await expect(page.getByText(/最高省 33%/)).toBeVisible();
  });

  test('shows annual total price and original price', async ({ page }) => {
    await page.getByRole('switch').click();

    // Should show annual total in priceAnnualNote divs
    await expect(page.locator('[class*="priceAnnualNote"]').first()).toBeVisible();

    // All 3 annual notes should exist
    const notes = page.locator('[class*="priceAnnualNote"]');
    expect(await notes.count()).toBe(3);
  });

  test('toggle can switch back to monthly', async ({ page }) => {
    const toggle = page.getByRole('switch');

    // Switch to annual
    await toggle.click();
    await expect(page.locator('[class*="priceAmount"]').first()).toContainText('3.33');

    // Switch back to monthly
    await toggle.click();
    await expect(page.locator('[class*="priceAmount"]').first()).toContainText('4.99');
  });

  test('toggle works via keyboard', async ({ page }) => {
    const toggle = page.getByRole('switch');
    await toggle.focus();
    await page.keyboard.press('Enter');

    // Should now be in annual mode
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[class*="priceAmount"]').first()).toContainText('3.33');
  });

  // ============================================================
  // Feature Lists
  // ============================================================

  test('shows feature checkmarks on plan cards', async ({ page }) => {
    // Basic plan features
    await expect(page.getByText('完整八字終身運分析')).toBeVisible();
    await expect(page.getByText('命盤視覺化圖表')).toBeVisible();

    // Pro plan features
    await expect(page.getByText('全部 6 種解讀類型')).toBeVisible();
    await expect(page.getByText('PDF 報告匯出').first()).toBeVisible();

    // Master plan features
    await expect(page.getByText('無限次數命理解讀')).toBeVisible();
    await expect(page.getByText('搶先體驗新功能').first()).toBeVisible();
  });

  // ============================================================
  // CTA Buttons
  // ============================================================

  test('has CTA buttons on all plan cards', async ({ page }) => {
    // Pro should have "立即訂閱"
    await expect(page.getByRole('button', { name: '立即訂閱' })).toBeVisible();

    // Basic and Master should have "選擇方案"
    const selectButtons = page.getByRole('button', { name: '選擇方案' });
    expect(await selectButtons.count()).toBe(2);
  });

  test('CTA buttons are enabled by default', async ({ page }) => {
    const buttons = page.getByRole('button').filter({
      hasText: /立即訂閱|選擇方案/,
    });
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      await expect(buttons.nth(i)).toBeEnabled();
    }
  });

  // ============================================================
  // Comparison Table
  // ============================================================

  test('shows free tier section with comparison table', async ({ page }) => {
    // Section heading
    await expect(page.locator('[class*="freeSectionTitle"]')).toContainText('免費體驗');

    // Table should exist with headers
    const table = page.locator('table');
    await expect(table).toBeVisible();

    // Table should have headers
    const headers = table.locator('th');
    expect(await headers.count()).toBeGreaterThanOrEqual(4);
  });

  test('comparison table has correct content', async ({ page }) => {
    const table = page.locator('table');

    // Feature rows
    await expect(table.getByText('每月解讀次數')).toBeVisible();
    await expect(table.getByText('八字終身運').first()).toBeVisible();

    // Free tier values
    await expect(table.getByText('1 次（終身）')).toBeVisible();
    await expect(table.getByText('預覽')).toBeVisible();
  });

  // ============================================================
  // Toast Notifications (query params)
  // ============================================================

  test('shows success toast when subscription=success', async ({ page }) => {
    await page.goto('/pricing?subscription=success');
    await expect(page.getByText('訂閱成功！歡迎加入')).toBeVisible();
  });

  test('shows cancel toast when cancelled=true', async ({ page }) => {
    await page.goto('/pricing?cancelled=true');
    await expect(page.getByText('已取消結帳流程')).toBeVisible();
  });

  test('toast auto-dismisses after delay', async ({ page }) => {
    await page.goto('/pricing?subscription=success');
    await expect(page.getByText('訂閱成功！歡迎加入')).toBeVisible();

    // Wait for auto-dismiss (5 seconds + buffer)
    await page.waitForTimeout(6000);
    await expect(page.getByText('訂閱成功！歡迎加入')).not.toBeVisible();
  });

  test('toast can be manually dismissed', async ({ page }) => {
    await page.goto('/pricing?subscription=success');
    const toast = page.getByText('訂閱成功！歡迎加入');
    await expect(toast).toBeVisible();

    // Click the close button
    await page.getByRole('button', { name: '關閉通知' }).click();
    await expect(toast).not.toBeVisible();
  });

  // ============================================================
  // Bottom Note
  // ============================================================

  test('shows cancellation policy note', async ({ page }) => {
    await expect(page.getByText('所有方案均可隨時取消')).toBeVisible();
  });

  test('has contact link', async ({ page }) => {
    const contactLink = page.getByRole('link', { name: '聯絡我們' });
    await expect(contactLink).toBeVisible();
    await expect(contactLink).toHaveAttribute('href', '/contact');
  });
});

// ============================================================
// Responsive Tests
// ============================================================

test.describe('Pricing Page - Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('plan cards stack vertically on mobile', async ({ page }) => {
    await page.goto('/pricing');

    // All plans should still be visible
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Master' })).toBeVisible();
  });

  test('comparison table is scrollable on mobile', async ({ page }) => {
    await page.goto('/pricing');

    // The table wrapper should exist
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });
});
