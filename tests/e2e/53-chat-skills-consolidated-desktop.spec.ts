import { expect, test, type Page } from '@playwright/test'
import { readDoc } from './idb'
import type { SecretsFile } from '../../lib/secrets'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

const APP_URL = process.env.APP_URL
const APP_PASSWORD = process.env.APP_PASSWORD
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'admin'

test.skip(!APP_URL || !APP_PASSWORD, 'APP_URL и APP_PASSWORD обязательны')

async function login(page: Page, loginName = ADMIN_LOGIN, password = APP_PASSWORD as string) {
  await skipOnboarding(page)
  await page.goto(`${APP_URL}/login`)
  await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('login-login').fill(loginName)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await waitAppReady(page)
}

async function openChat(page: Page) {
  await page.getByTestId('nav-chat').click({ force: true })
  await expect(page.getByTestId('screen-chat')).toBeVisible({ timeout: 15_000 })
}

async function setCloudEngine(page: Page) {
  await page.getByTestId('nav-settings').click({ force: true })
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('engine-cloud').click({ force: true })
  await page.getByTestId('settings-save').click({ force: true })
  await expect(page.getByTestId('settings-save')).toBeDisabled({ timeout: 15_000 })
}

async function ensureMasterKey(page: Page) {
  await page.getByTestId('nav-settings').click({ force: true })
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 15_000 })
  if (await page.getByTestId('settings-nav-security').isVisible()) await page.getByTestId('settings-nav-security').click()
  else await page.getByTestId('settings-section-select').selectOption('security')
  await page.waitForTimeout(300)
  const setup = page.getByTestId('mk-setup-open')
  if (await setup.isVisible().catch(() => false)) {
    await setup.click({ force: true })
    await expect(page.getByTestId('mk-modal')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('mk-tab-password').click({ force: true })
    await page.getByTestId('mk-pass1').fill('Iter53MasterKey!234')
    await page.getByTestId('mk-pass2').fill('Iter53MasterKey!234')
    await page.getByTestId('mk-submit').click({ force: true })
    await expect(page.getByTestId('mk-modal')).toBeHidden({ timeout: 15_000 })
  }
}

async function sendChat(page: Page, text: string) {
  await expect(page.getByTestId('chat-send-btn')).toBeVisible({ timeout: 120_000 })
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send-btn').click({ force: true })
  const consent = page.getByTestId('cloud-consent-accept')
  try { await consent.waitFor({ state: 'visible', timeout: 1500 }); await consent.click() } catch { /* Already consented */ }
}

