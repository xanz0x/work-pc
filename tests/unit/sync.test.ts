/* ============================================================
   NF-11 · CRDT сходится, сервер слеп
   Два устройства правят одно и то же в разном порядке и получают одно
   состояние; удаление и воскрешение упорядочены метками; повтор доставки
   не меняет состояния. Сервер: на диске нет ни одного плейнтекста, ключ
   выводится из фразы, а из идентификатора пространства — нет.
   ============================================================ */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyOp, diffLocal, emptyState, makeClock, materialize, type Op } from '@/lib/sync/crdt'
import { keysFromEntropy, keysFromWords, openOps, sealOps, wordsFromEntropy } from '@/lib/sync/crypto'

const dir = mkdtempSync(join(tmpdir(), 'wsx-sync-'))
process.env.AI_DIR = dir
type Srv = typeof import('@/lib/sync-server')
let srv: Srv
beforeAll(async () => {
  srv = await import('@/lib/sync-server')
  srv.resetSyncState()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

type Note = { id: string; title: string; tags: string[] }

function device(name: string) {
  const state = emptyState()
  const clock = makeClock(name)
  let n = 0
  return {
    state,
    local(list: Note[]): Op[] {
      return diffLocal(state, 'notes', list, clock, () => ++n)
    },
    recv(ops: Op[]) {
      for (const op of ops) {
        clock.observe(op.ts)
        applyOp(state, op)
      }
    },
    view(): Note[] {
      return materialize<Note>(state, 'notes').sort((a, b) => a.id.localeCompare(b.id))
    },
  }
}

describe('CRDT', () => {
  it('две правки разных полей сливаются, порядок доставки не важен', () => {
    const a = device('a')
    const b = device('b')
    const base = [{ id: 'n1', title: 'Черновик', tags: ['x'] }]
    const opsA0 = a.local(base)
    b.recv(opsA0)
    const opsA = a.local([{ id: 'n1', title: 'Заголовок от A', tags: ['x'] }])
    const opsB = b.local([{ id: 'n1', title: 'Черновик', tags: ['x', 'от-b'] }])
    a.recv(opsB)
    b.recv(opsA)
    expect(a.view()).toEqual(b.view())
    expect(a.view()[0]).toEqual({ id: 'n1', title: 'Заголовок от A', tags: ['x', 'от-b'] })
    /* Повторная доставка — пустая операция. */
    const before = JSON.stringify(a.state)
    a.recv(opsB)
    expect(JSON.stringify(a.state)).toBe(before)
  })

  it('одно поле с двух сторон: побеждает поздняя метка, обе стороны согласны', () => {
    const a = device('a')
    const b = device('b')
    b.recv(a.local([{ id: 'n1', title: 't', tags: [] }]))
    const opsA = a.local([{ id: 'n1', title: 'A', tags: [] }])
    const opsB = b.local([{ id: 'n1', title: 'B', tags: [] }])
    a.recv(opsB)
    b.recv(opsA)
    expect(a.view()).toEqual(b.view())
  })

  it('удаление и воскрешение упорядочены; удалённое исчезает у всех', () => {
    const a = device('a')
    const b = device('b')
    b.recv(a.local([{ id: 'n1', title: 't', tags: [] }, { id: 'n2', title: 'u', tags: [] }]))
    const del = a.local([{ id: 'n2', title: 'u', tags: [] }])
    expect(del[0]).toMatchObject({ del: true, id: 'n1' })
    b.recv(del)
    expect(b.view().map((n) => n.id)).toEqual(['n2'])
    /* Позднее восстановление на B побеждает более раннее удаление. */
    const res = b.local([{ id: 'n1', title: 'снова', tags: [] }, { id: 'n2', title: 'u', tags: [] }])
    a.recv(res)
    expect(a.view()).toEqual(b.view())
    expect(a.view().find((n) => n.id === 'n1')?.title).toBe('снова')
  })
})

describe('слепой сервер', () => {
  it('ключ выводится из фразы, идентификатор пространства ключа не раскрывает', async () => {
    const entropy = new Uint8Array(16).map((_, i) => i * 7 + 1)
    const words = await wordsFromEntropy(entropy)
    expect(words).toHaveLength(12)
    const k1 = await keysFromEntropy(entropy)
    const k2 = await keysFromWords(words)
    expect(k2?.spaceId).toBe(k1.spaceId)
    expect(k2?.spacePass).toBe(k1.spacePass)
    expect(k1.spaceId).not.toContain(k1.spacePass.slice(0, 8))
    expect(await keysFromWords([...words.slice(0, 11), 'zoo'])).toBeNull()
  })

  it('на диске только шифртекст; чужой ключ не открывает; пароль пространства проверяется', async () => {
    const ent = crypto.getRandomValues(new Uint8Array(16))
    const keys = await keysFromEntropy(ent)
    const other = await keysFromEntropy(crypto.getRandomValues(new Uint8Array(16)))
    const label = await (await import('@/lib/sync/crypto')).sealJson(keys.key, 'Ноутбук Ирины')
    const reg = await srv.registerDevice(keys.spaceId, keys.spacePass, 'aaaaaaaaaaaaaaaa', label)
    expect(reg.ok).toBe(true)
    if (!reg.ok) return
    const auth = await srv.authDevice(keys.spaceId, 'aaaaaaaaaaaaaaaa', reg.token)
    expect(auth).not.toBeNull()

    const ops: Op[] = [{ col: 'notes', id: 'n1', ts: 1, dev: 'aaaaaaaaaaaaaaaa', n: 1, set: { title: 'СОВЕРШЕННО СЕКРЕТНО' } }]
    await srv.pushOps(auth!, [await sealOps(keys.key, ops)])

    const files = readdirSync(join(dir, 'sync', keys.spaceId))
    const disk = files.map((f) => readFileSync(join(dir, 'sync', keys.spaceId, f), 'utf8')).join('\n')
    expect(disk).not.toContain('СОВЕРШЕННО')
    expect(disk).not.toContain('Ноутбук')
    expect(disk).not.toContain(keys.spacePass)

    const pulled = await srv.pullOps({ ...auth!, device: { ...auth!.device, id: 'bbbbbbbbbbbbbbbb' } }, 0, 0)
    expect(pulled.ops).toHaveLength(1)
    expect(await openOps(other.key, pulled.ops[0])).toBeNull()
    expect(await openOps(keys.key, pulled.ops[0])).toEqual(ops)

    const wrong = await srv.registerDevice(keys.spaceId, other.spacePass, 'cccccccccccccccc', label)
    expect(wrong).toEqual({ ok: false, code: 'WRONG_PASS' })
    expect(await srv.authDevice(keys.spaceId, 'aaaaaaaaaaaaaaaa', 'bad')).toBeNull()

    expect(await srv.revokeDevice(auth!.space, 'aaaaaaaaaaaaaaaa')).toBe(true)
    expect(await srv.authDevice(keys.spaceId, 'aaaaaaaaaaaaaaaa', reg.token)).toBeNull()
    expect(await srv.registerDevice(keys.spaceId, keys.spacePass, 'aaaaaaaaaaaaaaaa', label)).toEqual({ ok: false, code: 'REVOKED' })
  })
})
