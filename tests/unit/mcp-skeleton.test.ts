/* ============================================================
   RM-3 · СКЕЛЕТ MCP ПОМЕЧЕН КАК МАКЕТ
   Ответ, которого не было в сети, обязан выглядеть как макет: признак
   `mock` в теле, никаких правдоподобных ссылок и никакой выдуманной
   задержки, по которой скелет можно принять за живой сервис.
   ============================================================ */

import { describe, expect, it, vi } from 'vitest'

const server = {
  id: 'notion',
  name: 'Notion',
  host: '192.168.1.10',
  port: 8808,
  enabled: true,
  tokenSet: false,
}

vi.mock('@/lib/ai-server', () => ({
  safeId: (s: string) => s,
  getMcp: async (id: string) => (id === 'notion' ? { ...server } : null),
  saveMcp: async () => {},
}))

type Body = Record<string, unknown>

async function call(body: Body): Promise<Body> {
  const { POST } = await import('@/app/ai-api/mcp/[id]/route')
  const req = new Request('http://localhost/ai-api/mcp/notion', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const res = await POST(req as never, { params: Promise.resolve({ id: 'notion' }) } as never)
  return (await res.json()) as Body
}

describe('RM-3 · скелет MCP', () => {
  it('макетный документ помечен и не притворяется ссылкой на Notion', async () => {
    const r = await call({ action: 'pull', query: 'смета ремонта' })

    expect(r.ok).toBe(true)
    expect(r.mock).toBe(true)
    expect(r.notice).toBe('макет, не реальные данные')

    const doc = r.doc as { url: string; title: string; excerpt: string }
    /* Правдоподобный notion.so-адрес выглядел как настоящий документ. */
    expect(doc.url.startsWith('mock://')).toBe(true)
    expect(doc.url).not.toContain('notion.so')
    expect(doc.title).toContain('Макет')
    /* Времени изменения у выдуманного документа быть не может. */
    expect(doc).not.toHaveProperty('updated')
  })

  it('проверка соединения не выдумывает задержку', async () => {
    const r = await call({ action: 'test' })

    expect(r.ok).toBe(true)
    expect(r.mock).toBe(true)
    expect(r).not.toHaveProperty('latency')
    expect(String(r.message)).toContain('НЕ проверялось')
  })

  it('отказы скелета тоже помечены макетом', async () => {
    server.enabled = false
    const r = await call({ action: 'pull', query: 'что угодно' })
    server.enabled = true

    expect(r.ok).toBe(false)
    expect(r.mock).toBe(true)
    expect(String(r.error)).toContain('выключен')
  })
})
