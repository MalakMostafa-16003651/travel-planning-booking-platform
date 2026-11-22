import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:3101';

export default defineConfig({
  testDir: './tests',
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
      command: 'node scripts/auth-backend.cjs',
      url: 'http://localhost:3100/api/docs-json',
      env: { PORT: '3100' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next start --hostname localhost --port 3101',
      url: baseURL,
      env: { BACKEND_URL: 'http://localhost:3100' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
