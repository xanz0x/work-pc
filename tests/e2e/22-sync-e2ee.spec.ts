import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Сценарий 22 (NF-11): два устройства — два независимых контекста браузера.
 * A включает синхронизацию и получает фразу; B присоединяется по фразе;
 * стикер, созданный на A, появляется у B; A отзывает B — B теряет доступ.
 */

async function login(page: Page) {
  await skipOnboarding(page)
  await page.goto('/login')
  await page.getByTestId('login-password').fill(process.env.APP_PASSWORD as string)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })
  await waitAppReady(page)
}

async function openSync(page: Page) {
  await page.getByTestId('nav-settings').click()
  const sec = page.getByTestId('settings-sync')
  await sec.scrollIntoViewIfNeeded()
  return sec
}

test('NF-11: изменения расходятся между двумя устройствами, отзыв закрывает доступ', async ({
  browser,
}) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  test.setTimeout(180_000)
  const ctxA: BrowserContext = await browser.newContext()
  const ctxB: BrowserContext = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()

  await login(a)
  await openSync(a)
  await a.getByTestId('sync-label').fill('Ноутбук A')
  await a.getByTestId('sync-create').click()
  await expect(a.getByTestId('sync-status')).toHaveText(/в эфире/i, { timeout: 30_000 })
  const words = (await a.getByTestId('sync-words').locator('li').allInnerTexts()).map(
    (t) => t.trim().split(/\s+/).pop() as string,
  )
  expect(words).toHaveLength(12)

  await login(b)
  await openSync(b)
  await b.getByTestId('sync-label').fill('Телефон B')
  await b.getByTestId('sync-join-phrase').fill(words.join(' '))
  await b.getByTestId('sync-join').click()
  await expect(b.getByTestId('sync-status')).toHaveText(/в эфире/i, { timeout: 30_000 })
  await expect(b.getByTestId('sync-device-row')).toHaveCount(2, { timeout: 30_000 })

  /* Стикер создаётся на A через MCP-инструмент (как это сделал бы агент) и доезжает до B. */
  const tok = await a.request.post('/mcp/admin/tokens', {
    data: { name: 'sync-e2e', scopes: ['notes:write'], ttlHours: 1 },
  })
  const { token } = (await tok.json()) as { token: string }
  const call = await a.request.post('/mcp', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_sticker', arguments: { title: 'Стикер с устройства A', body: 'e2e', ttl: 'forever' } },
    },
  })
  expect(((await call.json()) as { result: { isError: boolean } }).result.isError).toBe(false)

  await b.getByTestId('nav-library').click()
  await expect(b.getByText('Стикер с устройства A')).toBeVisible({ timeout: 30_000 })

  /* Неверная фраза не даёт присоединиться к чужому пространству. */
  const bad = [...words.slice(0, 11), words[10]]
  const ctxC = await browser.newContext()
  const c = await ctxC.newPage()
  await login(c)
  await openSync(c)
  await c.getByTestId('sync-label').fill('Чужой')
  await c.getByTestId('sync-join-phrase').fill(bad.join(' '))
  await c.getByTestId('sync-join').click()
  await expect(c.getByTestId('sync-error')).toBeVisible({ timeout: 15_000 })
  await ctxC.close()

  /* A отзывает B: B получает отказ и больше не синхронизируется. */
  await openSync(a)
  await expect(a.getByTestId('sync-device-revoke')).toHaveCount(1, { timeout: 30_000 })
  await a.getByTestId('sync-device-revoke').click()
  await a.getByTestId('sync-device-revoke').click()
  await expect(a.getByTestId('sync-device-status').nth(1)).toHaveText('отозвано', { timeout: 30_000 })
  await openSync(b)
  await expect(b.getByTestId('sync-error')).toContainText('отозвано', { timeout: 40_000 })

  const kinds = await a.getByTestId('journal-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
  expect(kinds).toContain('sync-enabled')
  expect(kinds).toContain('sync-device-revoked')

  await ctxA.close()
  await ctxB.close()
})
