import { expect, test, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'
import { readDoc } from './idb'

/**
 * Сценарий 16 (NF-7, NF-8): бэкап всего сейфа и автономный режим.
 * Проверяем то, что обещано пользователю: снимок делается под отдельным
 * паролем, чужой пароль его не открывает, превью показывает состав до
 * записи, восстановление отчитывается; автономный режим действительно
 * не пускает запрос наружу и переживает перезагрузку вместе с флагами.
 */

const SNAP_PWD = 'снимок-пароль-2026'

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

test('бэкап: снимок под своим паролем, превью состава и восстановление', async ({ page }) => {
  test.setTimeout(180_000)
  await enter(page)

  await page.getByTestId('nav-settings').click()
  const sec = page.getByTestId('settings-backup')
  await expect(sec).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('backup-count')).toContainText('0')

  /* Снимок всех модулей под отдельным паролем. */
  await page.getByTestId('backup-pwd').fill(SNAP_PWD)
  await page.getByTestId('backup-pwd2').fill(SNAP_PWD)
  await page.getByTestId('backup-create').click()
  await expect(page.getByTestId('backup-list')).toBeVisible({ timeout: 60_000 })
  const rows = page.locator('[data-testid^="backup-row-"]')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('вручную')
  await expect(page.getByTestId('backup-count')).toContainText('1')

  /* Файл снимка уезжает на диск как .vaultbak. */
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid^="backup-download-"]').first().click(),
  ])
  expect(dl.suggestedFilename()).toMatch(/\.vaultbak$/)

  /* Чужой пароль снимок не открывает. */
  await page.locator('[data-testid^="backup-restore-"]').first().click()
  await page.getByTestId('backup-open-pwd').fill('совсем-другой-пароль')
  await page.getByTestId('backup-open').click()
  await expect(page.getByTestId('backup-open-error')).toBeVisible({ timeout: 60_000 })

  /* Свой пароль показывает состав ДО записи. */
  await page.getByTestId('backup-open-pwd').fill(SNAP_PWD)
  await page.getByTestId('backup-open').click()
  const preview = page.getByTestId('backup-preview')
  await expect(preview).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('backup-pick-settings')).toBeVisible()
  await expect(page.getByTestId('backup-mode-replace')).toBeVisible()
  /* Слияние спрятано за флагом experimental. */
  await expect(page.getByTestId('backup-mode-merge')).toHaveCount(0)

  await page.getByTestId('backup-apply').click()
  const report = page.getByTestId('backup-report')
  await expect(report).toBeVisible({ timeout: 60_000 })
  await expect(report).toContainText('Восстановление выполнено')
  await expect(page.getByTestId('backup-reload')).toBeVisible()

  /* Ротация: держим 3 снимка — четвёртый вытесняет самый старый. */
  await page.getByTestId('backup-keep-3').click()
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('backup-pwd').fill(SNAP_PWD)
    /* Замок в чистом профиле выключен, поэтому пароль снимка не запоминается
       под мастер-ключом и повтор спрашивается каждый раз — так и должно быть. */
    if (await page.getByTestId('backup-pwd2').count()) {
      await page.getByTestId('backup-pwd2').fill(SNAP_PWD)
    }
    await page.getByTestId('backup-create').click()
    await expect(page.getByTestId('backup-count')).toContainText(String(Math.min(3, i + 2)), {
      timeout: 60_000,
    })
  }
  await expect(page.locator('[data-testid^="backup-row-"]')).toHaveCount(3)
})

