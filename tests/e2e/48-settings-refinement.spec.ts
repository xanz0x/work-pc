import { mkdirSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

const APP_URL = process.env.APP_URL
const APP_PASSWORD = process.env.APP_PASSWORD
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'admin'

const SHOTS_DIR = '/app/test_reports/screenshots_iter49'
mkdirSync(SHOTS_DIR, { recursive: true })

const VIEWPORTS = [
  { width: 1920, height: 800 },
  { width: 1280, height: 800 },
  { width: 768, height: 800 },
  { width: 390, height: 800 },
  { width: 320, height: 800 },
  { width: 1280, height: 420 },
] as const

const SCALES = [80, 100, 125, 150] as const

const SECTION_IDS = [
  'engine',
  'ui',
  'pipeline',
  'notify',
  'storage',
  'privacy',
  'security',
  'secrets',
  'backup',
  'flags',
  'mcp',
  'sync',
  'cloud',
  'journal',
  'danger',
] as const

const SECTION_TITLE_TEST_ID: Record<(typeof SECTION_IDS)[number], string> = {
  engine: 'settings-engine-title',
  ui: 'settings-ui-title',
  pipeline: 'settings-pipeline-title',
  notify: 'settings-notify-title',
  storage: 'settings-storage-title',
  privacy: 'settings-privacy-title',
  security: 'settings-security-title',
  secrets: 'settings-secrets-title',
  backup: 'settings-backup-title',
  flags: 'settings-flags-title',
  mcp: 'settings-mcp-title',
  sync: 'settings-sync-title',
  cloud: 'settings-cloud-title',
  journal: 'settings-journal-title',
  danger: 'settings-danger-title',
}

test.skip(!APP_URL || !APP_PASSWORD, 'APP_URL и APP_PASSWORD обязательны')

async function loginAndOpenSettings(page: Page): Promise<void> {
  await skipOnboarding(page)
  await page.goto(`${APP_URL}/login`)
  await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 25_000 })
  await page.getByTestId('login-login').fill(ADMIN_LOGIN)
  await page.getByTestId('login-password').fill(APP_PASSWORD as string)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await waitAppReady(page)
  await page.getByTestId('nav-settings').click({ force: true })
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('settings-section-select')).toBeAttached()
}

async function setScale(page: Page, scale: (typeof SCALES)[number], useSelect: boolean): Promise<void> {
  if (await page.getByTestId('settings-section-select').isVisible()) {
    await page.getByTestId('settings-section-select').selectOption('ui', { force: true })
  } else {
    await page.getByTestId('settings-nav-ui').click({ force: true })
  }
  await expect(page.getByTestId('settings-ui-title')).toBeVisible()
  await page.getByTestId(`ui-scale-preset-${scale}`).click({ force: true })
  await expect(page.getByTestId('ui-scale-value')).toContainText(`${scale}%`)
  await page.waitForTimeout(250)
}

