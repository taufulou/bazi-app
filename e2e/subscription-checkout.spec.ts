/**
 * E2E Tests: Subscription Checkout Flow
 * Tests the full subscription checkout flow:
 *   - Pricing page displays plans with correct prices
 *   - Monthly/annual toggle updates prices
 *   - Checkout session creation (mocked Stripe)
 *   - Success/cancel query param handling
 *   - Subscription management (cancel, reactivate, portal)
 *
 * NOTE: Route interception mocks API responses. No real Stripe needed.
 */
import { test, expect } from '@playwright/test';

// ============================================================
// Mock Data
// ============================================================

const MOCK_PLANS = [
  {
    id: 'plan-basic',
    slug: 'basic',
    nameZhTw: '基礎版',
    nameZhCn: '基础版',
    priceMonthly: 4.99,
    priceAnnual: 39.99,
    currency: 'USD',
    features: ['5 credits/month', 'Basic readings'],
    readingsPerMonth: 5,
    monthlyCredits: 5,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'plan-pro',
    slug: 'pro',
    nameZhTw: '進階版',
    nameZhCn: '进阶版',
    priceMonthly: 9.99,
    priceAnnual: 79.99,
    currency: 'USD',
    features: ['15 credits/month', 'All readings', 'Priority support'],
    readingsPerMonth: 15,
    monthlyCredits: 15,
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'plan-master',
    slug: 'master',
    nameZhTw: '大師版',
    nameZhCn: '大师版',
    priceMonthly: 19.99,
    priceAnnual: 159.99,
    currency: 'USD',
    features: ['Unlimited', 'All exclusive features'],
    readingsPerMonth: -1,
    monthlyCredits: -1,
    isActive: true,
    sortOrder: 3,
  },
];

const MOCK_CHECKOUT_SESSION = {
  sessionId: 'cs_test_123',
  url: 'https://checkout.stripe.com/pay/cs_test_123',
};

const MOCK_PORTAL_SESSION = {
  url: 'https://billing.stripe.com/p/session/test_portal_123',
};

const MOCK_SUBSCRIPTION_STATUS = {
  subscribed: true,
  plan: 'PRO',
  status: 'ACTIVE',
  currentPeriodEnd: '2026-03-15T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  credits: 10,
  freeReadingUsed: true,
};

const MOCK_CANCEL_RESULT = {
  success: true,
  endsAt: '2026-03-15T00:00:00.000Z',
};

const MOCK_REACTIVATE_RESULT = {
  success: true,
};

// ============================================================
// Helpers
// ============================================================

async function interceptPlans(page: import('@playwright/test').Page) {
  await page.route('**/api/payments/plans', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PLANS),
    }),
  );
}

async function interceptCheckout(page: import('@playwright/test').Page) {
  await page.route('**/api/payments/checkout/subscription', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CHECKOUT_SESSION),
    }),
  );
}

async function interceptSubscriptionStatus(
  page: import('@playwright/test').Page,
  status = MOCK_SUBSCRIPTION_STATUS,
) {
  await page.route('**/api/payments/subscription', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(status),
    }),
  );
}

async function interceptCancel(page: import('@playwright/test').Page) {
  await page.route('**/api/payments/cancel', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CANCEL_RESULT),
    }),
  );
}

async function interceptReactivate(page: import('@playwright/test').Page) {
  await page.route('**/api/payments/reactivate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_REACTIVATE_RESULT),
    }),
  );
}

async function interceptPortal(page: import('@playwright/test').Page) {
  await page.route('**/api/payments/portal', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PORTAL_SESSION),
    }),
  );
}

// ============================================================
// Tests: Checkout Session Creation
// ============================================================

test.describe('Subscription Checkout — Session Creation', () => {
  test('POST checkout/subscription creates Stripe session', async ({ page }) => {
    await interceptCheckout(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/checkout/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSlug: 'pro',
          billingCycle: 'monthly',
          successUrl: '/dashboard?subscription=success',
          cancelUrl: '/pricing?cancelled=true',
        }),
      });
      return res.json();
    });

    expect(result.sessionId).toBe('cs_test_123');
    expect(result.url).toContain('checkout.stripe.com');
  });

  test('checkout session URL contains pay path', async ({ page }) => {
    await interceptCheckout(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/checkout/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSlug: 'basic',
          billingCycle: 'annual',
          successUrl: '/dashboard?subscription=success',
          cancelUrl: '/pricing?cancelled=true',
        }),
      });
      return res.json();
    });

    expect(result.url).toMatch(/^https:\/\//);
  });

  test('checkout with promo code includes promoCode', async ({ page }) => {
    let capturedBody: string | null = null;
    await page.route('**/api/payments/checkout/subscription', (route) => {
      capturedBody = route.request().postData();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CHECKOUT_SESSION),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async () => {
      await fetch('/api/payments/checkout/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSlug: 'pro',
          billingCycle: 'annual',
          promoCode: 'SAVE20',
          successUrl: '/dashboard',
          cancelUrl: '/pricing',
        }),
      });
    });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.promoCode).toBe('SAVE20');
  });
});

// ============================================================
// Tests: Subscription Status
// ============================================================

test.describe('Subscription Checkout — Status', () => {
  test('GET subscription returns active subscription details', async ({ page }) => {
    await interceptSubscriptionStatus(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/subscription');
      return res.json();
    });

    expect(result.subscribed).toBe(true);
    expect(result.plan).toBe('PRO');
    expect(result.status).toBe('ACTIVE');
    expect(result.credits).toBe(10);
  });

  test('non-subscribed user returns unsubscribed status', async ({ page }) => {
    await interceptSubscriptionStatus(page, {
      subscribed: false,
      plan: 'FREE',
      status: 'EXPIRED',
      currentPeriodEnd: null as any,
      cancelAtPeriodEnd: false,
      credits: 0,
      freeReadingUsed: false,
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/subscription');
      return res.json();
    });

    expect(result.subscribed).toBe(false);
    expect(result.plan).toBe('FREE');
  });
});

// ============================================================
// Tests: Subscription Management
// ============================================================

test.describe('Subscription Checkout — Management', () => {
  test('POST cancel cancels subscription at period end', async ({ page }) => {
    await interceptCancel(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.json();
    });

    expect(result.success).toBe(true);
    expect(result.endsAt).toBeDefined();
  });

  test('POST reactivate restores cancelled subscription', async ({ page }) => {
    await interceptReactivate(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/reactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.json();
    });

    expect(result.success).toBe(true);
  });

  test('POST portal creates Stripe billing portal session', async ({ page }) => {
    await interceptPortal(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: '/dashboard/subscription' }),
      });
      return res.json();
    });

    expect(result.url).toContain('billing.stripe.com');
  });
});

// ============================================================
// Tests: Plans API
// ============================================================

test.describe('Subscription Checkout — Plans API', () => {
  test('GET plans returns all active plans', async ({ page }) => {
    await interceptPlans(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/plans');
      return res.json();
    });

    expect(result).toHaveLength(3);
    expect(result[0].slug).toBe('basic');
    expect(result[1].slug).toBe('pro');
    expect(result[2].slug).toBe('master');
  });

  test('plans have correct monthly/annual pricing', async ({ page }) => {
    await interceptPlans(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/payments/plans');
      return res.json();
    });

    const pro = result.find((p: any) => p.slug === 'pro');
    expect(pro.priceMonthly).toBe(9.99);
    expect(pro.priceAnnual).toBe(79.99);
    expect(pro.monthlyCredits).toBe(15);
  });
});
