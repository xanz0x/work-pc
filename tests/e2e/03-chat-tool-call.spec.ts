import { expect, test } from '@playwright/test'

/**
 * Сценарий 3 (§2 хвоста волны 2): ход диалога и цикл скиллов.
 * Раньше тест принимал и ответ модели, и карточку ошибки — и проходил за
 * две секунды, скорее всего ловя ошибку. Теперь:
 * — при настроенном облаке ждём именно ответ (карточка ошибки = провал);
 * — отдельно проверяем цикл tool-calling: скилл find_file;
 * — отдельно — подтверждение опасного скилла save_password;
 * — ошибка допускается только при явно выключенном движке (E2E_CLOUD=off).
 */

const CLOUD_OFF = process.env.E2E_CLOUD === 'off'

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByTestId('login-password').fill(process.env.APP_PASSWORD as string)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })
  /* Облачный движок выбирается в настройках: по умолчанию стоит локальный.
     Выбор — черновик, он вступает в силу только после «Сохранить». */
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('engine-cloud').click()
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('settings-save')).toBeDisabled({ timeout: 15_000 })
  await page.getByTestId('nav-chat').click()
  await expect(page.getByTestId('chat-cloud-badge')).toContainText('облако', { timeout: 15_000 })
  /* Чистый диалог: истории сессий живут на диске и переживают прошлые прогоны. */
  await page.getByTestId('chat-new').click()
}

async function ask(page: import('@playwright/test').Page, text: string) {
  /* Тост «конфигурация записана» перекрывает кнопку — ждём, пока уйдёт. */
  await page.locator('.flash-toast').first().waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-input').press('Enter')
  /* Согласие на облако (P0-1): без него запрос не уходит. */
  const consent = page.getByTestId('cloud-consent-accept')
  if (await consent.isVisible().catch(() => false)) await consent.click()
}

test('диалог: ответ модели, а не карточка ошибки', async ({ page }) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  test.setTimeout(240_000)

  await login(page)
  await ask(page, 'Ответь одним словом: работает?')

  if (CLOUD_OFF) {
    await expect(page.getByTestId('ai-error-note').first()).toBeVisible({ timeout: 60_000 })
    return
  }

  await expect(page.getByTestId('ai-author').first()).toBeVisible({ timeout: 180_000 })
  /* Жёстко: ни одной карточки ошибки в диалоге быть не должно. */
  await expect(page.getByTestId('ai-error-note')).toHaveCount(0)

  /* Индикатор окна контекста (LG-1) по замыслу появляется только при
     заполнении ≥70% — на одном ходе его быть не должно. Рост `ctx.fill`
     на длинном диалоге проверяет scripts/long-dialog.mjs. */
  const fill = page.getByTestId('chat-context-fill')
  await expect(fill).toHaveCount(0)
})

test('цикл скиллов: find_file выполняется и ответ приходит после него', async ({ page }) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  test.skip(CLOUD_OFF, 'цикл скиллов требует облачного движка')
  test.setTimeout(240_000)

  await login(page)
  await ask(page, 'Найди в сейфе договор аренды — используй поиск по файлам')

  /* Событие tool: карточка скилла появляется до ответа модели. */
  const card = page.getByTestId('tool-card-find_file')
  await expect(card).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('tool-state-find_file')).toBeVisible()

  /* После результата скилла модель обязана продолжить ход текстом. */
  await expect(page.getByTestId('ai-author').first()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('ai-error-note')).toHaveCount(0)
})

test('опасный скилл: save_password ждёт подтверждения пользователя', async ({ page }) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  test.skip(CLOUD_OFF, 'подтверждение скилла требует облачного движка')
  test.setTimeout(240_000)

  await login(page)
  await ask(page, 'Придумай стойкий пароль для входа в почту и сохрани его в сейф')

  const allow = page.getByTestId('tool-allow-btn')
  await expect(allow).toBeVisible({ timeout: 180_000 })
  /* Пока подтверждения нет — скилл не выполнен. */
  await expect(page.getByTestId('tool-deny-btn')).toBeVisible()
  await allow.click()
  await expect(page.getByTestId('ai-author').first()).toBeVisible({ timeout: 180_000 })
})
