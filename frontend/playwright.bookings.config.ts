import { defineConfig, devices } from '@playwright/test';

// Flight booking journeys need flights, seats and payments, so they run on their own disposable backend.
// From frontend/: npx playwright test -c playwright.bookings.config.ts
const baseURL = 'http://localhost:3111';

export default defineConfig({
  testDir: './tests-bookings',
  outputDir: './test-results/bookings',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/flight-bookings-backend.cjs',
      url: 'http://localhost:3110/api/docs-json',
      env: { PORT: '3110' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next start --hostname localhost --port 3111',
      url: baseURL,
      env: { BACKEND_URL: 'http://localhost:3110' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
