import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

const APP_PASS = process.env.APP_PASSWORD as string
const ADMIN_LOGIN = process.env.ADMIN_LOGIN as string

const SHOTS_DIR = 'test_reports/screenshots_iter46'
const VIEWPORTS = [
  { key: 'desktop', width: 1920, height: 800 },
  { key: 'mobile', width: 390, height: 844 },
  /* Короткий экран проверяется настоящим окном: модалки считают высоту в vh,
     поэтому подмена height через style давала ложные срабатывания. */
  { key: 'short', width: 1280, height: 420 },
] as const
const ZOOMS = [100, 150] as const

type MatrixResult = {
  state: string
  viewport: string
  zoom: number
  selector: string
  found: boolean
  violations: string[]
}

type LayoutCheck = { found: boolean; violations: string[] }

mkdirSync(SHOTS_DIR, { recursive: true })

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 800 })
  await page.request.post(`${process.env.APP_URL}/ai-api/auth/login`, { data: { login: ADMIN_LOGIN, password: APP_PASS } })
})

async function loginIfNeeded(page: Page): Promise<void> {
  if (!page.url().includes('/login')) return
  await page.getByTestId('login-login').fill(ADMIN_LOGIN)
  await page.getByTestId('login-password').fill(APP_PASS)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

async function openAppReady(page: Page): Promise<void> {
  await skipOnboarding(page)
  await page.goto('/')
  await loginIfNeeded(page)
  await waitAppReady(page)
}

async function setupMasterPassword(page: Page, pass: string): Promise<void> {
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('mk-setup-open')).toBeVisible({ timeout: 30_000 })
  const setup = page.getByTestId('mk-setup-open')
  const change = page.getByTestId('mk-change-open')
  if ((await setup.count()) > 0 && (await setup.isVisible().catch(() => false))) {
    await setup.click()
    await page.getByTestId('mk-tab-password').click()
    await page.getByTestId('mk-pass1').fill(pass)
    await page.getByTestId('mk-pass2').fill(pass)
    await page.getByTestId('mk-submit').click()
    await expect(page.getByTestId('mk-modal')).toBeHidden({ timeout: 30_000 })
    return
  }
  if ((await change.count()) > 0) {
    await change.click()
    const current = page.getByTestId('mk-cur')
    if (await current.isVisible().catch(() => false)) {
      await current.fill(pass)
      await page.getByTestId('mk-next1').fill(pass)
      await page.getByTestId('mk-next2').fill(pass)
      await page.getByTestId('mk-change-submit').click()
      await expect(page.getByTestId('mk-change-modal')).toBeHidden({ timeout: 30_000 })
    }
  }
}

async function setUiZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    document.documentElement.style.setProperty('--ui-zoom', String(z / 100))
    document.documentElement.dataset.uiScale = String(z)
  }, zoom)
}

