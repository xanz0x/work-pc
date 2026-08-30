import { defineConfig, devices } from '@playwright/test'

/**
 * E2E пять сценариев (P0-4, шаг 4). Приложение должно быть запущено:
 * APP_URL указывает, куда стучаться (по умолчанию локальный dev).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
