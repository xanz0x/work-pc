import { expect, test } from '@playwright/test'

/**
 * Сценарий 6 (§1.3 хвоста волны 2): переезд «старого» профиля.
 * Настоящие пользователи придут с заполненным localStorage, а тесты до сих
 * пор видели только чистый профиль с IndexedDB. Здесь профиль набивается
 * до открытия страницы и проверяется весь путь: данные на экране, копия в
 * базе, бэкап в localStorage на первом запуске и его уборка на втором.
 */

const OLD_FILE = {
  id: 'legacy-1',
  icon: 'doc',
  cluster: 'docs',
  name: 'наследие_из_localstorage.pdf',
  desc: 'Файл из старого профиля: должен доехать до IndexedDB',
  bytes: 1_234_567,
  date: '01 янв',
  pages: 3,
  tags: ['документы'],
}

const OLD_NOTE = {
  id: 'legacy-note-1',
  pinnedTo: 'legacy-1',
  text: 'Стикер из старого профиля',
  locked: false,
  secret: null,
  createdAt: 1_700_000_000_000,
  color: 'amber',
}

test('миграция: «старый» localStorage-профиль переезжает в IndexedDB', async ({ page }) => {
  await page.addInitScript(
    ({ file, note }) => {
      localStorage.setItem('wf.files.v1', JSON.stringify([file]))
      localStorage.setItem('wf.notes.v1', JSON.stringify([note]))
      localStorage.setItem('wf.chat.v1', JSON.stringify([]))
      localStorage.setItem('wf.notifs.v1', JSON.stringify([]))
      localStorage.setItem(
        'wf.lock.config',
        JSON.stringify({ enabled: false, method: 'password', autoLockMin: 5, createdAt: 1 }),
      )
    },
    { file: OLD_FILE, note: OLD_NOTE },
  )

  await page.goto('/')
  await page.getByTestId('nav-library').click()

  /* 1. Данные из старого профиля видны на экране. */
  await expect(page.getByText(OLD_FILE.name, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  })

  /* 2. Копия оказалась в IndexedDB. */
  const inDb = await page.evaluate(async () => {
    const read = () =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('workflow')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('docs', 'readonly')
          const req = tx.objectStore('docs').get('wf.files.v1')
          req.onsuccess = () => resolve(req.result ?? null)
          req.onerror = () => resolve(null)
        }
        open.onerror = () => resolve(null)
      })
    for (let i = 0; i < 40; i += 1) {
      const rec = (await read()) as { value?: { id: string }[] } | null
      if (rec?.value?.some((f) => f.id === 'legacy-1')) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  })
  expect(inDb, 'копия файла обязана появиться в IndexedDB').toBe(true)

  /* 3. Первый запуск ничего не удаляет: localStorage остаётся бэкапом. */
  const backupAfterFirst = await page.evaluate(() => localStorage.getItem('wf.files.v1'))
  expect(backupAfterFirst, 'на первом запуске бэкап обязан остаться').not.toBeNull()

  /* 4. Второй запуск: бэкап убран, данные по-прежнему на экране. */
  await page.reload()
  await page.getByTestId('nav-library').click()
  await expect(page.getByText(OLD_FILE.name, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  })
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('wf.files.v1')), {
      timeout: 20_000,
    })
    .toBeNull()

  /* Конфиг замка синхронный — он обязан остаться в localStorage. */
  await expect(page.evaluate(() => localStorage.getItem('wf.lock.config'))).resolves.not.toBeNull()
})
