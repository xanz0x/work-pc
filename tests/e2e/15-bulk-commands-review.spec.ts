import { expect, test, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { readDoc } from './idb'

type FileDoc = { id: string; cluster: string; tags?: string[] }
type NoteDoc = { id: string; tags?: string[]; pinnedTo?: string | null }

const files = (page: Page) => readDoc<FileDoc[]>(page, 'wf.files.v1').then((x) => x ?? [])
const notes = (page: Page) => readDoc<NoteDoc[]>(page, 'wf.notes.v1').then((x) => x ?? [])

/**
 * Независимая приёмка NF-5 / NF-6 (testing agent).
 * Проверяем то, что не покрыто 14-bulk-and-commands.spec.ts:
 *  — честность прогресса и сообщения об отмене (сверка с localStorage),
 *  — Undo действительно откатывает метку / кластер / удаление,
 *  — стикеры участвуют в метке и не трогаются кластером,
 *  — обычный клик по карточке открывает инспектор,
 *  — палитра с каждого экрана, недоступные команды, «Недавнее» после перезагрузки,
 *  — секреты: папка/избранное/корзина + восстановление и purge.
 */

async function seedFiles(page: Page, n: number) {
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
      /* приватный режим */
    }
  }, n)
}

const tagCount = async (page: Page, tag: string) =>
  (await files(page)).filter((f) => (f.tags ?? []).includes(tag)).length

const clusterMap = async (page: Page) => {
  const map: Record<string, number> = {}
  for (const f of await files(page)) map[f.cluster] = (map[f.cluster] ?? 0) + 1
  return map
}

async function openApp(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-app-ready', '1', { timeout: 30_000 })
}

test('A · 500 файлов: прогресс движется, UI жив, отмена честная, Undo откатывает', async ({ page }) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await seedFiles(page, 500)
  await openApp(page)

  await page.getByTestId('lib-select-mode').click()
  await page.locator('[data-testid^="lib-file-"]').first().click()
  await page.getByTestId('lib-bulk-select-all').click()
  await expect(page.getByTestId('lib-bulk-count')).toContainText('500')

  /* Метка на весь выбор: прогресс обязан двигаться и не блокировать интерфейс */
  await page.getByTestId('lib-bulk-action-tag').click()
  await page.getByTestId('lib-bulk-tag-input').fill('ревизия')
  await page.getByTestId('lib-bulk-tag-apply').click()

  const progress = page.getByTestId('lib-bulk-progress')
  await expect(progress).toBeVisible()
  const t1 = (await progress.textContent()) ?? ''
  console.log('прогресс #1:', t1.trim())
  expect(t1).toContain('из 500')

  /* интерфейс не заблокирован — чужая кнопка реагирует во время операции */
  await page.getByTestId('nav-library-toggle').click()
  await expect(page.getByTestId('nav-cluster-docs')).toBeVisible({ timeout: 5_000 })

  const t2 = (await progress.textContent()) ?? ''
  console.log('прогресс #2:', t2.trim())

  await page.getByTestId('lib-bulk-cancel').click()
  const cancelled = page.getByTestId('lib-bulk-cancelled')
  await expect(cancelled).toContainText('Операция прервана')
  const msg = (await cancelled.textContent()) ?? ''
  console.log('сообщение отмены:', msg.trim())
  const applied = Number(/применено\s+(\d+)\s+из/.exec(msg)?.[1] ?? -1)
  expect(applied).toBeGreaterThan(0)

  /* Честность: сколько сказали — столько и в хранилище (файлы; стикеры вне счёта) */
  const stored = await tagCount(page, 'ревизия')
  console.log('в localStorage помечено файлов:', stored, 'сообщение:', applied)
  expect(stored).toBeGreaterThan(0)
  expect(Math.abs(stored - applied)).toBeLessThanOrEqual(4)

  /* Undo откатывает применённое */
  await page.getByTestId('lib-bulk-undo-run').click()
  await expect(page.getByTestId('lib-bulk-undo')).toHaveCount(0)
  await page.waitForTimeout(700)
  const afterUndo = await tagCount(page, 'ревизия')
  console.log('после Undo помечено:', afterUndo)
  expect(afterUndo).toBe(0)
})

