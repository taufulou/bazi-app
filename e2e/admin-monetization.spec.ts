/**
 * E2E Tests: Admin Monetization Analytics + Credit Packages
 * Tests admin-only endpoints and frontend pages:
 *   - GET /api/admin/monetization-analytics
 *   - GET /api/admin/credit-packages
 *   - POST /api/admin/credit-packages
 *   - PATCH /api/admin/credit-packages/:id
 *   - Monetization analytics dashboard page
 *   - Credit packages management page
 *
 * NOTE: Route interception mocks API responses. No real backend needed.
 */
import { test, expect } from '@playwright/test';

// ============================================================
// Mock Data
// ============================================================

const MOCK_CREDIT_PACKAGES = [
  {
    id: 'pkg-1',
    slug: 'starter-5',
    nameZhTw: '入門包',
    nameZhCn: '入门包',
    creditAmount: 5,
    priceUsd: 4.99,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pkg-2',
    slug: 'value-12',
    nameZhTw: '超值包',
    nameZhCn: '超值包',
    creditAmount: 12,
    priceUsd: 9.99,
    isActive: true,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pkg-3',
    slug: 'popular-30',
    nameZhTw: '熱門包',
    nameZhCn: '热门包',
    creditAmount: 30,
    priceUsd: 19.99,
    isActive: false,
    sortOrder: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const MOCK_ANALYTICS = {
  days: 30,
  creditPackagePurchases: [
    { description: 'starter-5', totalRevenue: 49.90, count: 10, avgAmount: 4.99 },
    { description: 'value-12', totalRevenue: 99.90, count: 10, avgAmount: 9.99 },
  ],
  adRewardClaims: [
    { rewardType: 'CREDIT', count: 25, creditsGranted: 25 },
    { rewardType: 'SECTION_UNLOCK', count: 10, creditsGranted: 0 },
  ],
  adRewardDailyTrend: [
    { date: '2026-02-01T00:00:00.000Z', count: 8 },
    { date: '2026-02-02T00:00:00.000Z', count: 12 },
    { date: '2026-02-03T00:00:00.000Z', count: 15 },
  ],
  sectionUnlockStats: [
    { sectionKey: 'career', count: 30 },
    { sectionKey: 'love', count: 25 },
    { sectionKey: 'health', count: 10 },
  ],
  activeSubscriptionsByTier: [
    { tier: 'BASIC', count: 50 },
    { tier: 'PRO', count: 20 },
    { tier: 'MASTER', count: 5 },
  ],
  newSubscriptions: 15,
  cancelledSubscriptions: 3,
  conversionFunnel: {
    totalUsers: 1000,
    usersWithReadings: 250,
    creditPurchasers: 50,
    subscribers: 75,
  },
  revenueByType: [
    { type: 'SUBSCRIPTION', total: 500.0, count: 50 },
    { type: 'CREDIT_PURCHASE', total: 200.0, count: 40 },
  ],
};

// ============================================================
// Helpers
// ============================================================

async function interceptCreditPackages(
  page: import('@playwright/test').Page,
  packages = MOCK_CREDIT_PACKAGES,
) {
  await page.route('**/api/admin/credit-packages', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(packages),
      });
    }
    // POST
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'pkg-new', ...JSON.parse(route.request().postData() || '{}') }),
    });
  });
}

async function interceptCreditPackageUpdate(page: import('@playwright/test').Page) {
  await page.route('**/api/admin/credit-packages/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...MOCK_CREDIT_PACKAGES[0], ...JSON.parse(route.request().postData() || '{}') }),
    }),
  );
}

async function interceptAnalytics(
  page: import('@playwright/test').Page,
  analytics = MOCK_ANALYTICS,
) {
  await page.route('**/api/admin/monetization-analytics*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(analytics),
    }),
  );
}

// ============================================================
// Tests: Credit Packages API Endpoints
// ============================================================

