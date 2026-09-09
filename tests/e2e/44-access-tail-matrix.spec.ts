import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

const MASTER = 'notif-master-2026!'

test('notification text after unlock matches exact wording', async ({ page }) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await page.goto('/')

  if (page.url().includes('/login')) {
    await page.getByTestId('login-login').fill(process.env.ADMIN_LOGIN ?? 'admin')
    await page.getByTestId('login-password').fill(process.env.APP_PASSWORD as string)
    await page.getByTestId('login-submit').click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
  }

  await waitAppReady(page)
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('mk-setup-open')).toBeVisible({ timeout: 30_000 })

  const setupByTestId = page.getByTestId('mk-setup-open')
  const setupByText = page.getByRole('button', { name: 'Настроить мастер-ключ' })
  if ((await setupByTestId.count()) > 0 || (await setupByText.count()) > 0) {
    if ((await setupByTestId.count()) > 0) await setupByTestId.click()
    else await setupByText.click()
    await page.getByTestId('mk-tab-password').click()
    await page.getByTestId('mk-pass1').fill(MASTER)
    await page.getByTestId('mk-pass2').fill(MASTER)
    await page.getByTestId('mk-submit').click()
    await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })
  }

  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('lock-password').fill(MASTER)
  await page.getByTestId('lock-password-submit').click()
  await expect(page.getByTestId('lock-screen')).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-panel')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('notif-panel')).toContainText('Мастер-ключ проверен. Сейф разблокирован.')
})

test('onboarding PIN ArrowLeft moves focus to previous digit', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onb-mode-local').click()
  await page.getByTestId('onb-step1-next').click()
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '2')

  await page.getByTestId('onb-secret-0').fill('1')
  await page.getByTestId('onb-secret-1').fill('2')
  await page.getByTestId('onb-secret-1').click()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('onb-secret-0')).toBeFocused()
})

test('lock screen blocks Ctrl+K focus escape to app shell', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onb-mode-local').click()
  await page.getByTestId('onb-step1-next').click()

  for (let i = 0; i < 6; i += 1) {
    const d = String(i + 1)
    await page.getByTestId(`onb-secret-${i}`).fill(d)
    await page.getByTestId(`onb-secret-repeat-${i}`).fill(d)
  }
  await page.getByTestId('onb-create-key').click()
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '3', { timeout: 30_000 })
  await page.getByTestId('onb-pick-demo').click()
  await waitAppReady(page)

  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Control+K')

  const focus_inside_lock = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    if (!active) return false
    return Boolean(active.closest('[data-testid="lock-screen"]'))
  })
  expect(focus_inside_lock).toBe(true)
})

test('lock screen blocks programmatic focus to shell search input', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.getByTestId('onboarding')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onb-mode-local').click()
  await page.getByTestId('onb-step1-next').click()
  for (let i = 0; i < 6; i += 1) {
    const d = String(i + 1)
    await page.getByTestId(`onb-secret-${i}`).fill(d)
    await page.getByTestId(`onb-secret-repeat-${i}`).fill(d)
  }
  await page.getByTestId('onb-create-key').click()
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', '3', { timeout: 30_000 })
  await page.getByTestId('onb-pick-demo').click()
  await waitAppReady(page)

  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 20_000 })

  const focused_testid = await page.evaluate(() => {
    const target = document.querySelector('[data-testid="shell-search-input"]') as HTMLElement | null
    target?.focus()
    const active = document.activeElement as HTMLElement | null
    return active?.getAttribute('data-testid') ?? ''
  })

  expect(focused_testid).not.toBe('shell-search-input')
})
