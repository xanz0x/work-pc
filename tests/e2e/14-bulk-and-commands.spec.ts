import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { readDoc } from './idb'

/**
 * NF-5 (массовые действия) и NF-6 (командный центр).
 *
 * Ключевой критерий NF-5 — «операция над 500 объектами идёт с прогрессом и
 * не блокирует интерфейс». Поэтому корпус сеем сами: 500 файлов в профиль
 * до загрузки страницы, дальше проверяем настоящий прогресс, отмену на
 * границе порции и окно возврата.
 *
 * NF-6 — «не меньше 20 команд работают с клавиатуры из любого экрана»:
 * открываем палитру с чужого экрана, ходим стрелками, запускаем Enter.
 */

/** 500 файлов в профиль браузера: демо-корпус заменяется нагрузочным. */
async function seedFiles(page: import('@playwright/test').Page, n: number) {
  await page.addInitScript((count: number) => {
    try {
      const files = []
      for (let i = 0; i < count; i++) {
        files.push({
          id: `seed-${i}`,
          icon: 'doc',
          cluster: 'docs',
          name: `массив_${i}.pdf`,
          desc: 'Файл для проверки массовых операций',
          bytes: 200_000,
          date: 'сегодня',
          tags: ['нагрузка'],
          processing: false,
        })
      }
      localStorage.setItem('wf.files.v1', JSON.stringify(files))
    } catch {
      /* приватный режим — тест увидит демо-корпус */
    }
  }, n)
}

test('NF-5: 500 объектов — выбор всего фильтра, прогресс, отмена и возврат', async ({ page }) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await seedFiles(page, 500)
  await page.goto('/')

  await expect(page.getByTestId('lib-select-mode')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('nav-library')).toContainText('500')

  /* 1. Режим выбора: клик по карточке отмечает, а не открывает */
  await page.getByTestId('lib-select-mode').click()
  const firstCard = page.locator('[data-testid^="lib-file-"]').first()
  await firstCard.click()
  await expect(firstCard).toHaveAttribute('data-marked', '1')
  await expect(page.getByTestId('lib-bulk-count')).toContainText('1')

  /* 2. «Выбрать всё в фильтре» покрывает весь фильтр, а не страницу доски */
  await page.getByTestId('lib-bulk-select-all').click()
  await expect(page.getByTestId('lib-bulk-count')).toContainText('504')

  /* 3. Операция идёт с прогрессом и её можно прервать на границе порции */
  await page.getByTestId('lib-bulk-action-cluster').click()
  await page.getByTestId('lib-bulk-cluster-fin').click()
  const progress = page.getByTestId('lib-bulk-progress')
  await expect(progress).toBeVisible()
  await expect(progress).toContainText('из 500')
  /* Интерфейс жив: чужая кнопка отвечает во время операции */
  await page.getByTestId('nav-library-toggle').click()
  await page.getByTestId('lib-bulk-cancel').click()
  await expect(page.getByTestId('lib-bulk-cancelled')).toContainText('Операция прервана')

  /* 4. Окно возврата: «Вернуть» откатывает применённое */
  await expect(page.getByTestId('lib-bulk-undo')).toBeVisible()
  await page.getByTestId('lib-bulk-undo-run').click()
  await expect(page.getByTestId('lib-bulk-undo')).toHaveCount(0)

  /* 5. Метка на весь выбор доходит до карточек. Выделение после отмены
     осталось целиком (человек может повторить действие) — выбирать снова
     не нужно, кнопка «Выбрать всё в фильтре» честно неактивна. */
  await expect(page.getByTestId('lib-bulk-select-all')).toBeDisabled()
  await expect(page.getByTestId('lib-bulk-count')).toContainText('504')
  await page.getByTestId('lib-bulk-action-tag').click()
  await page.getByTestId('lib-bulk-tag-input').fill('нагрузка500')
  await page.getByTestId('lib-bulk-tag-apply').click()
  await expect(page.getByTestId('lib-bulk-undo')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-testid^="lib-file-"]').first()).toContainText('нагрузка500')
})

test('NF-5: Ctrl+клик и Shift+клик набирают выделение без режима выбора', async ({ page }) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await seedFiles(page, 30)
  await page.goto('/')
  await expect(page.getByTestId('lib-select-mode')).toBeVisible({ timeout: 30_000 })

  const cards = page.locator('[data-testid^="lib-file-"]')
  await cards.nth(0).click({ modifiers: ['Control'] })
  await expect(page.getByTestId('lib-bulk-count')).toContainText('1')
  await cards.nth(4).click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('lib-bulk-count')).toContainText('5')
  await page.getByTestId('lib-bulk-clear').click()
  await expect(page.getByTestId('lib-bulk-bar')).toHaveCount(0)
})