test('desktop consolidated: chat ui matrix + llm tools + skill panel', async ({ browser }) => {
  test.setTimeout(420_000)

  // UI matrix pass (no expensive LLM calls)
  for (const vp of [{ width: 1920, height: 800 }, { width: 1280, height: 800 }] as const) {
    for (const scale of [100, 150] as const) {
      const context = await browser.newContext({ viewport: vp })
      const page = await context.newPage()
      await login(page)
      await setCloudEngine(page)

      if (await page.getByTestId('settings-nav-ui').isVisible()) await page.getByTestId('settings-nav-ui').click()
      else await page.getByTestId('settings-section-select').selectOption('ui')
      await page.getByTestId(`ui-scale-preset-${scale}`).click({ force: true })
      await expect(page.getByTestId('ui-scale-value')).toContainText(`${scale}%`)
      await page.getByTestId('settings-save').click({ force: true })

      await openChat(page)

      await expect(page.getByTestId('chat-title')).toBeVisible()
      await expect(page.getByTestId('chat-new')).toBeVisible()
      await expect(page.getByTestId('ai-hub-open')).toBeVisible()
      await expect(page.getByTestId('chat-input')).toBeVisible()

      // New session + draft persistence + rename + session search empty
      await page.getByTestId('chat-new').click({ force: true })
      await page.getByTestId('chat-input').fill('черновик для проверки')
      await page.getByTestId('chat-new').click({ force: true })
      await page.getByTestId('chat-sessions-search').fill('non-existent-session-iter53')
      await expect(page.getByTestId('chat-sessions-empty')).toBeVisible()
      await page.getByTestId('chat-sessions-search').fill('')

      const firstSession = page.locator('.rail-item').first()
      await firstSession.dblclick()
      const renameInput = page.locator('[data-testid^="chat-session-rename-"]').first()
      await renameInput.fill('Очень длинный заголовок диалога для проверки переноса и отсутствия визуального обрезания в desktop чате')
      await renameInput.press('Enter')
      await expect(page.getByTestId('chat-title')).toContainText('Очень длинный заголовок')

      // Escape closes in-chat find panel
      await page.getByTestId('chat-find-toggle').click({ force: true })
      await expect(page.getByTestId('chat-find-input')).toBeVisible()
      await page.getByTestId('chat-find-input').press('Escape')
      await expect(page.getByTestId('chat-find-input')).toHaveCount(0)

      // Skills panel save instructions and close by Escape
      await page.getByTestId('ai-hub-open').click({ force: true })
      await expect(page.getByTestId('ai-hub-panel')).toBeVisible()
      const firstSkillOpen = page.locator('[data-testid^="skill-open-"]').first()
      await firstSkillOpen.click({ force: true })
      const editor = page.locator('[data-testid^="skill-instructions-"]').first()
      const originalInstruction = await editor.inputValue()
      await editor.fill('Тестовая инструкция; проверка сохранения.')
      await page.locator('[data-testid^="skill-save-"]').first().click({ force: true })
      await expect(page.locator('[data-testid^="skill-save-"]').first()).toContainText('Сохранено')
      await editor.fill(originalInstruction)
      await page.locator('[data-testid^="skill-save-"]').first().click({ force: true })
      await expect(page.locator('[data-testid^="skill-save-"]').first()).toContainText('Сохранено')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('ai-hub-panel')).toHaveCount(0)
      await expect(page.getByTestId('ai-hub-open')).toBeFocused()
      const layout = await page.getByTestId('screen-chat').evaluate((root) => {
        const r = root.getBoundingClientRect()
        return ['chat-new', 'chat-input', 'ai-hub-open', 'chat-find-toggle'].map(id => {
          const el = root.querySelector(`[data-testid="${id}"]`)!
          const b = el.getBoundingClientRect()
          return { id, inside: b.left >= r.left - 1 && b.right <= r.right + 1 && b.bottom <= r.bottom + 1 }
        })
      })
      expect(layout.every(x => x.inside), JSON.stringify(layout)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      console.log(`PASS desktop ${vp.width} / ${scale}%: layout, rail, search/Escape, skills/save, focus`)

      await context.close()
    }
  }

  // Single real LLM chain to respect provider limits.
  const context = await browser.newContext({ viewport: { width: 1920, height: 800 } })
  const page = await context.newPage()
  await login(page)
  await setCloudEngine(page)
  await ensureMasterKey(page)
  await openChat(page)
  await page.getByTestId('chat-new').click()
  await expect(page.getByTestId('chat-empty-title')).toBeVisible()
  const requests: string[] = []
  page.on('request', req => { if (req.url().includes('/ai-api/')) requests.push(req.postData() ?? '') })

  await sendChat(page, 'Сгенерируй пароль длиной 16 символов для сайта example.com')
  const genCard = page.locator('[data-tool-name="generate_password"]').last()
  await expect(genCard).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('[data-testid^="password-value-"]').last()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('chat-send-btn')).toBeVisible({ timeout: 120_000 })
  await page.locator('[data-testid^="password-reveal-"]').last().click({ force: true })
  const generated = await page.locator('[data-testid^="password-value-"]').last().textContent()
  expect(generated?.length).toBe(16)
  await page.locator('[data-testid^="password-copy-"]').last().click({ force: true })

  await sendChat(page, 'Используй save_password и сохрани этот пароль в секреты: сайт Example, url https://example.com, login admin@example.com')
  const allowBtn = page.getByTestId('tool-allow-btn')
  await expect(allowBtn).toBeVisible({ timeout: 120_000 })
  // Two approvals in the same tick must still produce one record.
  await allowBtn.evaluate((el: HTMLButtonElement) => { el.click(); el.click() })
  const save = page.locator('[data-tool-name="save_password"]').last()
  await expect(save).toHaveClass(/is-ok/, { timeout: 30_000 })
  await expect(page.getByTestId('chat-send-btn')).toBeVisible({ timeout: 120_000 })
  const box = await readDoc<SecretsFile>(page, 'wf.secrets.v1')
  const entries = box?.entries.filter(e => e.title === 'Example') ?? []
  expect(entries).toHaveLength(1)
  expect(entries[0].fields.find(f => f.name === 'Сайт')?.value).toBe('https://example.com')
  expect(entries[0].fields.find(f => f.name === 'Логин')?.value).toBe('admin@example.com')
  const storedPassword = entries[0].fields.find(f => f.name === 'Пароль')!
  expect(storedPassword.secret).toBe(true)
  expect(storedPassword.value).not.toBe(generated)
  expect(storedPassword.value).toContain(':')
  expect(requests.join('\n')).not.toContain(generated!)
  expect(JSON.stringify(await readDoc(page, 'wf.chat.v1'))).not.toContain(generated!)
  console.log('PASS real Claude generate→save, confirmation/double approval, URL/login, encrypted storage, no plaintext requests/history')

  await sendChat(page, 'Вызови create_mailbox для Gmail и покажи выданный адрес. Не выдумывай адрес.')
  const mailboxCard = page.locator('[data-tool-name="create_mailbox"]').last()
  await expect(mailboxCard).toBeVisible({ timeout: 180_000 })
  await expect(allowBtn).toBeVisible({ timeout: 30_000 })
  await allowBtn.click()
  await expect(mailboxCard).toHaveClass(/is-ok/, { timeout: 60_000 })
  await expect(page.getByTestId('chat-send-btn')).toBeVisible({ timeout: 120_000 })
  const boxes = await (await page.request.get('/ai-api/mail/temp')).json()
  const gmailBox = (boxes.boxes as { id: string; kind: string; address: string; createdAt: number }[])
    .filter(b => b.kind === 'gmail')
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  expect(boxes.smailpro).toBe(true)
  expect(gmailBox?.address).toMatch(/@gmail\.com$/)
  await expect(page.locator('.m-ai').last()).toContainText(gmailBox!.address)
  console.log('PASS Gmail via SmailPro: real address issued', gmailBox!.address)

  // Внутренний бесплатный генератор (mail.tm) — без расхода лимитов модели.
  const created = await (await page.request.post('/ai-api/mail/temp', { data: { kind: 'mailtm' } })).json()
  expect(created.box.address).toMatch(/@/)
  const inbox = await (await page.request.get(`/ai-api/mail/temp/${created.box.id}/inbox`)).json()
  expect(Array.isArray(inbox.rows)).toBe(true)
  expect((await page.request.delete(`/ai-api/mail/temp/${created.box.id}`)).ok()).toBe(true)
  await page.request.delete(`/ai-api/mail/temp/${gmailBox!.id}`)
  console.log('PASS free internal mail.tm generator: create, inbox, delete')

  await sendChat(page, 'Создай заметку с текстом test-iter53-stop')
  await expect(page.getByTestId('tool-deny-btn')).toBeVisible({ timeout: 120_000 })
  await page.getByTestId('chat-stop').click({ force: true })
  await expect(page.getByTestId('chat-send-btn')).toBeVisible({ timeout: 30_000 })
  await sendChat(page, 'Ответь одним словом: ок?')
  await expect(page.getByTestId('chat-send-btn')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.m-ai').last()).not.toContainText('Не удалось')
  console.log('PASS stop approval and next real turn')
  await page.getByTestId('nav-vault').click()
  await expect(page.getByTestId('vault-list').getByText('Example', { exact: true })).toBeVisible()
  await openChat(page)
  await expect(page.locator('[data-testid^="password-value-"]').last()).toHaveText('Пароль больше не доступен')
  console.log('PASS vault record visible and generated value cleared on navigation')

  await context.close()
})
