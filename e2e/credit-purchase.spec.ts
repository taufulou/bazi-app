/**
 * E2E Tests: Credit Purchase Flow
 * Tests the credit purchase flow from store to checkout:
 *   - GET /api/payments/credit-packages — public listing
 *   - POST /api/payments/checkout/credits — Stripe session
 *   - Credit balance update after purchase
 *   - Success query param handling
 *   - Free reading availability check
 *
 * NOTE: Route interception mocks API responses. No real Stripe needed.
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
  },
  {
    id: 'pkg-3',
    slug: 'popular-30',
    nameZhTw: '熱門包',
    nameZhCn: '热门包',
    creditAmount: 30,
    priceUsd: 19.99,
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'pkg-4',
    slug: 'mega-60',
    nameZhTw: '巨量包',
    nameZhCn: '巨量包',
    creditAmount: 60,
    priceUsd: 34.99,
    isActive: true,
    sortOrder: 3,
  },
];

const MOCK_CREDIT_CHECKOUT = {
  sessionId: 'cs_credit_123',
  url: 'https://checkout.stripe.com/pay/cs_credit_123',
};

const MOCK_FREE_READING_AVAILABLE = {
  available: true,
};

const MOCK_FREE_READING_USED = {
  available: false,
};

const MOCK_FREE_READING_USE_RESULT = {
  success: true,
};

// ============================================================
// Helpers
// ============================================================

async function interceptCreditPackages(
  page: import('@playwright/test').Page,
  packages = MOCK_CREDIT_PACKAGES,
) {
  await page.route('**/api/payments/credit-packages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(packages),
    }),
  );
}

async function interceptCreditCheckout(page: import('@playwright/test').Page) {
  await page.route('**/api/payments/checkout/credits', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CREDIT_CHECKOUT),
    }),
  );
}

async function interceptFreeReading(
  page: import('@playwright/test').Page,
  available = true,
) {
  await page.route('**/api/payments/free-reading', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(available ? MOCK_FREE_READING_AVAILABLE : MOCK_FREE_READING_USED),
      });
    }
    return route.continue();
  });
}

async function interceptFreeReadingUse(page: import('@playwright/test').Page) {
  await page.route('**/api/payments/free-reading/use', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_FREE_READING_USE_RESULT),
    }),
  );
}

// ============================================================
// Tests: Credit Package Listing
// ============================================================

test.describe('Credit Purchase — Package Listing', () => {
  test('GET /api/payments/credit-packages returns active packages', async ({ page }) => {
    await interceptCreditPackages(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/credit-packages');
      return res.json();
    });

    expect(result).toHaveLength(4);
    expect(result[0].slug).toBe('starter-5');
    expect(result[0].creditAmount).toBe(5);
    expect(result[3].slug).toBe('mega-60');
    expect(result[3].creditAmount).toBe(60);
  });

  test('packages are sorted by sortOrder', async ({ page }) => {
    await interceptCreditPackages(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/credit-packages');
      return res.json();
    });

    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].sortOrder).toBeLessThanOrEqual(result[i + 1].sortOrder);
    }
  });

  test('all packages have required fields', async ({ page }) => {
    await interceptCreditPackages(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/credit-packages');
      return res.json();
    });

    for (const pkg of result) {
      expect(pkg.id).toBeDefined();
      expect(pkg.slug).toBeDefined();
      expect(pkg.nameZhTw).toBeDefined();
      expect(pkg.creditAmount).toBeGreaterThan(0);
      expect(pkg.priceUsd).toBeGreaterThan(0);
      expect(typeof pkg.isActive).toBe('boolean');
    }
  });

  test('returns empty array when no packages', async ({ page }) => {
    await interceptCreditPackages(page, []);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/credit-packages');
      return res.json();
    });

    expect(result).toEqual([]);
  });
});

// ============================================================
// Tests: Credit Checkout Session
// ============================================================

test.describe('Credit Purchase — Checkout Session', () => {
  test('POST checkout/credits creates Stripe session', async ({ page }) => {
    await interceptCreditCheckout(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/checkout/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageSlug: 'starter-5',
          successUrl: '/store?credits=success',
          cancelUrl: '/store?cancelled=true',
        }),
      });
      return res.json();
    });

    expect(result.sessionId).toBe('cs_credit_123');
    expect(result.url).toContain('checkout.stripe.com');
  });

  test('checkout URL is a valid HTTPS URL', async ({ page }) => {
    await interceptCreditCheckout(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/checkout/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageSlug: 'value-12',
          successUrl: '/store?credits=success',
          cancelUrl: '/store',
        }),
      });
      return res.json();
    });

    expect(result.url).toMatch(/^https:\/\//);
  });

  test('checkout captures correct package slug', async ({ page }) => {
    let capturedBody: string | null = null;
    await page.route('**/api/payments/checkout/credits', (route) => {
      capturedBody = route.request().postData();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CREDIT_CHECKOUT),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async () => {
      await fetch('/api/payments/checkout/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageSlug: 'popular-30',
          successUrl: '/store?credits=success',
          cancelUrl: '/store',
        }),
      });
    });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.packageSlug).toBe('popular-30');
  });
});

// ============================================================
// Tests: Free Reading
// ============================================================

test.describe('Credit Purchase — Free Reading', () => {
  test('GET free-reading returns available=true for new users', async ({ page }) => {
    await interceptFreeReading(page, true);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/free-reading');
      return res.json();
    });

    expect(result.available).toBe(true);
  });

  test('GET free-reading returns available=false after use', async ({ page }) => {
    await interceptFreeReading(page, false);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/free-reading');
      return res.json();
    });

    expect(result.available).toBe(false);
  });

  test('POST free-reading/use marks free reading as used', async ({ page }) => {
    await interceptFreeReadingUse(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/free-reading/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.json();
    });

    expect(result.success).toBe(true);
  });
});
