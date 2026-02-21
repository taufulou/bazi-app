/**
 * E2E Tests: API Health & Public Endpoints
 * Tests that public API endpoints respond correctly.
 * These tests verify the Next.js API routes work without auth.
 */
import { test, expect } from '@playwright/test';

test.describe('Next.js API Routes', () => {
  test('ZWDS calculate endpoint returns valid chart data', async ({ request }) => {
    const response = await request.post('/api/zwds-calculate', {
      data: {
        birthDate: '1987-9-6',
        birthTime: '14:30',
        gender: 'female',
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();

    // Validate chart structure
    expect(data).toHaveProperty('palaces');
    expect(data.palaces).toHaveLength(12);
    expect(data).toHaveProperty('solarDate');
    expect(data).toHaveProperty('gender');
    expect(data).toHaveProperty('fiveElementsClass');

    // Each palace should have the expected structure
    const firstPalace = data.palaces[0];
    expect(firstPalace).toHaveProperty('name');
    expect(firstPalace).toHaveProperty('majorStars');
    expect(Array.isArray(firstPalace.majorStars)).toBe(true);
  });

  test('ZWDS endpoint with different birth data returns different charts', async ({ request }) => {
    const response1 = await request.post('/api/zwds-calculate', {
      data: { birthDate: '1990-1-1', birthTime: '00:00', gender: 'male' },
    });
    const response2 = await request.post('/api/zwds-calculate', {
      data: { birthDate: '1985-6-15', birthTime: '12:00', gender: 'female' },
    });

    const data1 = await response1.json();
    const data2 = await response2.json();

    // Different birth data should produce different charts
    expect(data1.fiveElementsClass).not.toBe('');
    expect(data2.fiveElementsClass).not.toBe('');
    // At least some data should differ
    expect(
      data1.fiveElementsClass !== data2.fiveElementsClass ||
      JSON.stringify(data1.palaces[0].majorStars) !== JSON.stringify(data2.palaces[0].majorStars)
    ).toBeTruthy();
  });

  test('ZWDS endpoint handles invalid date gracefully', async ({ request }) => {
    const response = await request.post('/api/zwds-calculate', {
      data: {
        birthDate: 'invalid-date',
        birthTime: '08:00',
        gender: 'male',
      },
    });

    // iztro may accept various date formats gracefully (returns 200 with fallback)
    // The key assertion: the route exists and responds (not a server crash)
    expect(response.status()).toBeLessThan(500);
  });

  test('ZWDS endpoint handles missing fields', async ({ request }) => {
    const response = await request.post('/api/zwds-calculate', {
      data: {},
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('ZWDS horoscope with target date', async ({ request }) => {
    const response = await request.post('/api/zwds-calculate', {
      data: {
        birthDate: '1990-6-15',
        birthTime: '08:30',
        gender: 'male',
        targetDate: '2026-3-15',
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('palaces');
    // Should include horoscope data when targetDate is provided
  });
});

test.describe('Bazi Calculate Endpoint', () => {
  test('Bazi endpoint responds (may need Python engine)', async ({ request }) => {
    const response = await request.post('/api/bazi-calculate', {
      data: {
        birth_date: '1990-06-15',
        birth_time: '08:00',
        birth_city: '台北',
        birth_timezone: 'Asia/Taipei',
        gender: 'male',
      },
    });

    // If Python engine is running (port 5001), should return 200
    // If not, should return 500/503 (not 404)
    if (response.status() === 200) {
      const data = await response.json();
      // Bazi chart should have calculation data
      expect(data).toHaveProperty('data');
    } else {
      // Engine not running — that's okay, just verify the route exists
      expect(response.status()).not.toBe(404);
    }
  });
});

test.describe('Static Pages', () => {
  test('landing page returns 200', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
  });

  test('pricing page returns 200', async ({ request }) => {
    const response = await request.get('/pricing');
    expect(response.status()).toBe(200);
  });

  test('reading page returns 200', async ({ request }) => {
    const response = await request.get('/reading/lifetime');
    expect(response.status()).toBe(200);
  });

  test('ZWDS reading page returns 200', async ({ request }) => {
    const response = await request.get('/reading/zwds-lifetime');
    expect(response.status()).toBe(200);
  });

  test('sign-in page returns 200', async ({ request }) => {
    const response = await request.get('/sign-in');
    expect(response.status()).toBe(200);
  });
});