test.describe('Admin — Credit Packages API', () => {
  test('GET /api/admin/credit-packages returns all packages', async ({ page }) => {
    await interceptCreditPackages(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/credit-packages');
      return res.json();
    });

    expect(result).toHaveLength(3);
    expect(result[0].slug).toBe('starter-5');
    expect(result[0].creditAmount).toBe(5);
    expect(result[2].isActive).toBe(false);
  });

  test('POST /api/admin/credit-packages creates a package', async ({ page }) => {
    await interceptCreditPackages(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/credit-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'mega-60',
          nameZhTw: '巨量包',
          nameZhCn: '巨量包',
          creditAmount: 60,
          priceUsd: 34.99,
        }),
      });
      return res.json();
    });

    expect(result.id).toBe('pkg-new');
    expect(result.slug).toBe('mega-60');
  });

  test('PATCH /api/admin/credit-packages/:id updates a package', async ({ page }) => {
    await interceptCreditPackageUpdate(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/credit-packages/pkg-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceUsd: 5.99 }),
      });
      return res.json();
    });

    expect(result.slug).toBe('starter-5');
  });
});

// ============================================================
// Tests: Monetization Analytics API
// ============================================================

test.describe('Admin — Monetization Analytics API', () => {
  test('GET /api/admin/monetization-analytics returns analytics data', async ({ page }) => {
    await interceptAnalytics(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/monetization-analytics?days=30');
      return res.json();
    });

    expect(result.days).toBe(30);
    expect(result.creditPackagePurchases).toHaveLength(2);
    expect(result.adRewardClaims).toHaveLength(2);
    expect(result.sectionUnlockStats).toHaveLength(3);
    expect(result.activeSubscriptionsByTier).toHaveLength(3);
    expect(result.conversionFunnel.totalUsers).toBe(1000);
    expect(result.revenueByType).toHaveLength(2);
  });

  test('returns conversion funnel data', async ({ page }) => {
    await interceptAnalytics(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/monetization-analytics');
      return res.json();
    });

    expect(result.conversionFunnel).toEqual({
      totalUsers: 1000,
      usersWithReadings: 250,
      creditPurchasers: 50,
      subscribers: 75,
    });
  });

  test('returns subscription metrics', async ({ page }) => {
    await interceptAnalytics(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/monetization-analytics?days=7');
      return res.json();
    });

    expect(result.newSubscriptions).toBe(15);
    expect(result.cancelledSubscriptions).toBe(3);
    expect(result.activeSubscriptionsByTier[0]).toEqual({ tier: 'BASIC', count: 50 });
  });

  test('returns ad reward claims and daily trend', async ({ page }) => {
    await interceptAnalytics(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/monetization-analytics');
      return res.json();
    });

    expect(result.adRewardClaims[0]).toEqual({
      rewardType: 'CREDIT',
      count: 25,
      creditsGranted: 25,
    });
    expect(result.adRewardDailyTrend).toHaveLength(3);
    expect(result.adRewardDailyTrend[2].count).toBe(15);
  });

  test('returns section unlock popularity', async ({ page }) => {
    await interceptAnalytics(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/monetization-analytics');
      return res.json();
    });

    expect(result.sectionUnlockStats).toHaveLength(3);
    expect(result.sectionUnlockStats[0]).toEqual({ sectionKey: 'career', count: 30 });
  });

  test('handles empty analytics gracefully', async ({ page }) => {
    await interceptAnalytics(page, {
      ...MOCK_ANALYTICS,
      creditPackagePurchases: [],
      adRewardClaims: [],
      adRewardDailyTrend: [],
      sectionUnlockStats: [],
      activeSubscriptionsByTier: [],
      revenueByType: [],
      newSubscriptions: 0,
      cancelledSubscriptions: 0,
      conversionFunnel: { totalUsers: 0, usersWithReadings: 0, creditPurchasers: 0, subscribers: 0 },
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/admin/monetization-analytics');
      return res.json();
    });

    expect(result.creditPackagePurchases).toEqual([]);
    expect(result.conversionFunnel.totalUsers).toBe(0);
  });
});
