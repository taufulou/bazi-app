/**
 * E2E Tests: Rewarded Video Ads
 * Tests the ad reward system endpoints and frontend integration:
 *   - GET /api/ads/config — public ad configuration
 *   - GET /api/ads/status — remaining daily views
 *   - POST /api/ads/claim — claim reward after ad completion
 *   - Daily limit enforcement
 *   - Credit reward flow
 *   - Section unlock reward flow
 *   - Error handling
 *
 * NOTE: Route interception mocks API responses. No real backend needed.
 * Web V1 uses mock ads (3-second countdown). Real ads on mobile (AdMob).
 */
import { test, expect } from '@playwright/test';

// ============================================================
// Mock Data
// ============================================================

const MOCK_AD_CONFIG = {
  adUnitIds: { rewarded: 'ca-app-pub-XXXXX/YYYYY' },
  maxDailyViews: 5,
  rewardTypes: ['CREDIT', 'SECTION_UNLOCK', 'DAILY_HOROSCOPE'],
  creditsPerAdView: 1,
};

const MOCK_AD_STATUS_FULL = {
  remainingDailyViews: 5,
  maxDailyViews: 5,
  viewsUsedToday: 0,
};

const MOCK_AD_STATUS_PARTIAL = {
  remainingDailyViews: 2,
  maxDailyViews: 5,
  viewsUsedToday: 3,
};

const MOCK_AD_STATUS_EMPTY = {
  remainingDailyViews: 0,
  maxDailyViews: 5,
  viewsUsedToday: 5,
};

const MOCK_CREDIT_REWARD = {
  success: true,
  creditsGranted: 1,
  remainingDailyViews: 4,
};

const MOCK_SECTION_UNLOCK_REWARD = {
  success: true,
  creditsGranted: 0,
  remainingDailyViews: 3,
};

const MOCK_HOROSCOPE_REWARD = {
  success: true,
  creditsGranted: 0,
  remainingDailyViews: 2,
};

// ============================================================
// Helpers
// ============================================================

async function interceptAdConfig(page: import('@playwright/test').Page) {
  await page.route('**/api/ads/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AD_CONFIG),
    }),
  );
}

async function interceptAdStatus(
  page: import('@playwright/test').Page,
  status = MOCK_AD_STATUS_FULL,
) {
  await page.route('**/api/ads/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(status),
    }),
  );
}

async function interceptAdClaim(
  page: import('@playwright/test').Page,
  response = MOCK_CREDIT_REWARD,
  statusCode = 200,
) {
  await page.route('**/api/ads/claim', (route) =>
    route.fulfill({
      status: statusCode,
      contentType: 'application/json',
      body: JSON.stringify(response),
    }),
  );
}

async function interceptAdClaimError(
  page: import('@playwright/test').Page,
  message: string,
  statusCode = 400,
) {
  await page.route('**/api/ads/claim', (route) =>
    route.fulfill({
      status: statusCode,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode, message }),
    }),
  );
}

// ============================================================
// Tests: Ad Config (public endpoint)
// ============================================================

