import { defineConfig, devices } from '@playwright/test';

// Blog journeys run on their own disposable backend with seeded users, posts and itineraries.
// From frontend/: npx playwright test -c playwright.blog.config.ts
// Ports can be moved with BLOG_E2E_BACKEND_PORT / BLOG_E2E_FRONTEND_PORT when 3130/3131 are taken.
const backendPort = process.env.BLOG_E2E_BACKEND_PORT || '3130';
const frontendPort = process.env.BLOG_E2E_FRONTEND_PORT || '3131';
const baseURL = `http://localhost:${frontendPort}`;

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
      url: `http://localhost:${backendPort}/api/docs-json`,
      env: { PORT: backendPort, FRONTEND_ORIGIN: baseURL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `node node_modules/next/dist/bin/next start --hostname localhost --port ${frontendPort}`,
      url: baseURL,
      env: { BACKEND_URL: `http://localhost:${backendPort}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
