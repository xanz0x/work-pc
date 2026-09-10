import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'
import { dropBox, prepareRichMail } from './rich-mail'

/**
 * Независимая проверка сверх спек 60/61:
 *   - «Добавить файл» из ЛЕВОГО меню (file-add-btn) проходит через диалог подпапки.
 *   - Двухуровневая вложенность: <root>/A/B/<file>.
 *   - Файл в подпапке НЕ помечен shared и НЕ фигурирует в общем диске.
 *   - Меню письма закрывается по клику мимо и при переходе на другое письмо.
 */

const ROOT = path.join('/root', `wsx-e2e-indep-${Date.now()}`)
const A = 'Договоры'
const B = 'Приложения'

type DriveFile = { id: string; name: string; dir: string; shared?: boolean; relPath?: string }

test('подпапки: левое меню + вложенность 2-го уровня + приватность', async ({ page }) => {
  const set = await page.request.put('/ai-api/cloud/storage-root', { data: { root: ROOT } })
  expect(set.ok(), await set.text()).toBeTruthy()

  await skipOnboarding(page)
  await page.goto('/')
  await waitAppReady(page)

  /* 1. Кнопка из ЛЕВОГО меню (file-add-btn/file-picker) — должна вести
        через диалог подпапки, а не сразу класть файл. */
  const name = `left-menu-${Date.now()}.txt`
  await page.getByTestId('file-picker').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from('через кнопку в левом меню'),
  })
  await expect(page.getByTestId('intake-dir')).toBeVisible()

  /* Создаём A → входим в A → создаём внутри B → кладём файл в A/B. */
  await page.getByTestId('intake-dir-new').click()
  await page.getByTestId('intake-dir-new-name').fill(A)
  await page.getByTestId('intake-dir-new-create').click()
  await expect(page.getByTestId('intake-dir-crumbs')).toContainText(A)

  await page.getByTestId('intake-dir-new').click()
  await page.getByTestId('intake-dir-new-name').fill(B)
  await page.getByTestId('intake-dir-new-create').click()
  await expect(page.getByTestId('intake-dir-crumbs')).toContainText(B)

  await page.getByTestId('intake-dir-confirm').click()
  await expect(page.getByTestId('intake-dir')).toBeHidden()

  /* 2. Файл физически лежит в <root>/A/B/<name>, а не в других местах. */
  await expect(async () => {
    const inside = await readdir(path.join(ROOT, A, B))
    expect(inside).toContain(name)
  }).toPass({ timeout: 30_000 })
  const st = await stat(path.join(ROOT, A, B, name))
  expect(st.size).toBeGreaterThan(0)
  expect(await readdir(ROOT)).toEqual([A])
  expect((await readdir(path.join(ROOT, A))).filter((x) => x !== B)).toEqual([])

  /* 3. Метаданные: dir = "A/B", shared=false, ровно одна карточка. */
  const view = (await (await page.request.get('/ai-api/cloud')).json()) as {
    folders: string[]
    files: DriveFile[]
  }
  const rows = view.files.filter((f) => f.name === name)
  expect(rows).toHaveLength(1)
  expect(rows[0].dir).toBe(`${A}/${B}`)
  expect(rows[0].shared).toBe(false)
  expect(rows[0].relPath).toBe(`${A}/${B}/${name}`)

  /* 4. Общий диск: файл там не появляется. Проверяем через тот же /ai-api/cloud,
        отфильтровав по shared:true. */
  const sharedRows = view.files.filter((f) => f.shared === true && f.name === name)
  expect(sharedRows).toHaveLength(0)

  /* 5. Уборка. */
  const del = await page.request.delete(`/ai-api/cloud/file/${rows[0].id}`)
  expect(del.ok(), await del.text()).toBeTruthy()
  await page.request.delete('/ai-api/cloud/folder', { data: { path: `${A}/${B}` } })
  await page.request.delete('/ai-api/cloud/folder', { data: { path: A } })
  const off = await page.request.put('/ai-api/cloud/storage-root', { data: { root: '' } })
  expect(off.ok()).toBeTruthy()
  await rm(ROOT, { recursive: true, force: true })
})

async function rightClick(frame: FrameLocator, selector: string) {
  await frame.locator(selector).click({ button: 'right' })
}

test('меню письма: закрывается по клику мимо и при переключении письма', async ({ page }) => {
  const { box, row, mine } = await prepareRichMail(page.request)

  await skipOnboarding(page)
  await page.goto('/')
  await waitAppReady(page)
  await page.getByTestId('nav-mail').click()
  await page.getByTestId(`mail-temp-row-${box.id}`).click()
  await page.getByTestId(`mail-temp-open-${row.mid}`).click()
  await expect(page.getByTestId('mail-temp-frame')).toBeVisible()

  const frame = page.frameLocator('[data-testid="mail-temp-frame"]')
  await expect(frame.locator('#cta')).toBeVisible()

  /* Меню открывается и закрывается по клику мимо (по хосту снаружи iframe). */
  await rightClick(frame, '#cta')
  const menu = page.getByTestId('mail-ctx-menu')
  await expect(menu).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(menu).toBeHidden()

  /* При переключении на другое письмо (или закрытии текущего) меню не висит. */
  await rightClick(frame, '#cta')
  await expect(menu).toBeVisible()
  /* Возвращаемся в список писем — тело письма и меню должны исчезнуть. */
  const back = page.getByTestId('mail-temp-back')
  if (await back.count()) {
    await back.first().click()
  } else {
    await page.getByTestId(`mail-temp-row-${box.id}`).click()
  }
  await expect(menu).toBeHidden()
  await dropBox(page.request, box, mine)
})
