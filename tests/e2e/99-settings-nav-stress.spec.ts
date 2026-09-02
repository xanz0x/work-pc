import { test, expect } from '@playwright/test'
import { waitAppReady } from './ready'
import { skipOnboarding } from './onboard'

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const APP_PASSWORD = process.env.APP_PASSWORD ?? 'IceKrymTeam13@'

test.describe.configure({ mode: 'serial' })

for (let i = 1; i <= 8; i++) {
  test(`stress ${i}: login -> nav-settings opens after hydration`, async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await page.goto(`${APP_URL}/login`)
    await page.getByTestId('login-password').fill(APP_PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })

    await skipOnboarding(page)
    await page.reload()

    await waitAppReady(page)
    await page.getByTestId('nav-settings').click()

    await expect(page.getByTestId('engine-cloud')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('journal-section')).toBeVisible()

    await ctx.close()
  })
}

test('early-click before hydration still recovers after ready', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto(`${APP_URL}/login`)
  await page.getByTestId('login-password').fill(APP_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
  await skipOnboarding(page)
  await page.reload()

  // Try to click BEFORE the ready attribute lands (fire-and-forget)
  page.getByTestId('nav-settings').click({ trial: false, force: true }).catch(() => {})

  await waitAppReady(page)
  // After hydration, a second explicit click must open settings — no permanent freeze
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('engine-cloud')).toBeVisible({ timeout: 15_000 })

  await ctx.close()
})
