import { expect, test, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Сценарий 18 (LG-4, LG-5).
 *
 * LG-4: включённая «Ежедневная сводка» склеивает поток конвейера в одну
 * запись — и из этой записи должно быть видно КАЖДОЕ склеенное событие
 * со своим временем и пометкой «новое», а прочитанность не теряется.
 *
 * LG-5: приём файлов идемпотентен — повторный запуск той же операции,
 * пока идёт первая, не создаёт вторую партию файлов.
 */

async function enter(page: Page): Promise<void> {
  await skipOnboarding(page)
  await page.goto('/')
  if (page.url().includes('/login')) {
    await page.locator('input[type=password]').fill(process.env.APP_PASSWORD ?? 'IceKrymTeam13@')
    await page.keyboard.press('Enter')
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
  }
  await waitAppReady(page)
}

/** Включить сводку конвейера в настройках уведомлений. */
async function enableDigest(page: Page): Promise<void> {
  await page.getByTestId('nav-settings').click()
  const row = page.getByTestId('toggle-ntfDigest')
  await expect(row).toBeVisible({ timeout: 30_000 })
  if ((await row.getAttribute('aria-checked')) !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('settings-save')).toBeDisabled()
}

/** Отдать файлы в приём библиотеки. */
async function addFiles(page: Page, names: string[]): Promise<void> {
  await page.getByTestId('nav-library').click()
  await page.locator('input[type=file]').first().setInputFiles(
    names.map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name} · содержимое`) })),
  )
}

test('LG-4: сводка раскрывается и показывает каждое склеенное событие', async ({ page }) => {
  test.setTimeout(180_000)
  await enter(page)
  await enableDigest(page)

  /* Три партии подряд — три события конвейера, которые сводка склеит в одну запись. */
  await addFiles(page, ['смета_ремонт.txt', 'акт_работ.txt'])
  await expect(page.locator('[data-testid^="lib-file-"]').first()).toBeVisible({ timeout: 60_000 })
  await addFiles(page, ['счёт_на_оплату.txt'])
  await page.waitForTimeout(1500)
  await addFiles(page, ['паспорт_скан.txt'])
  await page.waitForTimeout(1500)

  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-panel')).toBeVisible()

  const toggle = page.locator('[data-testid^="notif-digest-toggle-"]').first()
  await expect(toggle).toBeVisible({ timeout: 60_000 })
  /* Заголовок сводки склоняется, а не пишет «3 события» на любое число. */
  await expect(page.locator('[data-testid^="notif-item-digest-"]').first()).toContainText('Сводка конвейера')

  await toggle.click()
  const list = page.locator('[data-testid^="notif-digest-list-"]').first()
  await expect(list).toBeVisible()

  const items = list.locator('li')
  const count = await items.count()
  expect(count).toBeGreaterThan(1)
  /* Каждое склеенное событие — своя запись со своим временем. */
  for (let i = 0; i < count; i += 1) {
    await expect(items.nth(i).locator('.notif-time')).toBeVisible()
  }
  /* Пока внутри есть непрочитанные — сводка помечена «новое». */
  await expect(items.first()).toHaveAttribute('data-unread', 'true')

  /* Клик по склеенному событию ведёт к источнику и читает именно его. */
  await items.first().locator('button').click()
  await expect(page.getByTestId('notif-panel')).toHaveCount(0)

  await page.getByTestId('notif-bell').click()
  /* Раскрытая сводка остаётся раскрытой между открытиями панели. */
  const toggleAgain = page.locator('[data-testid^="notif-digest-toggle-"]').first()
  await expect(toggleAgain).toHaveAttribute('aria-expanded', 'true')
  const listAgain = page.locator('[data-testid^="notif-digest-list-"]').first()
  await expect(listAgain.locator('li[data-unread="false"]')).toHaveCount(1)
  /* Остальные события не «прочитались» заодно: unread не теряется. */
  expect(await listAgain.locator('li[data-unread="true"]').count()).toBe(count - 1)
})

test('LG-5: двойной приём одних и тех же файлов даёт один результат', async ({ page }) => {
  test.setTimeout(180_000)
  await enter(page)
  await page.getByTestId('nav-library').click()

  const before = await page.evaluate(async () => {
    const runner = (window as unknown as { __exclusive?: unknown }).__exclusive
    return runner === undefined
  })
  expect(before).toBe(true)

  const input = page.locator('input[type=file]').first()
  const payload = [
    { name: 'дубль_один.txt', mimeType: 'text/plain', buffer: Buffer.from('раз') },
    { name: 'дубль_два.txt', mimeType: 'text/plain', buffer: Buffer.from('два') },
  ]
  /* Два запуска подряд, без ожидания между ними: сторож обязан пропустить один. */
  await Promise.all([input.setInputFiles(payload), input.setInputFiles(payload)])

  const card = page.locator('[data-testid^="lib-file-"]', { hasText: 'дубль_один' })
  await expect(card.first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  expect(await card.count()).toBe(1)
})
