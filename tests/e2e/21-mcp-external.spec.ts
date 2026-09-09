import { expect, test, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

/**
 * Сценарий 21 (NF-10): внешний агент работает с сейфом по токену.
 * Токен выдаётся в настройках, агент (здесь — прямой HTTP-клиент) ищет,
 * создаёт стикер и просит записать секрет; запись происходит только после
 * одобрения в интерфейсе; каждый шаг виден в журнале безопасности;
 * отозванный токен больше не проходит.
 */

async function login(page: Page) {
  await skipOnboarding(page)
  await page.goto('/login')
  await page.getByTestId('login-password').fill(process.env.APP_PASSWORD as string)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })
  await waitAppReady(page)
}

async function setupPin(page: Page) {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('mk-setup-open').click()
  for (let i = 0; i < 6; i += 1) await page.getByTestId(`mk-pin1-${i}`).fill(String(i + 1))
  for (let i = 0; i < 6; i += 1) await page.getByTestId(`mk-pin2-${i}`).fill(String(i + 1))
  await page.getByTestId('mk-submit').click()
  await expect(page.getByTestId('mk-modal')).toHaveCount(0, { timeout: 30_000 })
}

test('NF-10: агент по токену ищет, создаёт стикер и пишет секрет после одобрения', async ({
  page,
  request,
}) => {
  test.skip(!process.env.APP_PASSWORD, 'нужен APP_PASSWORD для входа')
  test.setTimeout(180_000)
  await login(page)
  await setupPin(page)

  const section = page.getByTestId('settings-mcp')
  await section.scrollIntoViewIfNeeded()
  await expect(page.getByTestId('mcp-bridge-status')).toContainText('подключена', { timeout: 30_000 })

  await page.getByTestId('mcp-token-name').fill('e2e-агент')
  await page.getByTestId('mcp-scope-notes-write').click()
  await page.getByTestId('mcp-scope-secrets-write').click()
  await page.getByTestId('mcp-ttl-1').click()
  await page.getByTestId('mcp-token-issue').click()
  const token = (await page.getByTestId('mcp-issued-token').innerText()).trim()
  expect(token).toMatch(/^wsx_[a-z0-9]{8}_[a-f0-9]{48}$/)

  const base = process.env.APP_URL ?? 'http://localhost:3000'
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const r = await request.post(`${base}/mcp`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { jsonrpc: '2.0', id: 1, method, params },
    })
    return (await r.json()) as { result: { structuredContent: Record<string, unknown>; isError: boolean } }
  }

  /* Поиск идёт через открытую вкладку: демо-корпус находит договоры. */
  const search = await rpc('tools/call', { name: 'search', arguments: { query: 'договор', limit: 3 } })
  expect(search.result.isError).toBe(false)
  expect((search.result.structuredContent.hits as unknown[]).length).toBeGreaterThan(0)

  const sticker = await rpc('tools/call', {
    name: 'create_sticker',
    arguments: { title: 'Стикер от агента', body: 'MCP e2e', ttl: '24h' },
  })
  expect(sticker.result.isError).toBe(false)

  /* Секрет: первый вызов — pending, запись появляется только после одобрения. */
  const first = await rpc('tools/call', {
    name: 'create_secret',
    arguments: { title: 'e2e-secret', fields: [{ name: 'Пароль', value: 'p@ss-e2e' }] },
  })
  expect(first.result.structuredContent.status).toBe('pending_approval')
  const approvalId = first.result.structuredContent.approvalId as string

  const row = page.getByTestId('mcp-pending-row')
  await expect(row).toHaveCount(1, { timeout: 30_000 })
  await expect(page.getByTestId('mcp-pending-summary')).not.toContainText('p@ss-e2e')
  await page.getByTestId('mcp-pending-approve').click()
  await expect(row).toHaveCount(0, { timeout: 15_000 })

  const second = await rpc('tools/call', {
    name: 'create_secret',
    arguments: { title: 'e2e-secret', fields: [{ name: 'Пароль', value: 'p@ss-e2e' }], approvalId },
  })
  expect(second.result.isError).toBe(false)
  expect(second.result.structuredContent.created).toBe(true)
  await expect(page.getByTestId('nav-vault')).toContainText('1')

  /* Журнал: выдача, три вызова, запрос и одобрение — всё на месте. */
  const kinds = await page.getByTestId('journal-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
  expect(kinds).toContain('mcp-token-issued')
  expect(kinds.filter((k) => k === 'mcp-call').length).toBeGreaterThanOrEqual(2)
  expect(kinds.filter((k) => k === 'mcp-approval').length).toBeGreaterThanOrEqual(2)

  /* Отзыв: агент получает 401, статус токена меняется. */
  await page.getByTestId('mcp-token-revoke').first().click()
  await page.getByTestId('mcp-token-revoke').first().click()
  await expect(page.getByTestId('mcp-token-status').first()).toHaveText('отозван')
  const denied = await request.post(`${base}/mcp`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { jsonrpc: '2.0', id: 2, method: 'ping', params: {} },
  })
  expect(denied.status()).toBe(401)
})
