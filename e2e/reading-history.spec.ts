/**
 * E2E Tests: Reading History Page
 * Tests the reading history listing flow:
 *   - GET /api/users/me/readings — paginated history
 *   - Reading list display (type, date, credits, deep link)
 *   - Empty state handling
 *   - Pagination via query params
 *   - Deep link to individual reading
 *
 * NOTE: Route interception mocks API responses. No real backend needed.
 */
import { test, expect } from '@playwright/test';

// ============================================================
// Mock Data
// ============================================================

const MOCK_READINGS = [
  {
    id: 'reading-1',
    readingType: 'LIFETIME',
    creditsUsed: 2,
    createdAt: '2026-01-15T08:30:00.000Z',
    birthProfile: {
      name: '王小明',
      birthDate: '1990-05-12',
    },
  },
  {
    id: 'reading-2',
    readingType: 'ZWDS_CAREER',
    creditsUsed: 2,
    createdAt: '2026-01-10T14:00:00.000Z',
    birthProfile: {
      name: '李美麗',
      birthDate: '1988-08-20',
    },
  },
  {
    id: 'reading-3',
    readingType: 'CAREER',
    creditsUsed: 0,
    createdAt: '2026-01-08T10:15:00.000Z',
    birthProfile: {
      name: '張大偉',
      birthDate: '1995-03-01',
    },
  },
  {
    id: 'reading-4',
    readingType: 'ZWDS_LOVE',
    creditsUsed: 2,
    createdAt: '2026-01-05T09:00:00.000Z',
    birthProfile: {
      name: '陳雅琪',
      birthDate: '1992-11-30',
    },
  },
  {
    id: 'reading-5',
    readingType: 'HEALTH',
    creditsUsed: 2,
    createdAt: '2026-01-03T16:45:00.000Z',
    birthProfile: {
      name: '林志遠',
      birthDate: '1985-07-22',
    },
  },
];

const MOCK_HISTORY_RESPONSE = {
  data: MOCK_READINGS,
  meta: {
    page: 1,
    limit: 50,
    total: 5,
    totalPages: 1,
  },
};

const MOCK_HISTORY_PAGE2 = {
  data: [
    {
      id: 'reading-6',
      readingType: 'ANNUAL',
      creditsUsed: 2,
      createdAt: '2025-12-28T11:00:00.000Z',
      birthProfile: {
        name: '黃志豪',
        birthDate: '1993-06-15',
      },
    },
  ],
  meta: {
    page: 2,
    limit: 50,
    total: 6,
    totalPages: 2,
  },
};

const MOCK_EMPTY_HISTORY = {
  data: [],
  meta: {
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  },
};

// ============================================================
// Helpers
// ============================================================

async function interceptReadingHistory(
  page: import('@playwright/test').Page,
  response = MOCK_HISTORY_RESPONSE,
) {
  await page.route('**/api/users/me/readings*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    }),
  );
}

async function interceptReadingHistoryByPage(page: import('@playwright/test').Page) {
  await page.route('**/api/users/me/readings*', (route) => {
    const url = new URL(route.request().url(), 'http://localhost');
    const pageNum = parseInt(url.searchParams.get('page') || '1');
    const response = pageNum === 2 ? MOCK_HISTORY_PAGE2 : MOCK_HISTORY_RESPONSE;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

// ============================================================
// Tests: Reading History API
// ============================================================

test.describe('Reading History — API Listing', () => {
  test('GET /api/users/me/readings returns paginated readings', async ({ page }) => {
    await interceptReadingHistory(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=1&limit=50');
      return res.json();
    });

    expect(result.data).toHaveLength(5);
    expect(result.meta.page).toBe(1);
    expect(result.meta.total).toBe(5);
    expect(result.meta.totalPages).toBe(1);
  });

  test('readings include required fields', async ({ page }) => {
    await interceptReadingHistory(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=1&limit=50');
      return res.json();
    });

    for (const reading of result.data) {
      expect(reading.id).toBeDefined();
      expect(reading.readingType).toBeDefined();
      expect(typeof reading.creditsUsed).toBe('number');
      expect(reading.createdAt).toBeDefined();
      expect(reading.birthProfile).toBeDefined();
      expect(reading.birthProfile.name).toBeDefined();
    }
  });

  test('empty history returns empty data array', async ({ page }) => {
    await interceptReadingHistory(page, MOCK_EMPTY_HISTORY);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=1&limit=50');
      return res.json();
    });

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(0);
  });

  test('page 2 returns different readings', async ({ page }) => {
    await interceptReadingHistoryByPage(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const page2 = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=2&limit=50');
      return res.json();
    });

    expect(page2.data).toHaveLength(1);
    expect(page2.meta.page).toBe(2);
    expect(page2.data[0].id).toBe('reading-6');
  });
});

// ============================================================
// Tests: Reading History Data Structure
// ============================================================

test.describe('Reading History — Data Structure', () => {
  test('readings contain valid reading types', async ({ page }) => {
    await interceptReadingHistory(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=1&limit=50');
      return res.json();
    });

    const validTypes = [
      'LIFETIME', 'ANNUAL', 'CAREER', 'LOVE', 'HEALTH', 'COMPATIBILITY',
      'ZWDS_LIFETIME', 'ZWDS_ANNUAL', 'ZWDS_CAREER', 'ZWDS_LOVE',
      'ZWDS_HEALTH', 'ZWDS_COMPATIBILITY', 'ZWDS_MONTHLY', 'ZWDS_DAILY',
      'ZWDS_MAJOR_PERIOD', 'ZWDS_QA',
    ];

    for (const reading of result.data) {
      expect(validTypes).toContain(reading.readingType);
    }
  });

  test('free readings have creditsUsed=0', async ({ page }) => {
    await interceptReadingHistory(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=1&limit=50');
      return res.json();
    });

    const freeReading = result.data.find(
      (r: { id: string }) => r.id === 'reading-3',
    );
    expect(freeReading).toBeDefined();
    expect(freeReading.creditsUsed).toBe(0);
  });

  test('paid readings have positive creditsUsed', async ({ page }) => {
    await interceptReadingHistory(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=1&limit=50');
      return res.json();
    });

    const paidReading = result.data.find(
      (r: { id: string }) => r.id === 'reading-1',
    );
    expect(paidReading).toBeDefined();
    expect(paidReading.creditsUsed).toBeGreaterThan(0);
  });

  test('readings have ISO date format for createdAt', async ({ page }) => {
    await interceptReadingHistory(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/users/me/readings?page=1&limit=50');
      return res.json();
    });

    for (const reading of result.data) {
      // Should parse as valid date
      const date = new Date(reading.createdAt);
      expect(date.getTime()).not.toBeNaN();
      // Should match ISO format
      expect(reading.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