test('NF-6: палитра открывается с любого экрана, команд ≥20, Enter запускает', async ({ page }) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await page.goto('/')
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 30_000 })

  /* Уходим с библиотеки: команда обязана работать с чужого экрана */
  await page.getByTestId('nav-settings').click()

  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('cmdk')).toBeVisible()
  const commands = page.locator('[data-testid^="cmdk-cmd-"]')
  expect(await commands.count()).toBeGreaterThanOrEqual(20)

  /* Группы: действия, переходы, настройки */
  await expect(page.getByTestId('cmdk-group-h-action')).toBeVisible()
  await expect(page.getByTestId('cmdk-group-h-nav')).toBeVisible()
  await expect(page.getByTestId('cmdk-group-h-setting')).toBeVisible()

  /* Поиск по команде + запуск с клавиатуры: включается режим выбора в библиотеке */
  await page.getByTestId('cmdk-input').fill('массовое выделение')
  await expect(page.getByTestId('cmdk-cmd-library.select')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('cmdk')).toHaveCount(0)
  await expect(page.getByTestId('lib-select-mode')).toContainText('Выбор включён', { timeout: 30_000 })

  /* Первая группа при запросе — сущности сейфа, а не команды */
  await page.keyboard.press('Control+k')
  await page.getByTestId('cmdk-input').fill('договор')
  await expect(page.getByTestId('cmdk-group-h-hits')).toBeVisible()
  await expect(page.locator('[data-testid^="cmdk-hit-"]').first()).toBeVisible()

  /* Недоступная по контексту команда честно объясняется */
  await page.getByTestId('cmdk-input').fill('новая запись секрета')
  const secretCmd = page.getByTestId('cmdk-cmd-vault.new')
  await expect(secretCmd).toBeVisible()
  await expect(secretCmd).toContainText('Недоступно')

  /* Стрелки ходят по списку, Esc закрывает */
  await page.getByTestId('cmdk-input').fill('')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cmdk')).toHaveCount(0)
})

test('NF-5: массовые действия в менеджере секретов — метка, корзина, возврат', async ({ page }) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await page.goto('/')

  /* Замок: без мастер-ключа модуль секретов ничего не расшифровывает */
  await page.getByTestId('nav-settings').click()
  await page.getByRole('button', { name: 'Настроить мастер-ключ' }).click()
  await page.getByRole('radio', { name: 'Пароль' }).click()
  await page.getByPlaceholder('от 8 символов').fill('e2e-master-2026')
  await page.getByPlaceholder('Повторите').fill('e2e-master-2026')
  await page.getByRole('button', { name: 'Включить замок' }).click()
  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('nav-vault').click()
  await expect(page.getByTestId('screen-vault')).toBeVisible()

  /* Три записи, чтобы выделять было что */
  for (const name of ['bulk-один', 'bulk-два', 'bulk-три']) {
    await page.getByTestId('vault-new').click()
    await page.getByTestId('editor-title').fill(name)
    await page.getByTestId('editor-save').click()
    await expect(page.getByTestId('vault-list').getByText(name)).toBeVisible({ timeout: 30_000 })
  }

  /* Режим выбора и «выбрать всё в фильтре» */
  await page.getByTestId('vault-select-mode').click()
  await page.locator('[data-testid^="vault-card-"]').first().click()
  await expect(page.getByTestId('vault-bulk-count')).toContainText('1')
  await page.getByTestId('vault-bulk-select-all').click()
  await expect(page.getByTestId('vault-bulk-count')).toContainText('3')

  /* Метка на все три записи */
  await page.getByTestId('vault-bulk-action-tag').click()
  await page.getByTestId('vault-bulk-tag-input').fill('оптом')
  await page.getByTestId('vault-bulk-tag-apply').click()
  await expect(page.getByTestId('vault-bulk-undo')).toBeVisible({ timeout: 30_000 })

  /* В корзину и возврат из окна отмены */
  await page.getByTestId('vault-select-mode').click()
  await page.getByTestId('vault-select-mode').click()
  await page.locator('[data-testid^="vault-card-"]').first().click()
  await page.getByTestId('vault-bulk-select-all').click()
  await page.getByTestId('vault-bulk-action-trash').click()
  await expect(page.getByTestId('vault-list-empty')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('vault-bulk-undo-run').click()
  await expect(page.locator('[data-testid^="vault-card-"]')).toHaveCount(3, { timeout: 30_000 })
})