async function assertSectionPosition(
  page: Page,
  id: (typeof SECTION_IDS)[number],
  useSelect: boolean,
): Promise<void> {
  const select = page.getByTestId('settings-section-select')
  if (await select.isVisible()) {
    await select.selectOption(id, { force: true })
  } else {
    await page.getByTestId(`settings-nav-${id}`).click({ force: true })
  }
  await page.waitForTimeout(id === 'security' ? 1000 : 120)

  await expect.soft(select, `selected value must be ${id}`).toHaveValue(id)

  const nav = page.getByTestId(`settings-nav-${id}`)
  if ((await nav.count()) > 0) {
    await expect.soft(nav, `nav aria-current should point to ${id}`).toHaveAttribute('aria-current', 'true')
  }

  const title = page.getByTestId(SECTION_TITLE_TEST_ID[id])
  await expect(title).toBeAttached()

  const rootBox = await page.getByTestId('settings-scroll').boundingBox()
  const titleBox = await title.boundingBox()

  expect.soft(rootBox, `settings-scroll box for ${id}`).not.toBeNull()
  expect.soft(titleBox, `title box for ${id}`).not.toBeNull()
  if (!rootBox || !titleBox) return

  const intersectsViewport =
    titleBox.y + titleBox.height > rootBox.y && titleBox.y < rootBox.y + rootBox.height

  if (id === 'danger') {
    expect.soft(intersectsViewport, `danger section should intersect scroll viewport`).toBeTruthy()
  } else {
    expect.soft(titleBox.y, `${id} heading top must be inside scroll viewport`).toBeGreaterThanOrEqual(rootBox.y - 2)
    expect.soft(titleBox.y, `${id} heading top must stay within viewport height`).toBeLessThan(
      rootBox.y + rootBox.height - 8,
    )
    expect.soft(intersectsViewport, `${id} heading must intersect scroll viewport`).toBeTruthy()
  }

  const overflow = await page.evaluate((sectionId) => {
    const section = document.getElementById(`set-${sectionId}`)
    if (!section) return ['section-missing']
    const secRect = section.getBoundingClientRect()
    const eps = 1
    const violations: string[] = []
    const nodes = Array.from(
      section.querySelectorAll<HTMLElement>(
        '.setting-row, .field-block, .rows-list, button, input, select, textarea, [role="button"], [role="radio"]',
      ),
    )
    for (const el of nodes) {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      if (r.left < secRect.left - eps) violations.push(`left:${el.tagName}:${Math.round(r.left - secRect.left)}`)
      if (r.right > secRect.right + eps) violations.push(`right:${el.tagName}:${Math.round(r.right - secRect.right)}`)
    }
    return violations.slice(0, 15)
  }, id)
  expect.soft(overflow, `section ${id} overflow against own bounds`).toEqual([])

  const textIssues = await page.evaluate((sectionId) => {
    const section = document.getElementById(`set-${sectionId}`)
    if (!section) return { empty: ['section-missing'], longClipped: [] as string[] }
    const empty: string[] = []
    const longClipped: string[] = []
    const texts = Array.from(section.querySelectorAll<HTMLElement>('.setting-title, .setting-note'))
    for (const t of texts) {
      const val = (t.textContent ?? '').trim()
      if (!val) empty.push(t.className)
      if (val.length > 80) {
        const r = t.getBoundingClientRect()
        if (t.scrollWidth - t.clientWidth > 1 || r.right > section.getBoundingClientRect().right + 1) {
          longClipped.push(`${t.className}:${val.slice(0, 20)}`)
        }
      }
    }
    return { empty: empty.slice(0, 5), longClipped: longClipped.slice(0, 5) }
  }, id)

  expect.soft(textIssues.empty, `${id} should not contain empty titles/notes`).toEqual([])
  expect.soft(textIssues.longClipped, `${id} long text must not be clipped`).toEqual([])
}

async function openFreshContextAndPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  return { context, page }
}

