import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'

/**
 * NF-3 Центр активности: экран показывает живые плитки и агрегирует журнал
 * + уведомления. Проверяем ключевые сценарии — пункт сайдбара, 4 плитки,
 * фильтры, экспорт, deep-link по строке журнала, метка «необратимо» и
 * что журнал в настройках при этом не сломан.
 */
test('центр активности: сайдбар, плитки, агрегация журнала (severe) и фильтры', async ({ page }) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await page.goto('/')

  /* 1. Сайдбар: пункт есть, клик открывает экран */
  const navActivity = page.getByTestId('nav-activity')
  await expect(navActivity).toBeVisible({ timeout: 30_000 })
  await navActivity.click()
  await expect(page.getByTestId('screen-activity')).toBeVisible()

  /* 2. Живая полоса «Сейчас»: 4 плитки и пилюля */
  await expect(page.getByTestId('activity-now')).toBeVisible()
  for (const key of ['index', 'engine', 'traffic', 'lock']) {
    await expect(page.getByTestId(`activity-tile-${key}`)).toBeVisible()
  }
  await expect(page.getByTestId('activity-live-pill')).toBeVisible()

  /* 3. Лента и счётчик */
  await expect(page.getByTestId('activity-feed')).toBeVisible()
  const countInitial = await page.getByTestId('activity-count').textContent()
  console.log('activity-count initial:', countInitial)

  /* Экспорт отключён, если лента пуста */
  const exportBtn = page.getByTestId('activity-export')
  const rowsInitial = await page.getByTestId('activity-row').count()
  if (rowsInitial === 0) {
    await expect(exportBtn).toBeDisabled()
  }

  /* 4. Сгенерировать severe-событие журнала: стереть сейф в настройках */
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('journal-section')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Удалить сейф' }).click()
  await page.getByRole('button', { name: 'Да, стереть' }).click()
  await expect(page.getByTestId('journal-row')).toHaveCount(1, { timeout: 15_000 })

  /* 5. Возврат в Центр активности и проверка агрегации */
  await page.getByTestId('nav-activity').click()
  await expect(page.getByTestId('screen-activity')).toBeVisible()

  /* Должна быть хотя бы одна строка-журнал с severe-флажком */
  const journalBadge = page.locator('[data-testid="activity-row"] .act-badge', { hasText: 'Журнал' })
  await expect(journalBadge.first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('activity-severe-flag').first()).toBeVisible()

  /* Чип severe появился */
  const severeChip = page.getByTestId('activity-filter-severe')
  await expect(severeChip).toBeVisible()

  /* Экспорт теперь активен */
  await expect(exportBtn).toBeEnabled()

  /* 6. Фильтр по типу journal — оставляет только записи журнала */
  await page.getByTestId('activity-filter-journal').click()
  const rowsJ = page.getByTestId('activity-row')
  const nJ = await rowsJ.count()
  expect(nJ).toBeGreaterThan(0)
  for (let i = 0; i < nJ; i++) {
    await expect(rowsJ.nth(i).locator('.act-badge')).toHaveText('Журнал')
  }

  /* 7. Фильтр severe — все строки должны иметь флажок «необратимо» */
  await severeChip.click()
  const rowsS = page.getByTestId('activity-row')
  const nS = await rowsS.count()
  expect(nS).toBeGreaterThan(0)
  await expect(page.getByTestId('activity-severe-flag')).toHaveCount(nS)

  /* Возврат к «Все» */
  await page.getByTestId('activity-filter-all').click()

  /* 8. Фильтр по периоду «Сегодня» — свежая запись остаётся */
  await page.locator('.act-dd').first().click()
  await page.getByText('Сегодня', { exact: true }).click()
  await expect(page.getByTestId('activity-row').first()).toBeVisible()

  /* 9. Экспорт скачивает JSON */
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    exportBtn.click(),
  ])
  expect(dl.suggestedFilename()).toMatch(/^workflow-activity-.*\.json$/)

  /* 10. Deep-link: клик по строке журнала ведёт в Настройки, подсвечивает запись */
  await page.getByTestId('activity-filter-journal').click()
  await page.getByTestId('activity-row').first().click()
  await expect(page.getByTestId('journal-section')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.jr-row.focused')).toHaveCount(1, { timeout: 10_000 })

  /* 11. Регрессия: журнал в настройках не сломан */
  await expect(page.getByTestId('journal-row')).toHaveCount(1)
})
