import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'

/** Сценарий 4: создание записи в менеджере секретов поверх замка. */
test('секреты: мастер-ключ, новая запись, запись в списке', async ({ page }) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await page.goto('/')

  await page.getByTestId('nav-settings').click()
  await page.getByRole('button', { name: 'Настроить мастер-ключ' }).click()
  await page.getByRole('radio', { name: 'Пароль' }).click()
  await page.getByPlaceholder('от 8 символов').fill('e2e-master-2026')
  await page.getByPlaceholder('Повторите').fill('e2e-master-2026')
  await page.getByRole('button', { name: 'Включить замок' }).click()
  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('nav-vault').click()
  await expect(page.getByTestId('screen-vault')).toBeVisible()

  await page.getByTestId('vault-new').click()
  const title = `e2e-запись-${Date.now()}`
  await page.getByTestId('editor-title').fill(title)
  await page.getByTestId('editor-save').click()

  await expect(page.getByTestId('vault-list').getByText(title)).toBeVisible({ timeout: 30_000 })
})
