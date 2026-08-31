import { expect, test, type Page } from '@playwright/test'
import { readDoc } from './idb'

/**
 * Сценарий 9 (§1.1 хвоста волны 2): обёртки файловых ключей живут одним
 * документом в IndexedDB, а не записью localStorage на файл.
 * До этого §1.1 подтверждался только unit-тестами: в браузере путь
 * «поставить файл на ключ → перезагрузка → тот же пароль» не проходили ни разу.
 */

const MASTER = 'e2e-master-2026'
const FILE_PASS = 'e2e-file-pass-2026'

async function setupMaster(page: Page) {
  await page.getByTestId('nav-settings').click()
  await page.getByRole('button', { name: 'Настроить мастер-ключ' }).click()
  await page.getByRole('radio', { name: 'Пароль' }).click()
  await page.getByPlaceholder('от 8 символов').fill(MASTER)
  await page.getByPlaceholder('Повторите').fill(MASTER)
  await page.getByRole('button', { name: 'Включить замок' }).click()
  await expect(page.getByText('активен · пароль')).toBeVisible({ timeout: 30_000 })
}

/** Словарь обёрток из IndexedDB: ждём, пока запись доедет. */
async function fileKeyMap(page: Page): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 40; i += 1) {
    const map = await readDoc<Record<string, unknown>>(page, 'wf.filekeys.map.v1')
    if (map && Object.keys(map).length > 0) return map
    await page.waitForTimeout(250)
  }
  return null
}

test('файловый ключ: файл на ключ, перезагрузка, тот же пароль открывает', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await setupMaster(page)

  await page.getByTestId('nav-library').click()
  const name = `e2e-ключ-${Date.now()}.pdf`
  await page.getByTestId('file-picker').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 e2e-file-key'),
  })

  const tile = page.locator('[data-tile-key^="file:"]').filter({ hasText: name.slice(0, 18) })
  await expect(tile).toHaveCount(1, { timeout: 20_000 })
  const tileKey = await tile.getAttribute('data-tile-key')
  const fileId = String(tileKey).slice('file:'.length)
  await tile.click()

  /* 1. Ставим файл на ключ: пароль ×2 → «Запереть». */
  await page.getByTestId('fk-set-open').click()
  await expect(page.getByTestId('fk-set-modal')).toBeVisible()
  await page.getByTestId('fk-set-pass1').fill(FILE_PASS)
  await page.getByTestId('fk-set-pass2').fill(FILE_PASS)
  await page.getByTestId('fk-set-save').click()
  await expect(page.getByTestId('fk-set-modal')).toBeHidden({ timeout: 20_000 })

  /* 2. Обёртка легла в документ-словарь IndexedDB. */
  const map = await fileKeyMap(page)
  expect(map, 'словарь обёрток обязан появиться в IndexedDB').not.toBeNull()
  expect(Object.keys(map ?? {})).toContain(fileId)
  const blob = (map ?? {})[fileId] as Record<string, string>
  expect(typeof blob.wct).toBe('string')
  expect(typeof blob.pct).toBe('string')

  /* 3. Ни одной старой записи `wf.vault.keys.<id>` в localStorage. */
  const legacy = await page.evaluate(() =>
    Object.keys(localStorage).filter(
      (k) => k.startsWith('wf.vault.keys.') && k !== 'wf.vault.keys.migrated',
    ),
  )
  expect(legacy, 'обёртки не должны оставаться в localStorage').toEqual([])

  /* 4. Перезагрузка: замок закрыт, открываем мастер-паролем. */
  await page.reload()
  const lockScreen = page.getByLabel('Сейф заблокирован')
  await expect(lockScreen).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Мастер-пароль').fill(MASTER)
  await page.getByLabel('Мастер-пароль').press('Enter')
  await expect(lockScreen).toBeHidden({ timeout: 30_000 })

  await page.getByTestId('nav-library').click()
  const tileAfter = page.locator(`[data-tile-key="file:${fileId}"]`)
  await expect(tileAfter).toBeVisible({ timeout: 20_000 })

  /* 5. Файл под ключом: клик просит пароль, а не открывает. */
  await tileAfter.click()
  await expect(page.getByTestId('fk-ask-modal')).toBeVisible({ timeout: 20_000 })

  /* 6. Неверный ключ отвергается. */
  await page.getByTestId('fk-ask-input').fill('совсем-не-тот-ключ')
  await page.getByTestId('fk-ask-submit').click()
  await expect(page.getByTestId('fk-ask-hint')).toContainText('не подходит', { timeout: 20_000 })
  await expect(page.getByTestId('fk-ask-modal')).toBeVisible()

  /* 7. Тот же пароль после перезагрузки — открывает. */
  await expect(page.getByTestId('fk-ask-input')).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId('fk-ask-input').fill(FILE_PASS)
  await page.getByTestId('fk-ask-submit').click()
  await expect(page.getByTestId('fk-ask-modal')).toBeHidden({ timeout: 20_000 })
})