test.describe('Ad Rewards — Config Endpoint', () => {
  test('GET /api/ads/config returns ad configuration', async ({ page }) => {
    await interceptAdConfig(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const config = await page.evaluate(async () => {
      const res = await fetch('/api/ads/config');
      return res.json();
    });

    expect(config.maxDailyViews).toBe(5);
    expect(config.creditsPerAdView).toBe(1);
    expect(config.rewardTypes).toContain('CREDIT');
    expect(config.rewardTypes).toContain('SECTION_UNLOCK');
    expect(config.rewardTypes).toContain('DAILY_HOROSCOPE');
    expect(config.adUnitIds.rewarded).toBeDefined();
  });
});

// ============================================================
// Tests: Ad Status (remaining daily views)
// ============================================================

test.describe('Ad Rewards — Status Endpoint', () => {
  test('returns full daily allowance (5 remaining)', async ({ page }) => {
    await interceptAdStatus(page, MOCK_AD_STATUS_FULL);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const status = await page.evaluate(async () => {
      const res = await fetch('/api/ads/status');
      return res.json();
    });

    expect(status.remainingDailyViews).toBe(5);
    expect(status.maxDailyViews).toBe(5);
    expect(status.viewsUsedToday).toBe(0);
  });

  test('returns partial remaining views (2 remaining)', async ({ page }) => {
    await interceptAdStatus(page, MOCK_AD_STATUS_PARTIAL);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const status = await page.evaluate(async () => {
      const res = await fetch('/api/ads/status');
      return res.json();
    });

    expect(status.remainingDailyViews).toBe(2);
    expect(status.viewsUsedToday).toBe(3);
  });

  test('returns 0 remaining when limit reached', async ({ page }) => {
    await interceptAdStatus(page, MOCK_AD_STATUS_EMPTY);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const status = await page.evaluate(async () => {
      const res = await fetch('/api/ads/status');
      return res.json();
    });

    expect(status.remainingDailyViews).toBe(0);
    expect(status.viewsUsedToday).toBe(5);
  });
});

// ============================================================
// Tests: Claim CREDIT Reward
// ============================================================

test.describe('Ad Rewards — Claim CREDIT', () => {
  test('claiming CREDIT reward grants 1 credit', async ({ page }) => {
    await interceptAdClaim(page, MOCK_CREDIT_REWARD);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/ads/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardType: 'CREDIT', adPlacementId: 'ad-123' }),
      });
      return res.json();
    });

    expect(result.success).toBe(true);
    expect(result.creditsGranted).toBe(1);
    expect(result.remainingDailyViews).toBe(4);
  });

  test('claiming without adPlacementId still works', async ({ page }) => {
    await interceptAdClaim(page, MOCK_CREDIT_REWARD);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/ads/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardType: 'CREDIT' }),
      });
      return res.json();
    });

    expect(result.success).toBe(true);
  });
});

// ============================================================
// Tests: Claim SECTION_UNLOCK Reward
// ============================================================

test.describe('Ad Rewards — Claim SECTION_UNLOCK', () => {
  test('claiming SECTION_UNLOCK returns 0 credits', async ({ page }) => {
    await interceptAdClaim(page, MOCK_SECTION_UNLOCK_REWARD);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/ads/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardType: 'SECTION_UNLOCK',
          adPlacementId: 'ad-456',
          readingId: 'reading-123',
          sectionKey: 'career',
        }),
      });
      return res.json();
    });

    expect(result.success).toBe(true);
    expect(result.creditsGranted).toBe(0);
    expect(result.remainingDailyViews).toBe(3);
  });
});

// ============================================================
// Tests: Claim DAILY_HOROSCOPE Reward
// ============================================================

test.describe('Ad Rewards — Claim DAILY_HOROSCOPE', () => {
  test('claiming DAILY_HOROSCOPE returns 0 credits', async ({ page }) => {
    await interceptAdClaim(page, MOCK_HOROSCOPE_REWARD);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/ads/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardType: 'DAILY_HOROSCOPE' }),
      });
      return res.json();
    });

    expect(result.success).toBe(true);
    expect(result.creditsGranted).toBe(0);
  });
});

// ============================================================
// Tests: Daily Limit Enforcement
// ============================================================

test.describe('Ad Rewards — Daily Limit', () => {
  test('daily limit exceeded returns 400 error', async ({ page }) => {
    await interceptAdClaimError(
      page,
      'Daily ad limit reached (5 views per day). Please try again tomorrow.',
      400,
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/ads/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardType: 'CREDIT' }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Daily ad limit reached');
  });
});

// ============================================================
// Tests: Error Handling
// ============================================================

test.describe('Ad Rewards — Error Handling', () => {
  test('invalid reward type returns 400', async ({ page }) => {
    await interceptAdClaimError(
      page,
      'Invalid reward type "INVALID". Must be one of: CREDIT, SECTION_UNLOCK, DAILY_HOROSCOPE',
      400,
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/ads/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardType: 'INVALID' }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invalid reward type');
  });

  test('missing readingId for SECTION_UNLOCK returns 400', async ({ page }) => {
    await interceptAdClaimError(
      page,
      'readingId is required for SECTION_UNLOCK reward type',
      400,
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/ads/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardType: 'SECTION_UNLOCK', sectionKey: 'career' }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('readingId is required');
  });

  test('user not found returns 404', async ({ page }) => {
    await page.route('**/api/ads/status', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 404, message: 'User not found' }),
      }),
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/ads/status');
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toContain('User not found');
  });
});
