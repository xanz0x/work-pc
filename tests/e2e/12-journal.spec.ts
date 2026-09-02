import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'

/**
 * Сценарий 12 (LG-3): журнал безопасности. Критическое действие попадает в
 * append-only ленту, уведомление ведёт на конкретную запись, работают фильтр
 * и выгрузка, а очистка ленты уведомлений журнал не задевает.
 */
test('журнал: стирание сейфа записано, уведомление ведёт на запись, фильтр и выгрузка работают', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await page.goto('/')

  await page.getByTestId('nav-settings').click()
  const journal = page.getByTestId('journal-section')
  await expect(journal).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('journal-empty')).toBeVisible()

  /* Стираем сейф — самое дорогое действие, оно обязано остаться в журнале. */
  await page.getByRole('button', { name: 'Удалить сейф' }).click()
  await page.getByRole('button', { name: 'Да, стереть' }).click()

  const rows = page.getByTestId('journal-row')
  await expect(rows).toHaveCount(1, { timeout: 15_000 })
  await expect(rows.first()).toHaveAttribute('data-kind', 'vault-wipe')
  await expect(page.getByTestId('journal-count')).toContainText('1')

  /* Уведомление об этом действии ведёт на запись журнала и подсвечивает её. */
  await page.getByTestId('notif-bell').click()
  const item = page.locator('[data-testid^="notif-open-"]').first()
  await expect(item).toBeVisible()
  await item.click()
  await expect(page.locator('.jr-row.focused')).toHaveCount(1, { timeout: 15_000 })

  /* Фильтр по типу: чужой тип прячет запись, «Все» возвращает. */
  await page.getByTestId('journal-filter-vault-wipe').click()
  await expect(rows).toHaveCount(1)
  await page.getByTestId('journal-filter-all').click()
  await expect(rows).toHaveCount(1)

  /* Необратимое видно отдельно: пометка на строке, свой фильтр и метка в
     статус-баре, которая ведёт прямо в журнал. */
  await expect(page.getByTestId('journal-severe-flag').first()).toBeVisible()
  await page.getByTestId('journal-filter-severe').click()
  await expect(rows).toHaveCount(1)
  const alert = page.getByTestId('status-journal-alert')
  await expect(alert).toContainText('ЖУРНАЛ · 1')
  await page.getByTestId('nav-library').click()
  await expect(page.getByTestId('journal-section')).toHaveCount(0)
  await alert.click()
  await expect(page.getByTestId('journal-section')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('journal-row')).toHaveCount(1)

  /* Выгрузка отдаёт файл и ничего не удаляет. */
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('journal-export').click(),
  ])
  expect(dl.suggestedFilename()).toMatch(/^workflow-journal-.*\.json$/)
  await expect(rows).toHaveCount(1)

  /* Очистка ленты уведомлений журнал не задевает: у него нет кнопок очистки. */
  await page.getByTestId('notif-bell').click()
  const clearAll = page.getByTestId('notif-clear-all')
  if (await clearAll.isVisible().catch(() => false)) await clearAll.click()
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(1)

  /* Запись переживает перезагрузку — она в отдельном сторе базы. */
  await page.reload()
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('journal-row')).toHaveCount(1, { timeout: 30_000 })
})
