import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running stack (by default `docker compose up`, which
 * includes Mailpit and a seeded admin). Point E2E_BASE_URL elsewhere to reuse them.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// The suite changes payment settings and creates accounts and courses: never aim it
// at a real site by accident.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(baseURL) && process.env.E2E_ALLOW_REMOTE !== 'true') {
  throw new Error(`Refusing to run e2e against ${baseURL}. Set E2E_ALLOW_REMOTE=true if you really mean it.`);
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    timezoneId: 'Africa/Cairo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
