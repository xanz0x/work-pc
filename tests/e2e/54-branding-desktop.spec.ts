import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

const APP_URL = process.env.APP_URL
const APP_PASSWORD = process.env.APP_PASSWORD
const ADMIN_LOGIN = process.env.ADMIN_LOGIN

test.skip(!APP_URL || !APP_PASSWORD || !ADMIN_LOGIN, 'APP_URL, APP_PASSWORD и ADMIN_LOGIN обязательны')

async function login(page: import('@playwright/test').Page) {
  await skipOnboarding(page)
  await page.goto(`${APP_URL}/login`)
  await expect(page.getByTestId('login-brand-image')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('login-brand-image')).toHaveAttribute('src', /workspacex-logo\.png/)
  await page.getByTestId('login-tab-register').click({ force: true })
  await expect(page.getByTestId('login-brand-image')).toHaveAttribute('src', /workspacex-logo\.png/)
  await page.getByTestId('login-tab-login').click({ force: true })
  await page.getByTestId('login-login').fill(ADMIN_LOGIN as string)
  await page.getByTestId('login-password').fill(APP_PASSWORD as string)
  await page.getByTestId('login-submit').click({ force: true })
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await waitAppReady(page)
}

test('desktop branding smoke: logos/icons replaced and assets available', async ({ browser }) => {
  test.setTimeout(180_000)

  for (const vp of [{ width: 1920, height: 800 }, { width: 1280, height: 800 }] as const) {
    for (const scale of [100, 150] as const) {
      const context = await browser.newContext({ viewport: vp })
      const page = await context.newPage()
      await page.addInitScript((pct) => localStorage.setItem('wf.ui.scale', String(pct)), scale)
      await login(page)
      await expect(page.locator('html')).toHaveAttribute('data-ui-scale', String(scale))

      await expect(page.getByTestId('sidebar-logo-wordmark')).toHaveAttribute('src', /workspacex-wordmark\.png/)
      const markHref = await page.getByTestId('sidebar-logo-mark').locator('image').getAttribute('href')
      expect(markHref).toBe('/brand/workspacex-mark.png')
      const word = await page.getByTestId('sidebar-logo-wordmark').boundingBox()
      const toggle = await page.getByTestId('sidebar-toggle').boundingBox()
      expect(word && toggle && word.x + word.width <= toggle.x).toBeTruthy()
      await expect(page.getByTestId('sidebar-logo-wordmark')).toBeVisible()
      expect(await page.getByTestId('sidebar-logo-wordmark').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBeTruthy()

      await page.getByTestId('sidebar-toggle').click({ force: true })
      await expect(page.getByTestId('sidebar-logo-mark')).toBeVisible()
      await page.getByTestId('sidebar-toggle').click({ force: true })

      for (const navId of ['nav-library', 'nav-chat', 'nav-mail', 'nav-map', 'nav-settings']) {
        await page.getByTestId(navId).click({ force: true })
        await page.waitForTimeout(200)
      }

      await context.close()
    }
  }

  const context = await browser.newContext({ viewport: { width: 1920, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${APP_URL}/login`)

  for (const p of [
    '/favicon.ico',
    '/icon.png',
    '/brand/workspacex-icon-32.png',
    '/brand/workspacex-icon-192.png',
    '/brand/workspacex-icon-256.png',
    '/brand/workspacex-icon-512.png',
    '/apple-icon.png',
    '/icon-dark-32x32.png',
    '/icon-light-32x32.png',
  ]) {
    const r = await page.request.get(`${APP_URL}${p}`)
    expect(r.status(), `${p} should be public`).toBe(200)
  }

  const oldSvg = await page.request.get(`${APP_URL}/icon.svg`)
  expect(oldSvg.status()).toBe(404)

  await context.close()
})

test('runtime lock branding, reload, unlock and cloud-list regression', async ({ browser }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ viewport: { width: 1920, height: 800 } })
  const page = await context.newPage()
  const master = 'Brand54-LocalOnly!'
  try {
    await login(page)
    const cloud = await page.request.get(`${APP_URL}/ai-api/cloud`)
    expect(cloud.status(), 'Cloud list should no longer fail during shell load').toBe(200)
    expect(Array.isArray((await cloud.json()).files)).toBeTruthy()

    await page.getByTestId('nav-settings').click()
    await page.getByTestId('settings-nav-security').click()
    await page.getByTestId('mk-setup-open').click()
    await page.getByTestId('mk-tab-password').click()
    await page.getByTestId('mk-pass1').fill(master)
    await page.getByTestId('mk-pass2').fill(master)
    await page.getByTestId('mk-submit').click()
    await expect(page.getByTestId('mk-modal')).toBeHidden()
    await page.getByTestId('topbar-lock-btn').click()
    await expect(page.getByTestId('lock-brand-image')).toBeVisible()
    await expect(page.getByTestId('lock-brand-image')).toHaveAttribute('src', '/brand/workspacex-logo.png')
    await page.getByTestId('lock-brand-image').evaluate((el: HTMLImageElement) => el.decode())

    await page.reload()
    await expect(page.getByTestId('lock-brand-image')).toBeVisible()
    // Verify the pre-hydration CSS without changing real lock state or user data.
    const pendingImage = await page.evaluate(() => {
      document.documentElement.classList.add('lock-pending')
      const value = getComputedStyle(document.body, '::after').backgroundImage
      document.documentElement.classList.remove('lock-pending')
      return value
    })
    expect(pendingImage).toContain('/brand/workspacex-logo.png')
    await page.getByTestId('lock-password').fill(master)
    await page.getByTestId('lock-password-submit').click()
    await expect(page.getByTestId('lock-screen')).toBeHidden()
    await expect(page.getByTestId('sidebar-logo-wordmark')).toBeVisible()
  } finally {
    await page.request.post(`${APP_URL}/ai-api/auth/logout`)
    await context.close()
  }
})
