import { defineConfig, devices } from '@playwright/test';

// Checkout journeys (PAY-01..PAY-04) on their own disposable backend (scripts/payments-backend.cjs).
// From frontend/, after `npm --prefix ../backend run build && npm --prefix ../backend run build:test`:
//   npx playwright test -c playwright.checkout.config.ts
// The Next server is built here with a placeholder publishable key, because NEXT_PUBLIC_ values are
// fixed at build time. The browser never reaches Stripe: the spec serves a fake Stripe.js.
const baseURL = 'http://localhost:3121';

export default defineConfig({
  testDir: './tests-checkout',
  outputDir: './test-results/checkout',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    // Optional: a preinstalled Chromium when Playwright's own download is not available.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/payments-backend.cjs',
      url: 'http://localhost:3120/api/docs-json',
      env: { PORT: '3120', FRONTEND_ORIGIN: baseURL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --hostname localhost --port 3121',
      url: baseURL,
      env: { BACKEND_URL: 'http://localhost:3120', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_checkout_e2e_placeholder' },
      reuseExistingServer: false,
      timeout: 400_000,
    },
  ],
});
