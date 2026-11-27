import { defineConfig, devices } from '@playwright/test';

// Itinerary journeys (Person 7) run on their own disposable real backend with the official catalog.
// From frontend/: npm --prefix ../backend run build && npm run build && npx playwright test -c playwright.itineraries.config.ts
const baseURL = 'http://localhost:3121';

export default defineConfig({
  testDir: './tests-itineraries',
  outputDir: './test-results/itineraries',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    // Optional: an already installed Chromium build instead of a Playwright download.
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/itineraries-backend.cjs',
      url: 'http://localhost:3120/api/docs-json',
      env: { PORT: '3120', FRONTEND_ORIGIN: baseURL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next start --hostname localhost --port 3121',
      url: baseURL,
      env: { BACKEND_URL: 'http://localhost:3120' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