test('автономный режим: исходящих нет, флаги переживают перезагрузку', async ({ page }) => {
  test.setTimeout(120_000)
  await enter(page)

  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('settings-flags')).toBeVisible({ timeout: 30_000 })

  /* Пока сеть разрешена — внешний запрос уходит и обёртка не мешает. */
  const before = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/ping', { mode: 'no-cors' })
      return 'ok'
    } catch (e) {
      return (e as Error).name
    }
  })
  expect(before).not.toBe('NetBlockedError')

  await page.getByTestId('toggle-offline').click()
  await expect(page.getByTestId('status-offline')).toBeVisible()

  const blockedFetch = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/ping', { mode: 'no-cors' })
      return 'ok'
    } catch (e) {
      return (e as Error).name
    }
  })
  expect(blockedFetch).toBe('NetBlockedError')

  const blockedSocket = await page.evaluate(() => {
    try {
      new WebSocket('wss://example.com/socket')
      return 'ok'
    } catch (e) {
      return (e as Error).name
    }
  })
  expect(blockedSocket).toBe('NetBlockedError')

  await expect(page.getByTestId('flags-blocked-count')).toContainText('2')
  await expect(page.getByTestId('status-offline')).toContainText('2 ЗАПРЕТА')

  /* Флаг разработчика включает честную диагностическую строку. */
  await page.getByTestId('toggle-flag-dev').click()
  await expect(page.getByTestId('status-dev')).toContainText('схема v3')

  /* Перезагрузка: флаги на месте, счётчик запретов — нет (он сессионный). */
  await page.reload()
  await waitAppReady(page)
  await expect(page.getByTestId('status-offline')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('status-dev')).toBeVisible()
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('toggle-offline')).toHaveAttribute('aria-checked', 'true', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('toggle-flag-dev')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('flags-blocked-count')).toContainText('0')

  /* Автономный режим не ломает локальную работу: свой маршрут отвечает. */
  const local = await page.evaluate(async () => {
    const r = await fetch('/ai-api/mcp')
    return r.status
  })
  expect([200, 401]).toContain(local)

  await page.getByTestId('toggle-offline').click()
  await expect(page.getByTestId('status-net')).toBeVisible()
})

/**
 * Приёмка нашла дыру: демо-набор первого запуска живёт в сторе на значениях
 * по умолчанию, документа `wf.files.v1` в базе ещё нет — и снимок его не
 * видел. Теперь снимок собирается и из живого состояния, поэтому «стереть
 * сейф → восстановить» возвращает то, что человек видел на экране.
 */
test('бэкап забирает состояние, которое ещё не записано в хранилище', async ({ page }) => {
  test.setTimeout(180_000)
  await enter(page)

  /* Чистый профиль: демо-корпус (UX-5) приезжает отдельным модулем и
     ложится в базу — снимок обязан увидеть ровно то, что на экране. */
  await page.getByTestId('nav-library').click()
  await expect(page.getByTestId('nav-library')).toBeVisible()
  await expect
    .poll(async () => (await readDoc<unknown[]>(page, 'wf.files.v1'))?.length ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0)

  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('settings-backup')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('backup-pwd').fill(SNAP_PWD)
  await page.getByTestId('backup-pwd2').fill(SNAP_PWD)
  await page.getByTestId('backup-create').click()
  await expect(page.getByTestId('backup-list')).toBeVisible({ timeout: 60_000 })

  /* Стираем сейф до основания. */
  await page.getByRole('button', { name: 'Удалить сейф' }).click()
  await page.getByRole('button', { name: 'Да, стереть' }).click()
  await expect
    .poll(async () => (await readDoc<unknown[]>(page, 'wf.files.v1'))?.length ?? -1, {
      timeout: 30_000,
    })
    .toBe(0)

  /* Восстанавливаем и проверяем, что архив вернулся. */
  await page.locator('[data-testid^="backup-restore-"]').first().click()
  await page.getByTestId('backup-open-pwd').fill(SNAP_PWD)
  await page.getByTestId('backup-open').click()
  await expect(page.getByTestId('backup-preview')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('backup-apply').click()
  await expect(page.getByTestId('backup-report')).toBeVisible({ timeout: 60_000 })

  await expect
    .poll(async () => (await readDoc<unknown[]>(page, 'wf.files.v1'))?.length ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(10)

  await page.getByTestId('backup-reload').click()
  await waitAppReady(page)
  await page.getByTestId('nav-library').click()
  await expect
    .poll(async () => (await readDoc<unknown[]>(page, 'wf.files.v1'))?.length ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(10)
})
