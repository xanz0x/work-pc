import { expect, test, type Page } from '@playwright/test'
import { readDoc } from './idb'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

const APP_PASS = process.env.APP_PASSWORD as string
const ADMIN_LOGIN = process.env.ADMIN_LOGIN as string

const MASTER = 'iter45-master-2026!'
const MASTER_NEW = 'iter45-master-new-2026!'
const FILE_PASS = 'iter45-file-pass-2026!'
const SECRET_VALUE = 'ITER45_SECRET_VALUE_2026'
const BACKUP_PASS = 'iter45-backup-pass-2026!'

const SHOTS = 'test_reports/screenshots_iter45'

// Playwright creates a fresh context for each test. Never clear storage in an
// init script: it runs again on reload and invalidates persistence assertions.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 800 })
  const response = await page.request.post(`${process.env.APP_URL}/ai-api/auth/login`, { data: { login: ADMIN_LOGIN, password: APP_PASS } })
  expect(response.ok()).toBe(true)
})

async function loginIfNeeded(page: Page): Promise<void> {
  if (!page.url().includes('/login')) return
  await page.getByTestId('login-login').fill(ADMIN_LOGIN)
  await page.getByTestId('login-password').fill(APP_PASS)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

async function setupMasterPassword(page: Page, pass: string): Promise<void> {
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('mk-setup-open')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('mk-setup-open').click()
  await page.getByTestId('mk-tab-password').click()
  await page.getByTestId('mk-pass1').fill(pass)
  await page.getByTestId('mk-pass2').fill(pass)
  await page.getByTestId('mk-submit').click()
  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })
}

