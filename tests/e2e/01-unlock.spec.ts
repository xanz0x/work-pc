import { expect, test } from '@playwright/test'

/** Сценарий 1: настроить мастер-ключ, закрыть сейф, открыть его заново. */
test('замок: настройка, блокировка и разблокировка', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('nav-settings').click()

  await page.getByRole('button', { name: 'Настроить мастер-ключ' }).click()
  await page.getByRole('radio', { name: 'Пароль' }).click()
  await page.getByPlaceholder('от 8 символов').fill('e2e-master-2026')
  await page.getByPlaceholder('Повторите').fill('e2e-master-2026')
  await page.getByRole('button', { name: 'Включить замок' }).click()

  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })

  await page.keyboard.press('Control+Shift+L')
  const lockScreen = page.getByLabel('Сейф заблокирован')
  await expect(lockScreen).toBeVisible()

  await page.getByLabel('Мастер-пароль').fill('e2e-master-2026')
  await page.getByLabel('Мастер-пароль').press('Enter')

  await expect(lockScreen).toBeHidden({ timeout: 30_000 })
  await expect(page.getByTestId('nav-library')).toBeVisible()
})
