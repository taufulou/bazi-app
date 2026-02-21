import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for Bazi SaaS Platform.
 *
 * Tests are designed to run against a live Next.js dev server (port 3000).
 * The NestJS API (port 4000) is NOT required for these tests — we test
 * what's testable at the current phase:
 *   - Public pages (pricing, reading input)
 *   - UI interactions (billing toggle, plan cards, modals)
 *   - Component behavior (credit badge, insufficient credits flow)
 *   - Navigation flows (sign-in redirects, dashboard links)
 *
 * For tests requiring auth, we mock Clerk via route interception.
 *
 * NOTE: Next.js 16 + Turbopack does on-demand compilation, so first visit
 * to each page triggers compilation. We use higher timeouts and
 * navigationTimeout to accommodate this.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  timeout: 60000,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 45000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],

  /* Start the Next.js dev server automatically */
  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    cwd: '.',
  },
});
