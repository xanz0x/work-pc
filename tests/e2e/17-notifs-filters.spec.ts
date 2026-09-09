import { expect, test, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Сценарий 17 (UX-3): фильтры панели событий.
 * Проверяем обещания раздела: выбранный фильтр запоминается между
 * открытиями и перезагрузками, счётчики на чипах совпадают с бейджем
 * колокольчика, выключенная категория помечена точкой с подсказкой,
 * а на 380 px панель остаётся в экране и переходит в компактный вид.
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

const num = async (page: Page, testid: string): Promise<number> => {
  const el = page.getByTestId(testid)
  if ((await el.count()) === 0) return 0
  const text = (await el.first().innerText()).replace(/\D+/g, '')
  return text === '' ? 0 : Number(text)
}

test('фильтр запоминается между открытиями и перезагрузками', async ({ page }) => {
  test.setTimeout(120_000)
  await enter(page)

  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-panel')).toBeVisible()
  await expect(page.getByTestId('notif-filter-all')).toHaveAttribute('aria-selected', 'true')

  await page.getByTestId('notif-filter-privacy').click()
  await expect(page.getByTestId('notif-filter-privacy')).toHaveAttribute('aria-selected', 'true')

  /* Закрыли и открыли снова — фильтр остался. */
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('notif-panel')).toHaveCount(0)
  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-filter-privacy')).toHaveAttribute('aria-selected', 'true')

  /* Перезагрузка — тоже остался. */
  await page.reload()
  await waitAppReady(page)
  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-filter-privacy')).toHaveAttribute('aria-selected', 'true')

  /* Архив запоминается так же — это тот же ключ. */
  await page.getByTestId('notif-filter-archive').click()
  await page.reload()
  await waitAppReady(page)
  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-filter-archive')).toHaveAttribute('aria-selected', 'true')
})

test('счётчики чипов совпадают с бейджем колокольчика', async ({ page }) => {
  test.setTimeout(120_000)
  await enter(page)

  const badge0 = await num(page, 'notif-badge')
  await expect.poll(async () => await num(page, 'notif-badge'), { timeout: 30_000 }).toBeGreaterThan(0)
  const badge = badge0 > 0 ? badge0 : await num(page, 'notif-badge')
  expect(badge).toBeGreaterThan(0)

  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-panel')).toBeVisible()

  /* «Все», «Новые» и сумма категорий обязаны сойтись с бейджем. */
  const all = await num(page, 'notif-filter-all')
  const unread = await num(page, 'notif-filter-unread')
  const cats =
    (await num(page, 'notif-filter-pipeline')) +
    (await num(page, 'notif-filter-privacy')) +
    (await num(page, 'notif-filter-system'))
  expect(all).toBe(badge)
  expect(unread).toBe(badge)
  expect(cats).toBe(badge)
  await expect(page.getByTestId('notif-head-count')).toContainText(String(badge))

  /* Отложенное уходит и из ленты, и из бейджа: цифра не врёт. */
  const first = page.locator('[data-testid^="notif-snooze-"]').first()
  await first.click()
  await expect
    .poll(async () => await num(page, 'notif-badge'), { timeout: 15_000 })
    .toBe(badge - 1)
  expect(await num(page, 'notif-filter-all')).toBe(badge - 1)
  await expect(page.getByTestId('notif-foot-note')).toContainText('Отложено: 1')
})

test('выключенная категория помечена точкой с подсказкой', async ({ page }) => {
  test.setTimeout(120_000)
  await enter(page)

  await page.getByTestId('notif-bell').click()
  await expect(page.getByTestId('notif-off-privacy')).toHaveCount(0)

  /* Выключаем категорию из самого уведомления приватности. */
  await page.getByTestId('notif-filter-privacy').click()
  const mute = page.locator('[data-testid^="notif-mute-"]').first()
  if ((await mute.count()) === 0) {
    /* В демо-профиле события приватности нет — гасим категорию в настройках.
       Тумблеры там черновые: без «Сохранить» настройка не применяется. */
    await page.keyboard.press('Escape')
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('toggle-ntfPrivacy').click()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByTestId('notif-bell').click()
  } else {
    await mute.click()
  }

  const dot = page.getByTestId('notif-off-privacy')
  await expect(dot).toBeVisible({ timeout: 15_000 })
  await expect(dot).toHaveAttribute('title', /Категория выключена в настройках/)
  await expect(dot).toHaveAttribute('aria-label', /категория выключена/)
  await expect(page.getByTestId('notif-filter-privacy')).toHaveClass(/muted/)
})

test('на 380 px панель компактная и не выходит за экран', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 380, height: 820 })
  await enter(page)

  await page.getByTestId('notif-bell').click()
  const panel = page.getByTestId('notif-panel')
  await expect(panel).toBeVisible()

  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeLessThanOrEqual(380)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(381)

  /* Компактный вид: подписи фильтров короткие, строка не переносится. */
  await expect(page.getByTestId('notif-filter-pipeline')).toContainText('Конв.')
  const tabs = page.locator('.notif-tabs')
  const tabsBox = await tabs.boundingBox()
  expect(tabsBox!.height).toBeLessThan(50)
})
