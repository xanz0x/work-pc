import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'

/** Сценарий 5: уведомления — прочитано, архив, восстановление. */
test('уведомления: read/unread и архив', async ({ page }) => {
  await skipOnboarding(page)
  await page.goto('/')

  // Событие в ленте появляется от приёма файла — не полагаемся на демо-данные.
  await page.getByTestId('file-picker').setInputFiles({
    name: `e2e-notif-${Date.now()}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e'),
  })

  await page.getByTestId('notif-bell').click()
  const panel = page.getByTestId('notif-panel')
  await expect(panel).toBeVisible()

  const markAll = page.getByTestId('notif-mark-all')
  if (await markAll.isVisible().catch(() => false)) {
    /* Индексация присылает своё событие асинхронно: без ожидания «прочитать
       всё» срабатывает до него и бейдж честно возвращается с единицей. */
    await expect(panel.getByText('Индексация завершена').first()).toBeVisible({ timeout: 30_000 })
    await markAll.click()
    await expect(page.getByTestId('notif-badge')).toBeHidden()
  }

  const archive = panel.locator('[data-testid^="notif-archive-"]').first()
  if (await archive.isVisible().catch(() => false)) {
    await archive.click()
    await page.getByTestId('notif-filter-archive').click()
    await expect(panel.locator('[data-testid^="notif-restore-"]').first()).toBeVisible()
  }
})