async function createSecretEntry(page: Page, title: string, value: string): Promise<void> {
  await page.getByTestId('nav-vault').click()
  await expect(page.getByTestId('screen-vault')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('vault-new').click()
  await expect(page.getByTestId('entry-editor')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('editor-title').fill(title)
  await page.getByTestId('editor-field-name-0').fill('Master Secret')
  await page.getByTestId('editor-field-value-0').fill(value)
  const secretToggle = page.getByTestId('editor-field-secret-0')
  if ((await secretToggle.getAttribute('aria-pressed')) !== 'true') {
    await secretToggle.click()
  }

  // editor field visibility toggle
  const eye = page.locator('[data-testid^="editor-field-eye-"]').first()
  await expect(eye).toBeVisible()
  await eye.click()
  await expect(page.getByTestId('editor-field-value-0')).toHaveAttribute('type', 'text')
  await eye.click()
  await expect(page.getByTestId('editor-field-value-0')).toHaveAttribute('type', 'password')

  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('entry-editor')).toBeHidden({ timeout: 30_000 })
  await expect(page.getByTestId('vault-list').getByText(title)).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('vault-list').getByText(title).click()
  await expect(page.getByTestId('detail-title')).toHaveText(title)
}

test('P1: master reset E2E, strict confirm variants, file-key map cleared, login unchanged', async ({ page }) => {
  test.setTimeout(240_000)
  await skipOnboarding(page)
  await page.goto('/')
  await loginIfNeeded(page)
  await waitAppReady(page)

  await setupMasterPassword(page, MASTER)

  await page.getByTestId('nav-library').click()
  const fileName = `iter45-file-${Date.now()}.txt`
  await page.getByTestId('file-picker').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('iter45 protected file'),
  })
  const fileTile = page.locator('[data-tile-key^="file:"]').filter({ hasText: fileName })
  await expect(fileTile).toHaveCount(1, { timeout: 30_000 })
  const tileKey = await fileTile.first().getAttribute('data-tile-key')
  const fileId = String(tileKey).replace('file:', '')
  await expect
    .poll(async () => {
      const files = await readDoc<Array<{ id: string }>>(page, 'wf.files.v1')
      return files?.some((f) => f.id === fileId) ?? false
    }, { timeout: 30_000 })
    .toBe(true)

  await fileTile.first().click()
  await page.getByTestId('fk-set-open').click()
  await expect(page.getByTestId('fk-set-modal')).toBeVisible()
  await page.getByTestId('fk-set-pass1').fill(FILE_PASS)
  await page.getByTestId('fk-set-pass2').fill(FILE_PASS)
  await page.getByTestId('fk-set-save').click()
  await expect(page.getByTestId('fk-set-modal')).toBeHidden({ timeout: 30_000 })

  const secretTitle = `iter45-secret-${Date.now()}`
  await createSecretEntry(page, secretTitle, SECRET_VALUE)

  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 20_000 })

  const forgot = page.getByTestId('lock-forgot-key')
  await forgot.click()
  await expect(page.getByTestId('reset-lock-modal')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reset-lock-modal')).toBeHidden({ timeout: 10_000 })
  await expect(forgot).toBeFocused()

  await forgot.click()
  await expect(page.getByTestId('reset-lock-modal')).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(page.getByTestId('reset-lock-modal')).toBeHidden({ timeout: 10_000 })
  await expect(forgot).toBeFocused()

  await forgot.click()
  const badVariants = ['сбросить', 'СБРОСИТЬ ', ' СБРОСИТЬ', 'RESET', 'СБРОСИТЬ\n']
  let unexpectedResetVariant: string | null = null
  for (const txt of badVariants) {
    await page.getByTestId('reset-lock-confirmation').fill(txt)
    await expect(page.getByTestId('reset-lock-submit')).toBeDisabled()
    await page.getByTestId('reset-lock-confirmation').press('Enter')
    const modalVisible = await page
      .getByTestId('reset-lock-modal')
      .isVisible()
      .catch(() => false)
    if (!modalVisible) {
      unexpectedResetVariant = txt
      break
    }
    const stillConfigured = await page.evaluate(() => {
      const cfg = localStorage.getItem('wf.lock.config')
      return typeof cfg === 'string' && cfg.length > 0
    })
    expect(stillConfigured).toBe(true)
  }

  expect.soft(
    unexpectedResetVariant,
    `Variant must not reset lock but reset happened for: ${unexpectedResetVariant ?? 'none'}`,
  ).toBeNull()

  await page.screenshot({
    path: `${SHOTS}/p1-reset-dialog-before-confirm.jpeg`,
    type: 'jpeg',
    quality: 40,
    fullPage: false,
  })

  if (!unexpectedResetVariant) {
    await page.getByTestId('reset-lock-confirmation').fill('СБРОСИТЬ')
    await page.getByTestId('reset-lock-confirmation').press('Enter')
  }
  await expect(page.getByTestId('lock-screen')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('mk-setup-open')).toBeVisible({ timeout: 30_000 })

  const lockCfg = await page.evaluate(() => localStorage.getItem('wf.lock.config'))
  const lockState = await page.evaluate(() => localStorage.getItem('wf.lock.state'))
  expect(lockCfg).toBeNull()
  expect(lockState).toBeNull()

  const map = await readDoc<Record<string, unknown>>(page, 'wf.filekeys.map.v1')
  expect(Object.keys(map ?? {})).toHaveLength(0)

  await page.reload()
  await waitAppReady(page)
  await page.getByTestId('nav-library').click()
  await expect(page.locator(`[data-tile-key="file:${fileId}"]`)).toBeVisible({ timeout: 30_000 })

  await setupMasterPassword(page, MASTER_NEW)
  await page.getByTestId('nav-vault').click()
  // Old SEK remains encrypted by the lost master: the existing gate refuses
  // access, rather than rendering a list with decryptable values.
  await expect(page.getByTestId('vault-gate-wait')).toBeVisible({ timeout: 30_000 })
  const retained = await readDoc<{ entries: Array<{ title: string }> }>(page, 'wf.secrets.v1')
  expect(retained?.entries.some((entry) => entry.title === secretTitle)).toBe(true)
  expect(JSON.stringify(retained)).not.toContain(SECRET_VALUE)

  await page.getByTestId('profile-logout').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await page.getByTestId('login-login').fill(ADMIN_LOGIN)
  await page.getByTestId('login-password').fill(APP_PASS)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
  await expect(page.getByTestId('lock-password')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('lock-password').fill(MASTER_NEW)
  await page.getByTestId('lock-password').press('Enter')
  await expect(page.getByTestId('lock-screen')).toBeHidden({ timeout: 30_000 })
  await waitAppReady(page)
})

