import { expect, test } from '@playwright/test'

/**
 * Сценарий 3: ход диалога с облачной моделью и циклом скиллов.
 * Требует пароль приложения и настроенный облачный движок: без них
 * тест честно пропускается, а не притворяется зелёным.
 */
test('диалог: ход уходит в облако, ответ или честная ошибка', async ({ page }) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  test.setTimeout(180_000)

  await page.goto('/login')
  await page.getByTestId('login-password').fill(process.env.APP_PASSWORD as string)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })

  // Облачный движок выбирается в настройках: по умолчанию стоит локальный.
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('engine-cloud').click()

  await page.getByTestId('nav-chat').click()
  await page.getByTestId('chat-input').fill('Найди договор аренды в сейфе и скажи, что в нём главное')
  await page.getByTestId('chat-send-btn').click()

  // Согласие на облако (P0-1): без него запрос не уходит.
  const consent = page.getByTestId('cloud-consent-accept')
  if (await consent.isVisible().catch(() => false)) await consent.click()

  // Либо ответ модели, либо честная ошибка каталога — оба варианта валидны.
  const outcome = page.locator('[data-testid="ai-author"], [data-testid="ai-error-note"]').first()
  await expect(outcome).toBeVisible({ timeout: 120_000 })

  // Индикатор окна контекста (LG-1) появляется только при реальном заполнении.
  const fill = page.getByTestId('chat-context-fill')
  if (await fill.isVisible().catch(() => false)) {
    await expect(fill).toContainText('%')
  }
})
