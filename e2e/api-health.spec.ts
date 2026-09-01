/**
 * E2E Tests: API Health & Public Endpoints
 * Tests that public API endpoints respond correctly.
 * These tests verify the Next.js API routes work without auth.
 */
import { test, expect } from '@playwright/test';

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

  // The unauthenticated iztro calc route is deleted, but the zwds-* slugs stay
  // in VALID_TYPES so the two already-paid ZWDS_LIFETIME readings remain
  // viewable via `?id=`. This guards that the viewing route still resolves.
  test('ZWDS reading page still returns 200 (paid readings remain viewable)', async ({ request }) => {
    const response = await request.get('/reading/zwds-lifetime');
    expect(response.status()).toBe(200);
  });

  test('sign-in page returns 200', async ({ request }) => {
    const response = await request.get('/sign-in');
    expect(response.status()).toBe(200);
  });
});