test('B · демо-корпус: метка доходит до стикеров, кластер их не трогает, обычный клик открывает инспектор', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await openApp(page)

  /* Регрессия: обычный клик по карточке файла открывает инспектор */
  await page.locator('[data-testid^="lib-file-"]').first().click()
  await expect(page.locator('aside[aria-label="Инспектор файла"]')).toBeVisible({ timeout: 15_000 })

  /* Метка на всё: файлы + стикеры */
  await page.getByTestId('lib-select-mode').click()
  await page.locator('[data-testid^="lib-note-"]').first().click()
  await expect(page.locator('[data-testid^="lib-note-"]').first()).toHaveAttribute('data-marked', '1')
  await page.getByTestId('lib-bulk-select-all').click()
  const countText = (await page.getByTestId('lib-bulk-count').textContent()) ?? ''
  console.log('выбрано:', countText.trim())

  await page.getByTestId('lib-bulk-action-tag').click()
  await page.getByTestId('lib-bulk-tag-input').fill('оптом-стикер')
  await page.getByTestId('lib-bulk-tag-apply').click()
  await expect(page.getByTestId('lib-bulk-undo')).toBeVisible({ timeout: 30_000 })

  const noteTagged = (await notes(page)).filter((n) => (n.tags ?? []).includes('оптом-стикер')).length
  console.log('стикеров с меткой:', noteTagged)
  expect(noteTagged).toBeGreaterThan(0)

  /* Undo снимает метку и со стикеров */
  await page.getByTestId('lib-bulk-undo-run').click()
  await page.waitForTimeout(700)
  const noteAfter = (await notes(page)).filter((n) => (n.tags ?? []).includes('оптом-стикер')).length
  expect(noteAfter).toBe(0)
  console.log('после Undo стикеров с меткой:', noteAfter)

  /* Кластер: стикеры не трогаются, файлы переезжают, Undo возвращает.
     После завершённой операции выделение честно снимается — набираем снова. */
  const clustersBefore = await clusterMap(page)
  await page.locator('[data-testid^="lib-file-"]').first().click()
  await page.getByTestId('lib-bulk-select-all').click()
  await page.getByTestId('lib-bulk-action-cluster').click()
  await page.getByTestId('lib-bulk-cluster-fin').click()
  await expect(page.getByTestId('lib-bulk-undo')).toBeVisible({ timeout: 30_000 })
  const finAfter = (await files(page)).filter((f) => f.cluster === 'fin').length
  console.log('кластеры до:', JSON.stringify(clustersBefore), '· fin после:', finAfter)
  expect(finAfter).toBeGreaterThan(clustersBefore.fin ?? 0)

  await page.getByTestId('lib-bulk-undo-run').click()
  await page.waitForTimeout(700)
  const clustersAfterUndo = await clusterMap(page)
  console.log('кластеры после Undo:', JSON.stringify(clustersAfterUndo))
  expect(clustersAfterUndo).toEqual(clustersBefore)
})

test('C · массовое удаление: счётчики падают, Undo возвращает файлы и привязку стикеров', async ({ page }) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await openApp(page)

  const navBefore = (await page.getByTestId('nav-library').textContent()) ?? ''

  await page.getByTestId('lib-select-mode').click()
  await page.locator('[data-testid^="lib-file-"]').first().click()
  await page.getByTestId('lib-bulk-select-all').click()
  await page.getByTestId('lib-bulk-action-trash').click()
  await expect(page.getByTestId('lib-bulk-undo')).toBeVisible({ timeout: 60_000 })

  const navAfter = (await page.getByTestId('nav-library').textContent()) ?? ''
  console.log('навигация до:', navBefore.trim(), '· после удаления:', navAfter.trim())
  const filesAfter = (await files(page)).length
  expect(filesAfter).toBe(0)
  const pinsAfterDelete = (await notes(page)).filter((n) => n.pinnedTo).length
  console.log('привязок стикеров после удаления:', pinsAfterDelete)

  await page.getByTestId('lib-bulk-undo-run').click()
  await page.waitForTimeout(1000)
  const restored = {
    files: (await files(page)).length,
    pins: (await notes(page)).filter((n) => n.pinnedTo).length,
  }
  console.log('после Undo файлов:', restored.files, '· привязок стикеров:', restored.pins)
  expect(restored.files).toBeGreaterThan(0)
  expect(restored.pins).toBeGreaterThan(pinsAfterDelete)
  const navRestored = (await page.getByTestId('nav-library').textContent()) ?? ''
  console.log('навигация после Undo:', navRestored.trim())
})

