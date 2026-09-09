/* ============================================================
   NF-10 · РАЗРЕШЕНИЯ И СЕРВЕРНОЕ СОСТОЯНИЕ MCP
   Токен без области не проходит к инструменту, отозванный и истёкший —
   отклоняются, опасная операция не выполняется без решения человека,
   и каждый из этих исходов оставляет запись аудита.
   ============================================================ */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  allowedTools,
  formatToken,
  hasScope,
  isDangerous,
  parseToken,
  summarizeArgs,
  tokenStatus,
} from '@/lib/permissions'

const dir = mkdtempSync(join(tmpdir(), 'wsx-mcp-'))
process.env.AI_DIR = dir

type Srv = typeof import('@/lib/mcp-server')
let srv: Srv

beforeAll(async () => {
  srv = await import('@/lib/mcp-server')
  srv.resetMcpState()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('permissions', () => {
  it('инструменты открываются только своей областью', () => {
    expect(allowedTools(['search'])).toEqual(['search'])
    expect(allowedTools(['read'])).toEqual(['get_metadata', 'list_files'])
    expect(hasScope(['notes:write'], 'create_secret')).toBe(false)
    expect(isDangerous('create_secret')).toBe(true)
    expect(isDangerous('create_sticker')).toBe(false)
  })

  it('формат токена разбирается, мусор — нет', () => {
    const t = formatToken('abcd1234', 'f'.repeat(48))
    expect(parseToken(t)).toEqual({ id: 'abcd1234', secret: 'f'.repeat(48) })
    expect(parseToken('wsx_abcd1234_short')).toBeNull()
    expect(parseToken('')).toBeNull()
  })

  it('сводка аргументов не содержит значений полей', () => {
    const s = summarizeArgs('create_secret', {
      title: 'GitHub',
      fields: [{ name: 'Пароль', value: 'hunter2-secret' }],
    })
    expect(s).toContain('Пароль')
    expect(s).not.toContain('hunter2')
  })

  it('статус токена: истёк / отозван', () => {
    const base = { id: 'a', name: 'n', scopes: [], createdAt: 0, expiresAt: 10, revokedAt: null, lastUsedAt: null, calls: 0 }
    expect(tokenStatus(base, 5)).toBe('active')
    expect(tokenStatus(base, 10)).toBe('expired')
    expect(tokenStatus({ ...base, revokedAt: 3 }, 5)).toBe('revoked')
  })
})

describe('mcp-server', () => {
  it('выдача → проверка → отзыв, всё в аудите', async () => {
    const { token, view } = await srv.issueToken('legacy', 'Тест', ['search'], 1)
    expect(view.scopes).toEqual(['search'])
    const ok = await srv.authenticate(`Bearer ${token}`)
    expect(ok.ok).toBe(true)

    const bad = await srv.authenticate(`Bearer ${formatToken(view.id, '0'.repeat(48))}`)
    expect(bad).toEqual({ ok: false, code: 'TOKEN_INVALID' })
    expect(await srv.authenticate(null)).toEqual({ ok: false, code: 'TOKEN_MISSING' })

    expect(await srv.revokeToken('legacy', view.id)).toBe(true)
    const revoked = await srv.authenticate(`Bearer ${token}`)
    expect(revoked).toEqual({ ok: false, code: 'TOKEN_REVOKED' })

    const poll = await srv.bridgePoll('legacy', 0)
    const kinds = poll.audit.map((a) => a.kind)
    expect(kinds).toEqual(['token-issued', 'denied', 'token-revoked', 'denied'])
    /* Повторный опрос ничего не отдаёт: аудит доставляется один раз. */
    expect((await srv.bridgePoll('legacy', 0)).audit).toEqual([])
  })

  it('без открытой вкладки вызов честно падает и остаётся в аудите', async () => {
    srv.resetMcpState()
    const { view } = await srv.issueToken('legacy', 'Без моста', ['search'], 1)
    await expect(srv.runTool({ ...view, owner: 'legacy' }, 'search', { query: 'x' })).rejects.toThrow('NO_BRIDGE')
    const poll = await srv.bridgePoll('legacy', 0)
    const call = poll.audit.find((a) => a.kind === 'call')
    expect(call?.ok).toBe(false)
    expect(call?.detail).toContain('не открыта')
  })

  it('задание доходит до моста и результат возвращается агенту', async () => {
    srv.resetMcpState()
    const { view } = await srv.issueToken('legacy', 'Мост', ['search'], 1)
    await srv.bridgePoll('legacy', 0) // вкладка «подключилась»
    const p = srv.runTool({ ...view, owner: 'legacy' }, 'search', { query: 'договор' })
    const poll = await srv.bridgePoll('legacy', 0)
    expect(poll.jobs).toHaveLength(1)
    expect(poll.jobs[0].tool).toBe('search')
    expect(srv.bridgeResult(poll.jobs[0].id, true, { hits: [] })).toBe(true)
    expect(await p).toEqual({ ok: true, payload: { hits: [] } })
    const after = await srv.bridgePoll('legacy', 0)
    expect(after.audit.find((a) => a.kind === 'call')?.ok).toBe(true)
  })

  it('опасная операция ждёт человека; отказ — окончателен', async () => {
    srv.resetMcpState()
    const { view } = await srv.issueToken('legacy', 'Секреты', ['secrets:write'], 1)
    const pending = await srv.requestApproval({ ...view, owner: 'legacy' }, 'create_secret', {
      title: 'X',
      fields: [{ name: 'Пароль', value: 'p' }],
    })
    expect(srv.listPending('legacy')).toHaveLength(1)
    expect(srv.approvalState(pending.id, view.id).status).toBe('pending')
    /* Чужой токен не видит чужой запрос. */
    expect(srv.approvalState(pending.id, 'other').status).toBe('unknown')

    expect(await srv.decideApproval('legacy', pending.id, 'reject')).toBe(true)
    expect(srv.approvalState(pending.id, view.id).status).toBe('rejected')
    expect(srv.listPending('legacy')).toHaveLength(0)
    expect(await srv.decideApproval('legacy', pending.id, 'approve', { ok: true, payload: 1 })).toBe(false)
  })
})
