import { defineConfig, devices } from '@playwright/test';

// Blog journeys run on their own disposable backend with seeded users, posts and itineraries.
// From frontend/: npx playwright test -c playwright.blog.config.ts
const baseURL = 'http://localhost:3131';

export default defineConfig({
  testDir: './tests-blog',
  outputDir: './test-results/blog',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    // Optional: a preinstalled Chromium when Playwright's own download is unavailable.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/blog-backend.cjs',
      url: 'http://localhost:3130/api/docs-json',
      env: { PORT: '3130', FRONTEND_ORIGIN: baseURL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next start --hostname localhost --port 3131',
      url: baseURL,
      env: { BACKEND_URL: 'http://localhost:3130' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
