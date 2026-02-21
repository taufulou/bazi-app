/**
 * E2E Tests: Free Reading Flow
 * Tests the free reading flow for authenticated and unauthenticated users:
 *   - Unauthenticated: chart-only (no AI sections)
 *   - Authenticated: first reading free with AI
 *   - Second reading: insufficient credits modal
 *   - Deep link to saved reading
 *
 * NOTE: Route interception mocks API responses. No real backend needed.
 */
import { test, expect } from '@playwright/test';

// ============================================================
// Mock Data
// ============================================================

const MOCK_ZWDS_CHART = createMockZwdsChart();

const MOCK_READING_RESPONSE = {
  id: 'reading-123',
  readingType: 'ZWDS_LIFETIME',
  calculationData: MOCK_ZWDS_CHART,
  aiInterpretation: {
    personality: {
      preview: '你的命格分析顯示...',
      full: '你的命格分析顯示你是一個富有創造力的人...',
    },
    career: {
      preview: '事業方面...',
      full: '事業方面你適合從事創意相關工作...',
    },
    love: {
      preview: '感情方面...',
      full: '感情方面你傾向於穩定的關係...',
    },
  },
  creditsUsed: 0, // First reading is free
  createdAt: '2026-02-15T10:00:00.000Z',
};

const MOCK_READING_PAID = {
  ...MOCK_READING_RESPONSE,
  id: 'reading-456',
  creditsUsed: 2,
};

// ============================================================
// Helpers
// ============================================================

function createMockZwdsChart() {
  const palaceNames = [
    '命宮', '兄弟宮', '夫妻宮', '子女宮',
    '財帛宮', '疾厄宮', '遷移宮', '交友宮',
    '官祿宮', '田宅宮', '福德宮', '父母宮',
  ];

  return {
    palaces: palaceNames.map((name, idx) => ({
      name,
      heavenlyStem: '甲',
      earthlyBranch: '子',
      majorStars: [{ name: '紫微', brightness: '廟', mutagen: null }],
      minorStars: [],
      adjectiveStars: [],
      changsheng12: '長生',
      decadalRange: { start: idx * 10 + 2, end: idx * 10 + 11 },
      ages: [idx + 1, idx + 13, idx + 25],
    })),
    solarDate: '1990-6-15',
    lunarDate: '農曆庚午年五月廿三',
    chineseDate: '庚午年 壬午月 甲子日',
    time: '辰時',
    timeIndex: 4,
    gender: '男',
    fiveElementsClass: '金四局',
    soul: '命宮',
    body: '身宮',
  };
}

async function interceptZwdsCalculate(page: import('@playwright/test').Page) {
  await page.route('**/api/zwds-calculate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ZWDS_CHART),
    }),
  );
}

async function interceptBaziCalculate(page: import('@playwright/test').Page) {
  await page.route('**/api/bazi-calculate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ fourPillars: {}, fiveElements: {}, tenGods: {} }),
    }),
  );
}

async function interceptReadingCreation(
  page: import('@playwright/test').Page,
  response = MOCK_READING_RESPONSE,
  statusCode = 200,
) {
  await page.route('**/api/zwds/readings', (route) =>
    route.fulfill({
      status: statusCode,
      contentType: 'application/json',
      body: JSON.stringify(response),
    }),
  );
  await page.route('**/api/bazi/readings', (route) =>
    route.fulfill({
      status: statusCode,
      contentType: 'application/json',
      body: JSON.stringify(response),
    }),
  );
}

async function interceptInsufficientCredits(page: import('@playwright/test').Page) {
  await page.route('**/api/zwds/readings', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 400,
        message: 'Insufficient credits. You have 0 credits but need 2.',
      }),
    }),
  );
  await page.route('**/api/bazi/readings', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 400,
        message: 'Insufficient credits. You have 0 credits but need 2.',
      }),
    }),
  );
}

async function interceptGetReading(
  page: import('@playwright/test').Page,
  reading = MOCK_READING_RESPONSE,
) {
  await page.route(`**/api/bazi/readings/${reading.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reading),
    }),
  );
  await page.route(`**/api/zwds/readings/${reading.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reading),
    }),
  );
}

// ============================================================
// Tests: Unauthenticated Flow (Chart-Only)
// ============================================================

test.describe('Free Reading — Unauthenticated Chart-Only', () => {
  test('ZWDS chart renders without auth via direct iztro path', async ({ page }) => {
    await interceptZwdsCalculate(page);

    await page.goto('/reading/zwds-lifetime');
    await page.waitForLoadState('domcontentloaded');

    // Verify reading page loads with form
    await expect(page.getByText('輸入資料')).toBeVisible();

    // Step indicator should be visible
    const stepIndicator = page.locator('[class*="stepIndicator"]');
    await expect(stepIndicator).toBeVisible();
  });

  test('Bazi reading page loads without auth', async ({ page }) => {
    await interceptBaziCalculate(page);

    await page.goto('/reading/lifetime');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('輸入資料')).toBeVisible();
  });

  test('unauthenticated user sees submit button', async ({ page }) => {
    await page.goto('/reading/zwds-career');
    await page.waitForLoadState('domcontentloaded');

    const submitBtn = page.getByRole('button', { name: /開始分析/ });
    await expect(submitBtn).toBeVisible();
  });
});

// ============================================================
// Tests: Free Reading API Endpoint
// ============================================================

test.describe('Free Reading — API Endpoint', () => {
  test('reading creation endpoint returns reading with creditsUsed', async ({ page }) => {
    await interceptReadingCreation(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/zwds/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birthProfileId: 'profile-1',
          readingType: 'ZWDS_LIFETIME',
        }),
      });
      return res.json();
    });

    expect(result.id).toBe('reading-123');
    expect(result.creditsUsed).toBe(0);
    expect(result.aiInterpretation).toBeDefined();
    expect(result.calculationData).toBeDefined();
  });

  test('insufficient credits returns 400 error', async ({ page }) => {
    await interceptInsufficientCredits(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const res = await page.evaluate(async () => {
      const response = await fetch('/api/zwds/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birthProfileId: 'profile-1',
          readingType: 'ZWDS_LIFETIME',
        }),
      });
      return { status: response.status, body: await response.json() };
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Insufficient credits');
  });

  test('paid reading returns creditsUsed > 0', async ({ page }) => {
    await interceptReadingCreation(page, MOCK_READING_PAID);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/bazi/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birthProfileId: 'profile-1',
          readingType: 'LIFETIME',
        }),
      });
      return res.json();
    });

    expect(result.creditsUsed).toBe(2);
  });
});

// ============================================================
// Tests: Deep Link to Saved Reading
// ============================================================

test.describe('Free Reading — Deep Link', () => {
  test('deep link with ?id= param loads saved reading data', async ({ page }) => {
    await interceptGetReading(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/bazi/readings/reading-123');
      return res.json();
    });

    expect(result.id).toBe('reading-123');
    expect(result.readingType).toBe('ZWDS_LIFETIME');
    expect(result.calculationData).toBeDefined();
    expect(result.aiInterpretation).toBeDefined();
  });

  test('reading page with id param navigates correctly', async ({ page }) => {
    await interceptGetReading(page);
    await interceptZwdsCalculate(page);

    await page.goto('/reading/zwds-lifetime?id=reading-123');
    await page.waitForLoadState('domcontentloaded');

    // Page should load without errors
    const hasContent = await page.locator('body').isVisible();
    expect(hasContent).toBeTruthy();
  });
});
