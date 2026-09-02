import { expect, test } from '@playwright/test'
import { readDoc } from './idb'
import { skipOnboarding } from './onboard'

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

/** Посев старого профиля. Init-script выполняется и при reload, поэтому
 *  сеем один раз за сессию: иначе бэкап пересевался бы и «уборка на втором
 *  запуске» давала ложный провал. */
async function seedOldProfile(page: import('@playwright/test').Page) {
  await skipOnboarding(page)
  await page.addInitScript(
    ({ file, note }) => {
      if (sessionStorage.getItem('wf.e2e.seeded') === '1') return
      sessionStorage.setItem('wf.e2e.seeded', '1')
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
}

test('миграция: «старый» localStorage-профиль переезжает в IndexedDB', async ({ page }) => {
  await seedOldProfile(page)

  await page.goto('/')
  await page.getByTestId('nav-library').click()

  /* 1. Данные из старого профиля видны на экране. */
  await expect(page.getByText(OLD_FILE.name, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  })

  /* 2. Копия оказалась в IndexedDB. */
  await expect
    .poll(
      async () => {
        const files = await readDoc<{ id: string }[]>(page, 'wf.files.v1')
        return files?.some((f) => f.id === 'legacy-1') ?? false
      },
      { timeout: 20_000 },
    )
    .toBe(true)

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

/**
 * Порядок миграции при входе через страницу входа (замечание QA к §1.3).
 * `VaultProvider` живёт в корневом layout, поэтому storageReady() и
 * migrateLocalStorage() выполняются и на `/login`. Это ожидаемое поведение:
 * «первый запуск» — первая загрузка ЛЮБОЙ страницы приложения. Значит после
 * входа страница `/` — уже второй запуск, и бэкап к этому моменту убран, а
 * данные обязаны быть на экране и в базе.
 */
test('миграция при входе через /login: первый запуск — сама страница входа', async ({ page }) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  await seedOldProfile(page)

  await page.goto('/login')
  /* Первая загрузка (страница входа) — копия уже сделана, бэкап ещё на месте. */
  await expect
    .poll(
      async () => {
        const files = await readDoc<{ id: string }[]>(page, 'wf.files.v1')
        return files?.some((f) => f.id === OLD_FILE.id) ?? false
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('wf.files.v1'))).not.toBeNull()

  await page.getByTestId('login-password').fill(process.env.APP_PASSWORD as string)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })

  /* Второй запуск (уже сама библиотека): данные на экране, бэкап убран. */
  await page.getByTestId('nav-library').click()
  await expect(page.getByText(OLD_FILE.name, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  })
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('wf.files.v1')), {
      timeout: 20_000,
    })
    .toBeNull()
  await expect(page.evaluate(() => localStorage.getItem('wf.lock.config'))).resolves.not.toBeNull()
})