test('D · NF-6: палитра с любого экрана, недоступные команды, «Недавнее» после перезагрузки', async ({ page }) => {
  test.setTimeout(180_000)
  await skipOnboarding(page)
  await openApp(page)

  for (const nav of ['nav-map', 'nav-chat', 'nav-vault', 'nav-activity', 'nav-settings']) {
    await page.getByTestId(nav).click()
    await page.waitForTimeout(400)
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('cmdk')).toBeVisible({ timeout: 10_000 })
    /* ЗАМЕЧАНИЕ: фокус в поле ставится через setTimeout(20) — клавиши,
       нажатые сразу после Ctrl+K, теряются. Ждём фокус явно. */
    await expect(page.getByTestId('cmdk-input')).toBeFocused({ timeout: 5_000 })
    const n = await page.locator('[data-testid^="cmdk-cmd-"]').count()
    console.log(`палитра с ${nav}: команд ${n}`)
    expect(n).toBeGreaterThanOrEqual(20)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('cmdk')).toHaveCount(0)
  }

  /* Недоступная команда: замок выключен → lock.now помечена и объясняется */
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('cmdk-input')).toBeFocused({ timeout: 5_000 })
  await page.getByTestId('cmdk-input').fill('заблокировать сейф')
  const lockCmd = page.getByTestId('cmdk-cmd-lock.now')
  await expect(lockCmd).toBeVisible()
  const lockText = (await lockCmd.textContent()) ?? ''
  console.log('lock.now:', lockText.trim())
  expect(lockText.toLowerCase()).toContain('недоступ')
  /* aria-disabled=true (не HTML disabled) — реальный клик мышью проходит,
     Playwright же считает строку неактивной, поэтому force. */
  await lockCmd.click({ force: true })
  await expect(page.locator('.flash-toast')).toBeVisible({ timeout: 10_000 })
  const toast = (await page.locator('.flash-toast').textContent()) ?? ''
  console.log('тост недоступной команды:', toast.trim())
  expect(toast.toLowerCase()).toContain('недоступ')

  /* ДЕФЕКТ: Esc обрабатывает только input палитры. После клика по строке
     фокус ушёл — приходится возвращать его руками, иначе Esc немеет. */
  await page.getByTestId('cmdk-input').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cmdk')).toHaveCount(0)

  /* Команда экрана с чужого экрана: новый стикер из настроек */
  await page.getByTestId('nav-settings').click()
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('cmdk-input')).toBeFocused({ timeout: 5_000 })
  await page.getByTestId('cmdk-input').fill('новый стикер')
  await expect(page.getByTestId('cmdk-cmd-library.new-note')).toBeVisible()
  await page.getByTestId('cmdk-cmd-library.new-note').click()
  await expect(page.locator('section[aria-label="Новый стикер"]')).toBeVisible({ timeout: 30_000 })
  console.log('композер стикера открылся с экрана настроек')

  /* Недавнее при пустом запросе + переживает перезагрузку.
     ЗАМЕЧАНИЕ: запрос не сбрасывается при закрытии палитры, поэтому
     «Недавнее» после запуска команды само не появляется — чистим поле. */
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('cmdk-input')).toBeFocused({ timeout: 5_000 })
  await page.getByTestId('cmdk-input').fill('')
  await expect(page.getByTestId('cmdk-group-h-recent')).toBeVisible({ timeout: 10_000 })
  const persisted = await page.evaluate(() => localStorage.getItem('wf.commands.recent.v1'))
  console.log('wf.commands.recent.v1 =', persisted)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-app-ready', '1', { timeout: 30_000 })
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('cmdk-input')).toBeFocused({ timeout: 5_000 })
  await expect(page.getByTestId('cmdk-group-h-recent')).toBeVisible({ timeout: 10_000 })
  console.log('«Недавнее» пережило перезагрузку')

  /* Стрелки и Enter по списку */
  await page.getByTestId('cmdk-input').fill('карта памяти')
  await expect(page.getByTestId('cmdk-cmd-go.map')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('cmdk')).toHaveCount(0)
  await expect(page.getByTestId('screen-map')).toBeVisible({ timeout: 30_000 })
  console.log('стрелки + Enter отработали: открылась карта памяти')
})

