import { expect, test } from '@playwright/test'
import { readDoc } from './idb'

/**
 * Сценарий 10 (§1.2 хвоста волны 2): запись на первом кадре не затирает архив.
 * Раньше одна запись, случившаяся раньше чтения из IndexedDB, навсегда
 * отменяла применение прочитанного — состояние по умолчанию уезжало в базу
 * поверх настоящего архива. Здесь гидратация честно замедляется (медленный
 * `navigator.storage.estimate`, который ждёт `storageReady`), файл принимается
 * до её окончания, и проверяется, что все 20 файлов остались на месте.
 */

const ARCHIVE = Array.from({ length: 20 }, (_, i) => ({
  id: `legacy-${i + 1}`,
  icon: 'doc',
  cluster: 'docs',
  name: `архив_${String(i + 1).padStart(2, '0')}.pdf`,
  desc: 'Файл из архива: обязан пережить раннюю запись',
  bytes: 100_000 + i,
  date: '01 янв',
  pages: 2,
  tags: ['архив'],
}))

/** Документ архива из IndexedDB. */
const readFiles = (page: import('@playwright/test').Page) =>
  readDoc<{ id: string; name: string }[]>(page, 'wf.files.v1')

test('запись на первом кадре: архив из 20 файлов не затирается', async ({ page }) => {
  test.setTimeout(120_000)

  /* Посев — только на первой загрузке: init-script выполняется и при reload,
     иначе он пересевал бы localStorage и давал ложный результат. */
  await page.addInitScript((archive) => {
    if (sessionStorage.getItem('wf.e2e.seeded') === '1') return
    sessionStorage.setItem('wf.e2e.seeded', '1')
    localStorage.setItem('wf.files.v1', JSON.stringify(archive))
  }, ARCHIVE)

  /* Замедление гидратации: storageReady() ждёт quotaInfo() → estimate(). */
  await page.addInitScript(() => {
    const orig = navigator.storage?.estimate?.bind(navigator.storage)
    if (!orig) return
    navigator.storage.estimate = async () => {
      if (sessionStorage.getItem('wf.e2e.slowQuota') !== '1') return orig()
      await new Promise((r) => setTimeout(r, 10_000))
      return orig()
    }
  })

  await page.goto('/')
  await page.getByTestId('nav-library').click()
  await expect
    .poll(async () => (await readFiles(page))?.length ?? 0, { timeout: 30_000 })
    .toBe(20)

  /* Второй запуск — с медленным чтением. */
  await page.evaluate(() => sessionStorage.setItem('wf.e2e.slowQuota', '1'))
  await page.reload()
  await page.getByTestId('nav-library').click()

  /* Гидратация ещё идёт: архива на экране нет — самый опасный момент. */
  await expect(page.getByText('архив_01.pdf', { exact: false })).toHaveCount(0)

  /* Приём файла до окончания гидратации: раньше это отменяло прочитанное. */
  const name = `e2e-первый-кадр-${Date.now()}.pdf`
  await page.getByTestId('file-picker').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 e2e-first-frame'),
  })

  /* Новый файл на экране — и архив вместе с ним. */
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('архив_01.pdf', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  })

  /* В базе — 21 запись: 20 из архива плюс принятая. */
  await expect
    .poll(async () => (await readFiles(page))?.length ?? 0, { timeout: 30_000 })
    .toBe(21)
  const files = (await readFiles(page)) ?? []
  expect(files.filter((f) => f.id.startsWith('legacy-'))).toHaveLength(20)
  expect(files.some((f) => f.name === name)).toBe(true)
})
