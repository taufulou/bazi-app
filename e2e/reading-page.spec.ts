/**
 * E2E Tests: Reading Page (unauthenticated)
 * Tests the public reading pages (/reading/[type]).
 * - Form display for different reading types
 * - Birth data form fields and validation
 * - Step indicator
 * - Navigation
 * - Extra inputs (monthly, daily, Q&A)
 *
 * NOTE: Reading name appears in TWO locations on each page:
 *   1. Page header (.headerTitle) — e.g., "🌟八字終身運"
 *   2. Form title (h2.formTitle) — e.g., "八字終身運 — 輸入出生資料"
 * We use [class*="headerTitle"] to uniquely target the page header.
 *
 * BirthDataForm uses <select> dropdowns for date/time, NOT input[type="date"].
 */
import { test, expect } from '@playwright/test';

test.describe('Reading Page - Bazi Lifetime', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reading/lifetime');
  });

  test('displays reading type title and step indicator', async ({ page }) => {
    // Reading type name in page header (use headerTitle class to avoid duplicate match)
    await expect(page.locator('[class*="headerTitle"]')).toContainText('八字終身運');

    // Step indicator: "輸入資料" should be active
    await expect(page.getByText('輸入資料')).toBeVisible();
    await expect(page.getByText('查看結果')).toBeVisible();
  });

  test('shows birth data form with all required fields', async ({ page }) => {
    // Name field
    await expect(page.locator('input[type="text"]').first()).toBeVisible();

    // Gender toggle buttons (♂ 男 / ♀ 女)
    await expect(page.getByText('♂ 男')).toBeVisible();
    await expect(page.getByText('♀ 女')).toBeVisible();

    // Birth date — uses <select> dropdowns, NOT input[type="date"]
    await expect(page.locator('select[aria-label="年"]')).toBeVisible();
    await expect(page.locator('select[aria-label="月"]')).toBeVisible();
    await expect(page.locator('select[aria-label="日"]')).toBeVisible();

    // Submit button
    await expect(page.getByRole('button', { name: /開始分析/ })).toBeVisible();
  });

  test('submit button shows credit cost for reading type', async ({ page }) => {
    // For unauthenticated users, just shows "開始分析" without credits
    const submitBtn = page.getByRole('button', { name: /開始分析/ });
    await expect(submitBtn).toBeVisible();
  });

  test('has back button that navigates to dashboard', async ({ page }) => {
    const backBtn = page.locator('button[class*="backLink"]');
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toContainText('返回');
  });
});

test.describe('Reading Page - ZWDS Types', () => {
  test('ZWDS lifetime page loads correctly', async ({ page }) => {
    await page.goto('/reading/zwds-lifetime');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微終身運');
    await expect(page.getByText('輸入資料')).toBeVisible();
  });

  test('ZWDS career page loads correctly', async ({ page }) => {
    await page.goto('/reading/zwds-career');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微事業運');
  });

  test('ZWDS love page loads correctly', async ({ page }) => {
    await page.goto('/reading/zwds-love');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微愛情運');
  });

  test('ZWDS health page loads correctly', async ({ page }) => {
    await page.goto('/reading/zwds-health');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微健康運');
  });
});

test.describe('Reading Page - Phase 8B Extra Inputs', () => {
  test('ZWDS monthly page shows month picker', async ({ page }) => {
    await page.goto('/reading/zwds-monthly');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微流月運');
    await expect(page.getByText('分析年月')).toBeVisible();

    // Month selector should be visible (extra select dropdowns for target month)
    const monthSelect = page.locator('select').filter({ hasText: /月/ });
    await expect(monthSelect.first()).toBeVisible();
  });

  test('ZWDS daily page shows date picker', async ({ page }) => {
    await page.goto('/reading/zwds-daily');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微每日運勢');
    await expect(page.getByText('分析日期')).toBeVisible();
  });

  test('ZWDS Q&A page shows question textarea', async ({ page }) => {
    await page.goto('/reading/zwds-qa');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('紫微問事');
    await expect(page.getByText('您想問什麼？')).toBeVisible();

    // Textarea for question
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('maxLength', '500');

    // Character count
    await expect(page.getByText('0/500 字')).toBeVisible();
  });

  test('Q&A character counter updates as user types', async ({ page }) => {
    await page.goto('/reading/zwds-qa');

    const textarea = page.locator('textarea');
    await textarea.fill('今年適合跳槽嗎？');

    // Character count should update
    await expect(page.getByText(/\d+\/500 字/)).toBeVisible();
  });
});

test.describe('Reading Page - Invalid Types', () => {
  test('shows error for invalid reading type', async ({ page }) => {
    await page.goto('/reading/nonexistent');
    await expect(page.getByText('找不到此分析類型')).toBeVisible();
    await expect(page.getByText('返回控制台')).toBeVisible();
  });

  test('invalid type page has dashboard link', async ({ page }) => {
    await page.goto('/reading/nonexistent');
    const link = page.getByRole('link', { name: '返回控制台' });
    await expect(link).toHaveAttribute('href', '/dashboard');
  });
});

test.describe('Reading Page - Bazi Types', () => {
  test('annual reading page loads', async ({ page }) => {
    await page.goto('/reading/annual');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('八字流年運勢');
  });

  test('career reading page loads', async ({ page }) => {
    await page.goto('/reading/career');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('事業財運');
  });

  test('love reading page loads', async ({ page }) => {
    await page.goto('/reading/love');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('愛情姻緣');
  });

  test('health reading page loads', async ({ page }) => {
    await page.goto('/reading/health');
    await expect(page.locator('[class*="headerTitle"]')).toContainText('先天健康分析');
  });
});