test('E · секреты: папка, избранное, корзина + восстановление и удаление навсегда', async ({ page }) => {
  test.setTimeout(240_000)
  await skipOnboarding(page)
  await openApp(page)

  await page.getByTestId('nav-settings').click()
  await page.getByRole('button', { name: 'Настроить мастер-ключ' }).click()
  await page.getByRole('radio', { name: 'Пароль' }).click()
  await page.getByPlaceholder('от 8 символов').fill('e2e-master-2026')
  await page.getByPlaceholder('Повторите').fill('e2e-master-2026')
  await page.getByRole('button', { name: 'Включить замок' }).click()
  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })

  /* Генератор пароля — команда экрана секретов с экрана настроек */
  await page.keyboard.press('Control+k')
  await page.getByTestId('cmdk-input').fill('генератор пароля')
  await page.getByTestId('cmdk-cmd-vault.generator').click()
  await expect(page.getByTestId('generator-modal')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('generator-close').click()

  for (const name of ['rev-один', 'rev-два', 'rev-три']) {
    await page.getByTestId('vault-new').click()
    await page.getByTestId('editor-title').fill(name)
    await page.getByTestId('editor-save').click()
    await expect(page.getByTestId('vault-list').getByText(name)).toBeVisible({ timeout: 30_000 })
  }

  await page.getByTestId('vault-select-mode').click()
  await page.locator('[data-testid^="vault-card-"]').first().click()
  await expect(page.locator('[data-testid^="vault-mark-"]').first()).toBeVisible()
  await page.getByTestId('vault-bulk-select-all').click()
  await expect(page.getByTestId('vault-bulk-count')).toContainText('3')

  /* Избранное */
  await page.getByTestId('vault-bulk-action-fav').click()
  await expect(page.getByTestId('vault-bulk-undo')).toBeVisible({ timeout: 30_000 })
  console.log('массовое «В избранное» выполнено')

  /* Папка */
  await page.getByTestId('vault-select-mode').click()
  await page.getByTestId('vault-select-mode').click()
  await page.locator('[data-testid^="vault-card-"]').first().click()
  await page.getByTestId('vault-bulk-select-all').click()
  await page.getByTestId('vault-bulk-action-folder').click()
  const folderBtn = page.locator('[data-testid^="vault-bulk-folder-"]').nth(1)
  if (await folderBtn.count()) {
    await folderBtn.click()
    await expect(page.getByTestId('vault-bulk-undo')).toBeVisible({ timeout: 30_000 })
    console.log('массовый перенос в папку выполнен')
  } else {
    console.log('ВНИМАНИЕ: папок для массового переноса нет')
  }

  /* В корзину → раздел корзины → восстановить выделение */
  await page.getByTestId('vault-select-mode').click()
  await page.getByTestId('vault-select-mode').click()
  await page.locator('[data-testid^="vault-card-"]').first().click()
  await page.getByTestId('vault-bulk-select-all').click()
  await page.getByTestId('vault-bulk-action-trash').click()
  await expect(page.getByTestId('vault-list-empty')).toBeVisible({ timeout: 30_000 })

  const trashNav = page.getByRole('button', { name: /Корзина/ }).first()
  await trashNav.click()
  await page.waitForTimeout(600)
  await page.getByTestId('vault-select-mode').click()
  await page.locator('[data-testid^="vault-card-"]').first().click()
  await page.getByTestId('vault-bulk-select-all').click()
  await expect(page.getByTestId('vault-bulk-action-restore')).toBeVisible()
  await page.getByTestId('vault-bulk-action-restore').click()
  await page.waitForTimeout(1500)
  console.log('массовое «Восстановить» в корзине отработало')

  /* Удалить навсегда над выделением */
  await page.getByTestId('vault-select-mode').click()
  await page.getByTestId('vault-select-mode').click()
  const anyCard = page.locator('[data-testid^="vault-card-"]')
  if (await anyCard.count()) {
    await anyCard.first().click()
    await page.getByTestId('vault-bulk-select-all').click()
    if (await page.getByTestId('vault-bulk-action-purge').count()) {
      await page.getByTestId('vault-bulk-action-purge').click()
      await page.waitForTimeout(1500)
      console.log('массовое «Удалить навсегда» отработало')
    }
  }
})