async function checkBounds(page: Page, rootSelector: string): Promise<LayoutCheck> {
  return page.evaluate((selector) => {
    const root = document.querySelector<HTMLElement>(selector)
    if (!root || root.getClientRects().length === 0) return { found: false, violations: ['root-missing'] }

    const vw = window.innerWidth
    const vh = window.innerHeight
    const violations: string[] = []
    const eps = 1

    const isVisiblePoint = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) return false
      const cx = Math.min(vw - 1, Math.max(1, r.left + r.width / 2))
      const cy = Math.min(vh - 1, Math.max(1, r.top + r.height / 2))
      const top = document.elementFromPoint(cx, cy)
      return !!top && (top === el || el.contains(top) || top.contains(el))
    }

    const inClip = (el: HTMLElement) => {
      let node: HTMLElement | null = el
      let rect = el.getBoundingClientRect()
      while (node?.parentElement) {
        // A fixed overlay escapes scroll clipping of the settings ancestors.
        if (getComputedStyle(node).position === 'fixed') break
        const parent: HTMLElement | null = node.parentElement
        const cs = getComputedStyle(parent)
        const clips = ['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowY)
          || ['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX)
        if (clips) {
          const pr = parent.getBoundingClientRect()
          rect = {
            left: Math.max(rect.left, pr.left),
            top: Math.max(rect.top, pr.top),
            right: Math.min(rect.right, pr.right),
            bottom: Math.min(rect.bottom, pr.bottom),
            width: 0,
            height: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect
          if (rect.right - rect.left <= 1 || rect.bottom - rect.top <= 1) return false
        }
        node = parent
      }
      return true
    }

    const nodes = [
      root,
      ...Array.from(
        root.querySelectorAll<HTMLElement>(
          'h1,h2,header,[data-testid$="-title"],button,input,textarea,select,[role="button"],[role="tab"],[role="radio"]',
        ),
      ),
    ]

    for (const n of nodes) {
      if (n.classList.contains('sr-only') || n.getAttribute('type') === 'file' || n.closest('[inert]')) continue
      const r = n.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      if (r.left < -eps) violations.push(`overflow-left:${n.tagName}:${r.left.toFixed(1)}`)
      if (r.right > vw + eps) violations.push(`overflow-right:${n.tagName}:${r.right.toFixed(1)}`)
      // Short screens intentionally scroll. Test reachability after scrolling,
      // not whether every field is on screen simultaneously.
      if (n !== root) {
        n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
        if (!inClip(n)) violations.push(`unreachable:${n.tagName}:${n.dataset.testid ?? ''}`)
      }
    }

    const header =
      root.querySelector<HTMLElement>('header, h1, h2, [data-testid$="-title"], .onb-head, .mk-head') ?? root
    const btns = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'))
    const lastBtn = btns.length ? btns[btns.length - 1] : null

    header.scrollIntoView({ block: 'center', inline: 'nearest' })
    if (!isVisiblePoint(header)) violations.push('header-not-click-visible')
    if (lastBtn) {
      lastBtn.scrollIntoView({ block: 'center', inline: 'nearest' })
      if (!isVisiblePoint(lastBtn)) violations.push('last-button-not-click-visible')
    }

    return { found: true, violations }
  }, rootSelector)
}

async function runLayoutMatrix(
  page: Page,
  testInfo: TestInfo,
  results: MatrixResult[],
  state: string,
  rootSelector: string,
) {
  /* Тост-уведомление живёт пару секунд и перекрывает контент на коротком
     экране — ждём, пока уедет, иначе матрица ловит не раскладку, а тост. */
  await page.locator('.flash-toast').first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {})
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    for (const zoom of ZOOMS) {
      await setUiZoom(page, zoom)
      await page.waitForTimeout(200)

      const check = await checkBounds(page, rootSelector)
      const shot = `${SHOTS_DIR}/${state}-${vp.key}-z${zoom}.jpeg`
      await page.screenshot({ path: shot, type: 'jpeg', quality: 40, fullPage: false })

      results.push({
        state,
        viewport: `${vp.width}x${vp.height}`,
        zoom,
        selector: rootSelector,
        found: check.found,
        violations: check.violations,
      })
      writeFileSync(`${SHOTS_DIR}/matrix-${state[0]}-results.json`, JSON.stringify(results, null, 2))

      expect.soft(check.found, `${state} missing @ ${vp.width}x${vp.height} z${zoom}`).toBe(true)
      expect.soft(check.violations, `${state} overflow/clip @ ${vp.width}x${vp.height} z${zoom}`).toEqual([])
      await testInfo.attach(`${state}-${vp.key}-z${zoom}`, {
        body: JSON.stringify(check),
        contentType: 'application/json',
      })
    }
  }
  await setUiZoom(page, 100)
  await page.setViewportSize({ width: 1920, height: 800 })
}