test('P2: nonempty secret, reveal auto-hide, encrypted export/import wrong+correct password, backup open invalid/valid', async ({ page }) => {
  test.setTimeout(240_000)
  await skipOnboarding(page)
  await page.goto('/')
  await loginIfNeeded(page)
  await waitAppReady(page)

  await setupMasterPassword(page, MASTER)
  const title = `iter45-io-${Date.now()}`
  await createSecretEntry(page, title, SECRET_VALUE)

  const revealBtn = page.locator('[data-testid^="reveal-"]').first()
  await revealBtn.click()
  await expect(page.locator('[data-testid^="secret-value-"]').first()).toContainText(SECRET_VALUE)
  await page.waitForTimeout(9000)
  await expect(page.locator('[data-testid^="secret-value-"]').first()).not.toContainText(SECRET_VALUE)

  await page.getByTestId('vault-open-io').click()
  await expect(page.getByTestId('vault-io')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('io-tab-export').click()
  await page.getByTestId('io-export-pass').fill(BACKUP_PASS)
  await page.getByTestId('io-export-pass-eye').click()
  await page.getByTestId('io-export-pass-eye').click()

  const [encDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('io-export-enc').click(),
  ])
  const encPath = `${SHOTS}/iter45-encrypted-export.json`
  await encDownload.saveAs(encPath)

  await page.getByTestId('io-tab-import').click()
  await page.getByTestId('io-enc-pass').fill('wrong-pass-2026')
  await page.getByTestId('io-enc-pass-eye').click()
  await page.getByTestId('io-enc-pass-eye').click()
  await page.getByTestId('io-enc-file').setInputFiles(encPath)
  await expect(page.getByTestId('io-msg')).toContainText('неверный пароль', { timeout: 20_000 })

  await page.getByTestId('io-enc-pass').fill(BACKUP_PASS)
  await page.getByTestId('io-enc-file').setInputFiles(encPath)
  await expect(page.getByTestId('io-preview')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('io-apply').click()
  await expect(page.getByTestId('io-msg')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('io-close').click()
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('settings-backup')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('backup-pwd').fill(BACKUP_PASS)
  await page.getByTestId('backup-pwd-eye').click()
  await page.getByTestId('backup-pwd-eye').click()
  await page.getByTestId('backup-pwd2').fill(BACKUP_PASS)
  await page.getByTestId('backup-pwd2-eye').click()
  await page.getByTestId('backup-pwd2-eye').click()
  await page.getByTestId('backup-create').click()
  await expect(page.locator('[data-testid^="backup-row-"]').first()).toBeVisible({ timeout: 30_000 })

  await page.locator('[data-testid^="backup-restore-"]').first().click()
  await expect(page.getByTestId('backup-open-row')).toBeVisible()
  await page.getByTestId('backup-open-pwd').fill('invalid-open-password')
  await page.getByTestId('backup-open-pwd-eye').click()
  await page.getByTestId('backup-open').click()
  await expect(page.getByTestId('backup-open-error')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('backup-open-pwd').fill(BACKUP_PASS)
  await page.getByTestId('backup-open').click()
  await expect(page.getByTestId('backup-preview')).toBeVisible({ timeout: 30_000 })

  await page.screenshot({
    path: `${SHOTS}/p2-backup-preview-valid-open.jpeg`,
    type: 'jpeg',
    quality: 40,
    fullPage: false,
  })
})

test('P3: responsive access matrix smoke (1920x800, 390x844, short-height 360, zoom 125/150/200)', async ({ page, context }) => {
  test.setTimeout(240_000)

  await context.clearCookies()
  await page.setViewportSize({ width: 1920, height: 800 })
  await page.goto('/login')
  await expect(page.getByTestId('login-page')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${SHOTS}/p3-login-1920x800.jpeg`, type: 'jpeg', quality: 40, fullPage: false })

  await page.getByTestId('login-tab-register').click()
  await expect(page.getByTestId('login-key')).toBeVisible()
  await page.getByTestId('login-key').fill('WSX-0000-0000-0000-0000')
  await expect(page.getByTestId('login-submit')).toBeDisabled()
  await page.screenshot({ path: `${SHOTS}/p3-register-invalid-key-1920x800.jpeg`, type: 'jpeg', quality: 40, fullPage: false })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${SHOTS}/p3-register-390x844.jpeg`, type: 'jpeg', quality: 40, fullPage: false })

  await page.setViewportSize({ width: 1920, height: 800 })
  await page.locator('.access-scene').evaluate((el) => { (el as HTMLElement).style.height = '360px'; (el as HTMLElement).style.bottom = 'auto' })
  await page.screenshot({ path: `${SHOTS}/p3-login-short-1920x360.jpeg`, type: 'jpeg', quality: 40, fullPage: false })

  await page.setViewportSize({ width: 1920, height: 800 })
  await page.locator('.access-scene').evaluate((el) => { (el as HTMLElement).style.height = ''; (el as HTMLElement).style.bottom = '' })
  await page.evaluate(() => {
    ;(document.documentElement as HTMLElement).style.zoom = '1.25'
  })
  await page.screenshot({ path: `${SHOTS}/p3-login-zoom125.jpeg`, type: 'jpeg', quality: 40, fullPage: false })
  await page.evaluate(() => {
    ;(document.documentElement as HTMLElement).style.zoom = '1.5'
  })
  await page.screenshot({ path: `${SHOTS}/p3-login-zoom150.jpeg`, type: 'jpeg', quality: 40, fullPage: false })
  await page.evaluate(() => {
    ;(document.documentElement as HTMLElement).style.zoom = '2'
  })
  await page.screenshot({ path: `${SHOTS}/p3-login-zoom200.jpeg`, type: 'jpeg', quality: 40, fullPage: false })
  await page.evaluate(() => {
    ;(document.documentElement as HTMLElement).style.zoom = ''
  })

  const overflow = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="login-form"]') as HTMLElement | null
    if (!root) return true
    return root.scrollWidth > root.clientWidth
  })
  expect(overflow).toBe(false)
})