test('NF-5: массовый перенос записей в папку', async ({ page }) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await page.goto('/')

  await page.getByTestId('nav-settings').click()
  await page.getByRole('button', { name: 'Настроить мастер-ключ' }).click()
  await page.getByRole('radio', { name: 'Пароль' }).click()
  await page.getByPlaceholder('от 8 символов').fill('e2e-master-2026')
  await page.getByPlaceholder('Повторите').fill('e2e-master-2026')
  await page.getByRole('button', { name: 'Включить замок' }).click()
  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('nav-vault').click()
  await expect(page.getByTestId('screen-vault')).toBeVisible()

  /* Папка и две записи */
  await page.getByTestId('vault-folder-add').click()
  await page.getByTestId('vault-folder-name').fill('Работа')
  await page.getByTestId('vault-folder-name').press('Enter')
  const folderNav = page.locator('[data-testid^="vault-view-folder-"]').first()
  await expect(folderNav).toBeVisible()

  await page.getByTestId('vault-view-all').click()
  for (const name of ['папка-один', 'папка-два']) {
    await page.getByTestId('vault-new').click()
    await page.getByTestId('editor-title').fill(name)
    await page.getByTestId('editor-save').click()
    await expect(page.getByTestId('vault-list').getByText(name)).toBeVisible({ timeout: 30_000 })
  }

  /* Массовый перенос: обе записи уезжают в папку */
  await page.getByTestId('vault-select-mode').click()
  await page.locator('[data-testid^="vault-card-"]').first().click()
  await page.getByTestId('vault-bulk-select-all').click()
  await expect(page.getByTestId('vault-bulk-count')).toContainText('2')
  await page.getByTestId('vault-bulk-action-folder').click()
  await page.locator('[data-testid^="vault-bulk-folder-fol"]').first().click()
  await expect(page.getByTestId('vault-bulk-undo')).toBeVisible({ timeout: 30_000 })

  await folderNav.click()
  await expect(page.locator('[data-testid^="vault-card-"]')).toHaveCount(2, { timeout: 30_000 })
})

test('NF-5: файловый ключ на группу файлов', async ({ page }) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await page.goto('/')

  /* Файловый ключ существует только поверх мастер-ключа */
  await page.getByTestId('nav-settings').click()
  await page.getByRole('button', { name: 'Настроить мастер-ключ' }).click()
  await page.getByRole('radio', { name: 'Пароль' }).click()
  await page.getByPlaceholder('от 8 символов').fill('e2e-master-2026')
  await page.getByPlaceholder('Повторите').fill('e2e-master-2026')
  await page.getByRole('button', { name: 'Включить замок' }).click()
  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('nav-library').click()
  await expect(page.getByTestId('lib-select-mode')).toBeVisible({ timeout: 30_000 })

  /* Три файла из демо-корпуса под один ключ */
  await page.getByTestId('lib-select-mode').click()
  const cards = page.locator('[data-testid^="lib-file-"]')
  for (const i of [0, 1, 2]) await cards.nth(i).click()
  await expect(page.getByTestId('lib-bulk-count')).toContainText('3')

  await page.getByTestId('lib-bulk-action-key').click()
  await page.getByTestId('lib-bulk-key1').fill('e2e-bulk-key-2026')
  await page.getByTestId('lib-bulk-key2').fill('e2e-bulk-key-2026')
  await page.getByTestId('lib-bulk-key-apply').click()

  /* Обёртки легли в словарь IndexedDB — по одной на файл */
  const map = await readDoc<Record<string, unknown>>(page, 'wf.filekeys.map.v1')
  for (let i = 0; i < 40 && Object.keys(map ?? {}).length < 3; i += 1) {
    await page.waitForTimeout(250)
  }
  const fresh = await readDoc<Record<string, unknown>>(page, 'wf.filekeys.map.v1')
  expect(Object.keys(fresh ?? {}).length).toBeGreaterThanOrEqual(3)

  /* Карточки честно говорят «под ключом», а открытие просит ключ */
  await expect(page.locator('.fk-badge').first()).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('lib-select-mode').click()
  await page.locator('[data-testid^="lib-file-"]').filter({ has: page.locator('.fk-badge') }).first().click()
  await expect(page.getByTestId('fk-ask-modal')).toBeVisible({ timeout: 20_000 })
})

test('NF-6: клавиатура палитры не теряет нажатия и работает вне поля ввода', async ({ page }) => {
  test.setTimeout(120_000)
  await skipOnboarding(page)
  await page.goto('/')
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-app-ready', '1', { timeout: 30_000 })

  /* 1. Esc сразу после Ctrl+K: фокус в поле обязан быть в том же кадре */
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('cmdk')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('cmdk')).toHaveCount(0)
  }

  /* 2. Первые буквы не теряются */
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('cmdk-input')).toBeFocused()
  await page.getByTestId('cmdk-input').fill('')
  await page.keyboard.type('карта')
  await expect(page.getByTestId('cmdk-input')).toHaveValue('карта')

  /* 3. Фокус ушёл на чип области — Esc и стрелки всё равно работают */
  await page.locator('.cmdk-scope').nth(1).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cmdk')).toHaveCount(0)
})
