import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Подпапки личной папки на ПК: при добавлении файла человек выбирает или
 * создаёт НАСТОЯЩУЮ подпапку внутри своей папки хранения, файл физически
 * ложится туда, а библиотека показывает полосу папок и крошки пути.
 * Файл остаётся личным (shared:false) и в общий диск не уезжает.
 */

const ROOT = path.join('/root', `wsx-e2e-subdirs-${Date.now()}`)
const SUB = 'Договоры'

type DriveFile = { id: string; name: string; dir: string; shared?: boolean; relPath?: string }

test('подпапки: файл уезжает в реальную подпапку, библиотека фильтрует по ней', async ({ page }) => {
  /* Папка хранения выбирается тем же путём, что и в интерфейсе. */
  const set = await page.request.put('/ai-api/cloud/storage-root', { data: { root: ROOT } })
  expect(set.ok(), await set.text()).toBeTruthy()

  await skipOnboarding(page)
  await page.goto('/')
  await waitAppReady(page)
  await page.getByTestId('nav-library').click()

  const name = `подпапки-${Date.now()}.txt`
  await page.getByTestId('file-picker').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e содержимое для подпапки'),
  })

  /* 1. Спрашиваем, куда положить: создаём подпапку и подтверждаем. */
  await expect(page.getByTestId('intake-dir')).toBeVisible()
  await page.getByTestId('intake-dir-new').click()
  await page.getByTestId('intake-dir-new-name').fill(SUB)
  await page.getByTestId('intake-dir-new-create').click()
  await expect(page.getByTestId('intake-dir-crumbs')).toContainText(SUB)
  await page.getByTestId('intake-dir-confirm').click()
  await expect(page.getByTestId('intake-dir')).toBeHidden()

  /* 2. Папка на диске настоящая, файл лежит внутри неё. */
  await expect(async () => {
    const inside = await readdir(path.join(ROOT, SUB))
    expect(inside).toContain(name)
  }).toPass({ timeout: 30_000 })
  const st = await stat(path.join(ROOT, SUB, name))
  expect(st.size).toBeGreaterThan(0)
  /* В корне папки хранения дубля нет. */
  expect(await readdir(ROOT)).toEqual([SUB])

  /* 3. Метаданные: файл личный, подпапка записана, дубля нет. */
  const view = (await (await page.request.get('/ai-api/cloud')).json()) as { folders: string[]; files: DriveFile[] }
  expect(view.folders).toContain(SUB)
  const rows = view.files.filter((f) => f.name === name)
  expect(rows).toHaveLength(1)
  expect(rows[0].dir).toBe(SUB)
  expect(rows[0].shared).toBe(false)
  expect(rows[0].relPath).toBe(`${SUB}/${name}`)

  /* 4. Библиотека: полоса папок, крошки, фильтр по подпапке. */
  await expect(page.getByTestId('lib-dirs')).toBeVisible()
  const card = page.getByTestId(`lib-file-cloud:${rows[0].id}`)
  await expect(card).toHaveCount(1)
  await expect(card).toBeVisible()
  await expect(page.getByTestId('lib-dirs-crumbs')).toContainText(SUB)

  /* Возврат в корень: файл из подпапки там не показывается. */
  await page.getByTestId('lib-dir-root').click()
  await expect(card).toHaveCount(0)
  const chip = page.getByTestId('lib-dir-open').filter({ hasText: SUB })
  await expect(chip).toHaveCount(1)
  await chip.click()
  await expect(card).toHaveCount(1)

  /* 5. Уборка: файл, папка на диске и выбор папки хранения. */
  const del = await page.request.delete(`/ai-api/cloud/file/${rows[0].id}`)
  expect(del.ok(), await del.text()).toBeTruthy()
  const off = await page.request.put('/ai-api/cloud/storage-root', { data: { root: '' } })
  expect(off.ok()).toBeTruthy()
  await page.request.delete('/ai-api/cloud/folder', { data: { path: SUB } })
  await rm(ROOT, { recursive: true, force: true })
})