for (const viewport of VIEWPORTS) {
  test(`settings navigation coordinates @ ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const useSelect = viewport.width <= 768

    test.setTimeout(180_000)

    const { context, page } = await openFreshContextAndPage(browser, viewport)
    await loginAndOpenSettings(page)

    const optionValues = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLSelectElement>('[data-testid="settings-section-select"] option')).map(
        (o) => o.value,
      ),
    )
    expect.soft(optionValues.length, `available settings sections at ${viewport.width}x${viewport.height}`).toBe(15)
    for (const expected of SECTION_IDS) {
      expect.soft(optionValues.includes(expected), `section option exists: ${expected}`).toBeTruthy()
    }

    for (const scale of SCALES) {
      await setScale(page, scale, useSelect)
      for (const id of SECTION_IDS) {
        await assertSectionPosition(page, id, useSelect)

        if (viewport.width === 1920 && viewport.height === 800 && scale === 150 && id === 'security') {
          await page.getByTestId('settings-section-select').selectOption('security', { force: true })
          await page.waitForTimeout(1000)
          await expect.soft(page.getByTestId('settings-section-select')).toHaveValue('security')
          const root = await page.getByTestId('settings-scroll').boundingBox()
          const heading = await page.getByTestId('settings-security-title').boundingBox()
          expect.soft(root).not.toBeNull()
          expect.soft(heading).not.toBeNull()
          if (root && heading) {
            expect.soft(heading.y, 'security heading stays in viewport after selectOption@1920x800 z150').toBeGreaterThanOrEqual(
              root.y - 2,
            )
          }
        }

        if (scale === 150 && viewport.width === 390 && ['notify', 'secrets', 'security'].includes(id)) {
          await page.screenshot({
            path: `${SHOTS_DIR}/mobile-390-${id}-z150.jpeg`,
            type: 'jpeg',
            quality: 40,
            fullPage: false,
          })
        }

        if (scale === 150 && viewport.width === 320 && ['ui', 'security'].includes(id)) {
          await page.screenshot({
            path: `${SHOTS_DIR}/mobile-320-${id}-z150.jpeg`,
            type: 'jpeg',
            quality: 40,
            fullPage: false,
          })
        }
      }
    }

    await context.close()
  })
}

test('security modal open/cancel/focus/warnings at small screens and scale 150', async ({ browser }) => {
  test.setTimeout(240_000)

  for (const viewport of [
    { width: 390, height: 800 },
    { width: 320, height: 800 },
  ]) {
    const { context, page } = await openFreshContextAndPage(browser, viewport)
    await loginAndOpenSettings(page)
    await setScale(page, 150, true)

    const select = page.getByTestId('settings-section-select')
    await select.selectOption('security', { force: true })
    await page.waitForTimeout(1000)
    await expect(select).toHaveValue('security')

    const opener = (await page.getByTestId('mk-setup-open').count()) > 0
      ? page.getByTestId('mk-setup-open')
      : page.getByTestId('mk-change-open')

    await opener.focus()
    await opener.click({ force: true })

    const modal = (await page.getByTestId('mk-modal').count()) > 0
      ? page.getByTestId('mk-modal')
      : page.getByTestId('mk-change-modal')

    await expect(modal).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(250)

    const warning = (await page.getByTestId('mk-warn').count()) > 0
      ? page.getByTestId('mk-warn')
      : page.getByTestId('mk-change-note')
    await expect.soft(warning).toBeVisible()

    const modalBox = await modal.boundingBox()
    expect.soft(modalBox).not.toBeNull()
    if (modalBox) {
      expect.soft(modalBox.x, 'modal must not be cropped left').toBeGreaterThanOrEqual(0)
      expect.soft(modalBox.y, 'modal must not be cropped top').toBeGreaterThanOrEqual(0)
      expect.soft(modalBox.x + modalBox.width, 'modal must fit right edge').toBeLessThanOrEqual(
        viewport.width + 1,
      )
      expect.soft(modalBox.y + modalBox.height, 'modal must fit bottom edge').toBeLessThanOrEqual(
        viewport.height + 1,
      )
    }

    const firstPinCell = page.getByTestId('mk-pin1-0')
    const firstPassField = page.getByTestId('mk-pass1')
    if ((await firstPinCell.count()) > 0) {
      await expect.soft(firstPinCell).toBeFocused()
    } else if ((await firstPassField.count()) > 0) {
      await expect.soft(firstPassField).toBeFocused()
    }

    await page.getByTestId('mk-cancel').click({ force: true })
    await expect(modal).toBeHidden({ timeout: 15_000 })
    await expect.soft(opener).toBeFocused()

    await context.close()
  }
})

test('scale 150 -> target ui -> reset keeps ui selected, then restore 100', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await openFreshContextAndPage(browser, { width: 1920, height: 800 })

  await loginAndOpenSettings(page)
  await setScale(page, 150, false)

  const select = page.getByTestId('settings-section-select')
  await select.selectOption('ui', { force: true })
  await page.waitForTimeout(300)
  await expect(select).toHaveValue('ui')

  await page.getByTestId('ui-scale-reset').click({ force: true })
  await expect(page.getByTestId('ui-scale-value')).toContainText('100%')
  await expect(select).toHaveValue('ui')
  await expect.soft(page.getByTestId('settings-nav-ui')).toHaveAttribute('aria-current', 'true')

  await page.getByTestId('ui-scale-preset-100').click({ force: true })
  await expect(page.getByTestId('ui-scale-value')).toContainText('100%')

  await context.close()
})
