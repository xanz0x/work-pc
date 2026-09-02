import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'

/**
 * Сценарий 7 (§1.4 хвоста волны 2): «нет места» и «не сохранилось».
 * Оба состояния были покрыты только unit-тестом шины ошибок, а вёрстка и
 * кнопки не отрисовывались ни разу. Здесь запись в IndexedDB честно
 * отвергается QuotaExceededError, и проверяется весь путь пользователя.
 */

/** Патч ставится до загрузки приложения; включается флагом из теста. */
const patchIdb = () => {
  const w = window as unknown as { __wfQuota?: boolean }
  w.__wfQuota = false
  const origPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function put(this: IDBObjectStore, ...args: unknown[]) {
    if (w.__wfQuota && this.name === 'docs') {
      throw new DOMException('нет места (e2e)', 'QuotaExceededError')
    }
    return (origPut as (...a: unknown[]) => IDBRequest).apply(this, args)
  } as typeof IDBObjectStore.prototype.put
}

test('переполнение хранилища: экран «нет места», повтор и продолжение', async ({ page }) => {
  await skipOnboarding(page)
  await page.addInitScript(patchIdb)
  await page.goto('/')
  await page.getByTestId('nav-library').click()

  /* Приложение уже прогрузилось — включаем отказ записи. */
  await page.evaluate(() => {
    ;(window as unknown as { __wfQuota: boolean }).__wfQuota = true
  })

  /* Приём файла — самая честная запись: он идёт в документ wf.files.v1. */
  await page.getByTestId('file-picker').setInputFiles({
    name: `e2e-quota-${Date.now()}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e-quota'),
  })

  const full = page.getByTestId('storage-full')
  await expect(full).toBeVisible({ timeout: 20_000 })
  await expect(full).toContainText('Нет места')

  /* Повтор при всё ещё отказывающей записи оставляет экран на месте. */
  await page.getByTestId('storage-full-retry').click()
  await expect(full).toBeVisible()

  /* Место «освободилось» — повтор закрывает экран. */
  await page.evaluate(() => {
    ;(window as unknown as { __wfQuota: boolean }).__wfQuota = false
  })
  await page.getByTestId('storage-full-retry').click()
  await expect(full).toBeHidden({ timeout: 20_000 })
})

test('«не сохранилось»: баннер с повтором и уходом по кнопке', async ({ page }) => {
  await skipOnboarding(page)
  await page.addInitScript(patchIdb)
  await page.goto('/')
  await page.getByTestId('nav-library').click()

  /* Обычная ошибка записи (не квота) даёт баннер, а не экран. */
  await page.evaluate(() => {
    const w = window as unknown as { __wfQuota: boolean }
    w.__wfQuota = false
    const origPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function put(this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'docs') throw new Error('диск отвалился (e2e)')
      return (origPut as (...a: unknown[]) => IDBRequest).apply(this, args)
    } as typeof IDBObjectStore.prototype.put
  })

  await page.getByTestId('file-picker').setInputFiles({
    name: `e2e-writefail-${Date.now()}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e-writefail'),
  })

  const bar = page.getByTestId('storage-error-bar')
  await expect(bar).toBeVisible({ timeout: 20_000 })
  await expect(bar).toContainText('Не сохранилось')

  await page.getByTestId('storage-dismiss').click()
  await expect(bar).toBeHidden()
})
