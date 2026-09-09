import { test, expect } from '@playwright/test'
import { waitAppReady } from './ready'
import { skipOnboarding } from './onboard'

const APP_URL = process.env.APP_URL
const APP_PASSWORD = process.env.APP_PASSWORD
const APP_LOGIN = process.env.ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = APP_PASSWORD as string

test.describe.configure({ mode: 'serial' })
test.skip(!APP_URL || !APP_PASSWORD, 'нужны APP_URL и APP_PASSWORD из окружения')

for (let i = 1; i <= 8; i++) {
  test(`stress ${i}: login -> nav-settings opens after hydration`, async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await page.goto(`${APP_URL}/login`)
    await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    await page.getByTestId('login-login').fill(APP_LOGIN)
    await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })

    await skipOnboarding(page)
    await page.reload()

    await expect(page.getByTestId('account-splash')).toBeHidden({ timeout: 45_000 })
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
  await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await page.getByTestId('login-login').fill(APP_LOGIN)
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
  await skipOnboarding(page)
  await page.reload()

  // Try to click BEFORE the ready attribute lands (fire-and-forget)
  page.getByTestId('nav-settings').click({ trial: false, force: true }).catch(() => {})

  await expect(page.getByTestId('account-splash')).toBeHidden({ timeout: 45_000 })
  await waitAppReady(page)
  // After hydration, a second explicit click must open settings — no permanent freeze
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('engine-cloud')).toBeVisible({ timeout: 15_000 })

  await ctx.close()
})


/* Отчёт итерации 41: «Библиотека → Настройки» иногда не открывалась на
   1280x800 при масштабе 150%. Гоняем переход шесть раз в этих условиях. */
test('library -> settings opens at 1280x800 and 150% scale', async ({ browser }) => {
  test.setTimeout(180_000)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  await page.goto(`${APP_URL}/login`)
  await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('login-login').fill(APP_LOGIN)
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
  await skipOnboarding(page)
  await page.addInitScript(() => localStorage.setItem('wf.ui.scale', '150'))
  await page.reload()
  await expect(page.getByTestId('account-splash')).toBeHidden({ timeout: 45_000 })
  await waitAppReady(page)

  for (let i = 1; i <= 6; i++) {
    await page.getByTestId('nav-library').click()
    await expect(page.getByTestId('lib-add-file')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('engine-cloud'), `переход ${i}`).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('journal-section')).toBeVisible()
  }

  await ctx.close()
})