async function expectFocusReturnAfterEscape(page: Page, opener: Locator, modal: Locator) {
  await opener.focus()
  await opener.click()
  await expect.soft(modal).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Escape')
  await expect.soft(modal).toBeHidden({ timeout: 15_000 })
  await expect.soft(opener, 'Escape close should restore focus to opener').toBeFocused()
}

test('Matrix A: settings lock dialogs + keyboard/focus return', async ({ page }, testInfo) => {
  test.setTimeout(360_000)
  const results: MatrixResult[] = []
  const pinMaster = '460011'
  const pinMaster2 = '460022'
  const passMaster = 'iter46-master-pass-2026!'

  await openAppReady(page)
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('mk-setup-open')).toBeVisible({ timeout: 30_000 })

  await expectFocusReturnAfterEscape(page, page.getByTestId('mk-setup-open'), page.getByTestId('mk-modal'))

  await page.getByTestId('mk-setup-open').click()
  await page.getByTestId('mk-tab-pin').click()
  await runLayoutMatrix(page, testInfo, results, 'a-setup-pin', '[data-testid="mk-modal"]')
  for (let i = 0; i < 6; i += 1) {
    await page.getByTestId(`mk-pin1-${i}`).fill(pinMaster[i] ?? '')
    await page.getByTestId(`mk-pin2-${i}`).fill(pinMaster[i] ?? '')
  }
  await page.getByTestId('mk-submit').click()
  await expect(page.getByTestId('mk-modal')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('mk-change-open').click()
  await runLayoutMatrix(page, testInfo, results, 'a-change-pin', '[data-testid="mk-change-modal"]')
  for (let i = 0; i < 6; i += 1) {
    await page.getByTestId(`mk-cur-${i}`).fill(pinMaster[i] ?? '')
    await page.getByTestId(`mk-next1-${i}`).fill(pinMaster2[i] ?? '')
    await page.getByTestId(`mk-next2-${i}`).fill(pinMaster2[i] ?? '')
  }
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('mk-change-modal')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('mk-disable-open').click()
  await runLayoutMatrix(page, testInfo, results, 'a-disable-pin', '[data-testid="mk-disable-modal"]')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mk-disable-modal')).toBeHidden({ timeout: 15_000 })

  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(page, testInfo, results, 'a-pin-lock', '[data-testid="lock-screen"]')
  await page.getByTestId('lock-cell-1').fill('8')
  await page.getByTestId('lock-cell-1').press('ArrowLeft')
  await expect(page.getByTestId('lock-cell-0')).toBeFocused()
  await page.getByTestId('lock-cell-1').press('Backspace')
  for (let i = 0; i < 6; i += 1) {
    await page.getByTestId(`lock-cell-${i}`).fill(pinMaster2[i] ?? '')
  }
  await expect(page.getByTestId('lock-screen')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('nav-settings').click()
  await page.getByTestId('mk-disable-open').click()
  for (let i = 0; i < 6; i += 1) await page.getByTestId(`mk-disable-secret-${i}`).fill(pinMaster2[i])
  await page.getByTestId('mk-disable-submit').click()
  await expect(page.getByTestId('mk-disable-modal')).toBeHidden()
  await setupMasterPassword(page, passMaster)
  await page.getByTestId('mk-change-open').click()
  await page.getByTestId('mk-cur').fill(passMaster)
  await page.getByTestId('mk-next1').fill(passMaster)
  await page.getByTestId('mk-next2').fill(passMaster)
  await runLayoutMatrix(page, testInfo, results, 'a-change-password', '[data-testid="mk-change-modal"]')
  await page.getByTestId('mk-change-submit').click()
  await expect(page.getByTestId('mk-change-modal')).toBeHidden({ timeout: 30_000 })

  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(page, testInfo, results, 'a-password-lock', '[data-testid="lock-screen"]')

  const forgot = page.getByTestId('lock-forgot-key')
  await forgot.click()
  await expect(page.getByTestId('reset-lock-warning')).toBeVisible({ timeout: 15_000 })
  await runLayoutMatrix(page, testInfo, results, 'a-reset-confirm-nested', '[data-testid="reset-lock-modal"]')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reset-lock-modal')).toBeHidden({ timeout: 15_000 })
  await expect(forgot).toBeFocused()
  await page.getByTestId('lock-password').fill(passMaster)
  await page.getByTestId('lock-password').press('Enter')
  await expect(page.getByTestId('lock-screen')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('nav-settings').click()
  await page.getByTestId('mk-disable-open').click()
  await page.getByTestId('mk-disable-secret').fill(passMaster)
  await runLayoutMatrix(page, testInfo, results, 'a-disable-password', '[data-testid="mk-disable-modal"]')
  await page.getByTestId('mk-disable-submit').click()
  await expect(page.getByTestId('mk-disable-modal')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('mk-setup-open').click()
  await page.getByTestId('mk-tab-password').click()
  await runLayoutMatrix(page, testInfo, results, 'a-setup-password', '[data-testid="mk-modal"]')
  await page.keyboard.press('Escape')

  writeFileSync(`${SHOTS_DIR}/matrix-a-results.json`, JSON.stringify(results, null, 2))
})

test('Matrix B + sticker flow: file key modals, vault io, backup rows, sticker unlock', async ({ page }, testInfo) => {
  test.setTimeout(420_000)
  const results: MatrixResult[] = []
  const statePass = 'iter46-state-pass-2026!'
  const filePass = 'iter46-file-pass-2026!'
  const backupPass = 'iter46-backup-pass-2026!'
  const stickerPass = 'iter46-sticker-pass-2026!'

  await openAppReady(page)
  await setupMasterPassword(page, statePass)

  await page.getByTestId('nav-vault').click()
  await expect(page.getByTestId('screen-vault')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('vault-new').click()
  await expect(page.getByTestId('entry-editor')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(page, testInfo, results, 'b-secret-editor', '[data-testid="entry-editor"]')
  await page.getByTestId('editor-title').fill(`iter46-secret-${Date.now()}`)
  await page.getByTestId('editor-field-name-0').fill('demo')
  await page.getByTestId('editor-field-value-0').fill('value')
  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('entry-editor')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('vault-open-io').click()
  await expect(page.getByTestId('vault-io')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(page, testInfo, results, 'b-io-import', '[data-testid="vault-io"]')
  await page.getByTestId('io-tab-export').click()
  await expect(page.getByTestId('io-plain-box')).toBeVisible()
  await runLayoutMatrix(page, testInfo, results, 'b-io-export-danger', '[data-testid="vault-io"]')
  await page.getByTestId('io-tab-backup').click()
  await runLayoutMatrix(page, testInfo, results, 'b-io-backups', '[data-testid="vault-io"]')
  await page.getByTestId('io-close').click()

  await page.getByTestId('nav-library').click()
  const fileName = `existing09-iter46-${Date.now()}.txt`
  await page.getByTestId('file-picker').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('iter46 own uploaded file'),
  })
  const fileTile = page.locator('[data-tile-key^="file:"]').filter({ hasText: fileName }).first()
  await expect(fileTile).toBeVisible({ timeout: 30_000 })
  await fileTile.click()

  await page.getByTestId('fk-set-open').click()
  await expect(page.getByTestId('fk-set-modal')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(page, testInfo, results, 'b-file-set', '[data-testid="fk-set-modal"]')
  await page.getByTestId('fk-set-pass1').fill(filePass)
  await page.getByTestId('fk-set-pass2').fill(filePass)
  await page.getByTestId('fk-set-save').click()
  await expect(page.getByTestId('fk-set-modal')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('nav-library').click()
  await fileTile.click()
  await expect(page.getByTestId('fk-ask-modal')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(page, testInfo, results, 'b-file-ask', '[data-testid="fk-ask-modal"]')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Новый стикер' }).click()
  await page.locator('textarea.textarea').fill('iter46 sticker\nprotected body')
  await page.getByRole('switch', { name: 'Закрыть стикер паролем' }).click()
  await page.getByTestId('note-draft-password').fill(stickerPass)
  await page.getByTestId('note-draft-password-eye').click()
  await expect(page.getByTestId('note-draft-password')).toHaveAttribute('type', 'text')
  await page.getByTestId('note-draft-password-eye').click()
  await expect(page.getByTestId('note-draft-password')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  /* Закрытая карточка сначала показывает кнопку «Ввести ключ»: поле появляется после клика. */
  const stickerCard = page.locator('[data-testid^="lib-note-"]').filter({ hasText: 'iter46 sticker' }).first()
  await expect(stickerCard).toBeVisible({ timeout: 30_000 })
  await stickerCard.locator('[data-testid^="note-unlock-open-"]').click()
  const lockInput = stickerCard.locator('input[data-testid^="note-unlock-password-"]').first()
  await expect(lockInput).toBeVisible({ timeout: 30_000 })
  const lockId = (await lockInput.getAttribute('data-testid'))?.replace('note-unlock-password-', '') ?? ''
  await lockInput.fill('wrong-pass')
  await page.getByTestId(`note-unlock-submit-${lockId}`).click()
  await expect(stickerCard.locator('.key-hint.err')).toBeVisible({ timeout: 15_000 })
  await lockInput.fill(stickerPass)
  await page.getByTestId(`note-unlock-submit-${lockId}`).click()
  await expect(stickerCard.getByText('protected body')).toBeVisible({ timeout: 20_000 })

  await page.locator(`[data-testid="lib-note-${lockId}"]`).click()
  /* Тумблер уже включён: сначала снимаем прежний пароль, потом ставим заново. */
  const guard = page.getByRole('switch', { name: 'Пароль на стикер' })
  if ((await guard.getAttribute('aria-checked')) === 'true') await guard.click()
  await guard.click()
  await page.getByTestId('note-set-password').fill(stickerPass)
  await page.locator('.key-setup').getByRole('button', { name: 'Закрыть' }).click()
  await page.getByTestId('note-inspector-password').fill('bad-inspector-pass')
  await page.keyboard.press('Enter')
  await expect(page.locator('.unlock-insp .key-hint.err')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('note-inspector-password').fill(stickerPass)
  await page.keyboard.press('Enter')
  await expect(page.locator('.preview.note-preview p')).toContainText('protected body', { timeout: 20_000 })

  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('settings-backup')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('backup-pwd').fill(backupPass)
  if (await page.getByTestId('backup-pwd2').isVisible().catch(() => false)) {
    await page.getByTestId('backup-pwd2').fill(backupPass)
  }
  await page.getByTestId('backup-create').click()
  await expect(page.locator('[data-testid^="backup-row-"]').first()).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-testid^="backup-restore-"]').first().click()
  await expect(page.getByTestId('backup-open-row')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(page, testInfo, results, 'b-backup-open-row', '[data-testid="backup-open-row"]')
  await page.keyboard.press('Escape')

  await page.evaluate(() => {
    const main = document.querySelector('.set-main')
    document.getElementById('set-danger')?.scrollIntoView({ block: 'start' })
    return !!main
  })
  await expect(page.getByTestId('settings-delete-vault')).toBeVisible({ timeout: 15_000 })

  writeFileSync(`${SHOTS_DIR}/matrix-b-results.json`, JSON.stringify(results, null, 2))
})

test('Matrix C: onboarding step2 pin/password, decline warning, vault gate before setup', async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  const results: MatrixResult[] = []

  const onbCtx = await browser.newContext({ storageState: 'test-results/.auth/admin.json' })
  const onbPage = await onbCtx.newPage()
  await onbPage.request.post(`${process.env.APP_URL}/ai-api/auth/login`, { data: { login: ADMIN_LOGIN, password: APP_PASS } })
  await onbPage.goto('/')
  await expect(onbPage.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
  await onbPage.getByTestId('onb-mode-local').click()
  await onbPage.getByTestId('onb-step1-next').click()
  await expect(onbPage.getByTestId('onboarding')).toHaveAttribute('data-step', '2')

  await runLayoutMatrix(onbPage, testInfo, results, 'c-onboarding-step2-pin', '[data-testid="onboarding"]')
  await onbPage.getByTestId('onb-method-password').click()
  await runLayoutMatrix(onbPage, testInfo, results, 'c-onboarding-step2-password', '[data-testid="onboarding"]')

  await onbPage.getByTestId('onb-decline').click()
  await expect(onbPage.getByTestId('onb-decline-confirm')).toBeVisible({ timeout: 10_000 })
  await runLayoutMatrix(onbPage, testInfo, results, 'c-onboarding-decline-warning', '[data-testid="onboarding"]')
  await onbPage.getByTestId('onb-decline-no').click()

  await onbPage.getByTestId('onb-method-pin').click()
  await onbPage.getByTestId('onb-secret-0').fill('1')
  await onbPage.getByTestId('onb-secret-1').fill('2')
  await onbPage.getByTestId('onb-secret-1').press('ArrowLeft')
  await expect(onbPage.getByTestId('onb-secret-0')).toBeFocused()
  await onbPage.getByTestId('onb-secret-1').press('Backspace')
  for (let i = 0; i < 6; i += 1) {
    await onbPage.getByTestId(`onb-secret-${i}`).fill(String(i + 1))
    await onbPage.getByTestId(`onb-secret-repeat-${i}`).fill(String(i + 1))
  }
  await onbPage.keyboard.press('Enter')
  await expect.soft(onbPage.getByTestId('onboarding')).toHaveAttribute('data-step', '3', { timeout: 30_000 })
  await onbCtx.close()

  const gateCtx = await browser.newContext({ storageState: 'test-results/.auth/admin.json' })
  const gatePage = await gateCtx.newPage()
  await gatePage.request.post(`${process.env.APP_URL}/ai-api/auth/login`, { data: { login: ADMIN_LOGIN, password: APP_PASS } })
  await skipOnboarding(gatePage)
  await gatePage.goto('/')
  await loginIfNeeded(gatePage)
  await waitAppReady(gatePage)
  await gatePage.getByTestId('nav-vault').click()
  await expect(gatePage.getByTestId('vault-gate-lock')).toBeVisible({ timeout: 30_000 })
  await runLayoutMatrix(gatePage, testInfo, results, 'c-vault-gate-before-setup', '[data-testid="vault-gate-lock"]')
  await gateCtx.close()

  writeFileSync(`${SHOTS_DIR}/matrix-c-results.json`, JSON.stringify(results, null, 2))
})

test('Matrix D: temp-password wall, license wall, blocked wall simulated, login/register', async ({ browser }, testInfo) => {
  test.setTimeout(420_000)
  const results: MatrixResult[] = []
  const tempLogin = `iter46_${Date.now().toString(36)}`
  const tempPass = 'iter46-temp-pass-2026!'
  const ownPass = 'iter46-own-pass-2026!'

  const adminCtx = await browser.newContext({ storageState: 'test-results/.auth/admin.json' })
  const admin = await adminCtx.newPage()
  await admin.request.post(`${process.env.APP_URL}/ai-api/auth/login`, { data: { login: ADMIN_LOGIN, password: APP_PASS } })
  await skipOnboarding(admin)
  await admin.goto('/')
  await loginIfNeeded(admin)
  await waitAppReady(admin)
  await admin.getByTestId('topbar-admin-btn').click()
  await expect(admin.getByTestId('screen-admin')).toBeVisible({ timeout: 30_000 })
  await admin.getByTestId('admin-create-open').click()
  await admin.getByTestId('admin-create-login').fill(tempLogin)
  await admin.getByTestId('admin-create-name').fill('Iter 46 User')
  await admin.getByTestId('admin-create-password').fill(tempPass)
  await admin.getByTestId('admin-create-plan').selectOption('')
  await admin.getByTestId('admin-create-submit').click()
  await expect(admin.getByTestId('admin-created')).toBeVisible({ timeout: 20_000 })

  const userCtx = await browser.newContext()
  const user = await userCtx.newPage()
  await user.goto('/login')
  await user.getByTestId('login-login').fill(tempLogin)
  await user.getByTestId('login-password').fill(tempPass)
  await user.getByTestId('login-submit').click()
  await expect(user.getByTestId('access-wall')).toHaveAttribute('data-access', 'password', { timeout: 30_000 })
  await runLayoutMatrix(user, testInfo, results, 'd-temp-password-wall', '[data-testid="access-wall"]')
  await user.getByTestId('wall-password-next').fill(ownPass)
  await user.getByTestId('wall-password-again').fill(ownPass)
  await user.getByTestId('wall-password-submit').click()

  await expect(user.getByTestId('access-wall')).toHaveAttribute('data-access', 'license', { timeout: 30_000 })
  await runLayoutMatrix(user, testInfo, results, 'd-license-wall', '[data-testid="access-wall"]')
  await user.getByTestId('wall-license-key').fill('WSX-AAAA-BBBB-CCCC-DDDD')
  await user.getByTestId('wall-license-submit').click()
  await expect(user.getByTestId('wall-error')).toBeVisible({ timeout: 15_000 })
  await userCtx.close()

  const simCtx = await browser.newContext()
  const sim = await simCtx.newPage()
  await sim.route('**/ai-api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authed: true,
        configured: true,
        access: 'blocked',
        user: {
          id: 'sim-iter46',
          login: 'simblocked',
          name: 'Sim Blocked',
          role: 'user',
          status: 'blocked',
          features: { ai: true, mcp: true, sync: true, secrets: true, offline: true, telemetry: true, mail: true, cloud: true },
          aiDailyLimit: 50,
          aiCallsToday: 0,
          aiCallsTotal: 0,
          licenseUntil: null,
          plan: { id: 'basic', name: 'Basic', color: 'graphite' },
          mustChangePassword: false,
          legacyStore: false,
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
          sessions: 1,
        },
      }),
    })
  })
  await sim.goto('/')
  await expect(sim.getByTestId('access-wall')).toHaveAttribute('data-access', 'blocked', { timeout: 20_000 })
  await runLayoutMatrix(sim, testInfo, results, 'd-blocked-wall-simulated', '[data-testid="access-wall"]')
  await simCtx.close()

  const loginCtx = await browser.newContext()
  const loginPage = await loginCtx.newPage()
  await loginPage.goto('/login')
  await expect(loginPage.getByTestId('login-page')).toBeVisible({ timeout: 20_000 })
  await runLayoutMatrix(loginPage, testInfo, results, 'd-login', '[data-testid="login-form"]')
  await loginPage.getByTestId('login-tab-register').click()
  await expect(loginPage.getByTestId('login-key')).toBeVisible({ timeout: 10_000 })
  await runLayoutMatrix(loginPage, testInfo, results, 'd-register', '[data-testid="login-form"]')
  await loginCtx.close()

  await admin.getByTestId('admin-tab-users').click()
  await admin.getByTestId('admin-user-row').filter({ hasText: tempLogin }).click()
  await admin.getByTestId('admin-card-delete').click()
  await admin.getByTestId('admin-card-delete').click()
  await expect(admin.getByTestId('admin-user-row').filter({ hasText: tempLogin })).toHaveCount(0, { timeout: 15_000 })
  await adminCtx.close()

  writeFileSync(`${SHOTS_DIR}/matrix-d-results.json`, JSON.stringify(results, null, 2))
})
