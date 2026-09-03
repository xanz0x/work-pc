/* ============================================================
   NF-8 · ФЛАГИ И АВТОНОМНЫЙ РЕЖИМ
   Флаги обязаны переживать перезагрузку (проверяем через сброс кэша:
   ровно то, что делает новая загрузка страницы), а обёртка над сетью —
   не пускать наружу ни один из четырёх способов уйти с устройства.
   ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FLAGS,
  FLAGS_KEY,
  isFlagOn,
  isOffline,
  readFlags,
  resetFlagsCache,
  setFlag,
  setOffline,
} from '@/lib/flags'
import {
  NetBlockedError,
  blockedAttempts,
  blockedCount,
  classifyTarget,
  clearBlocked,
  installNetGuard,
  targetLabel,
} from '@/lib/net'

/* Обёртки ставятся один раз на файл — как в браузере на страницу. */
const localFetch = vi.fn(async () => ({ ok: true }) as unknown as Response)
;(globalThis as unknown as Record<string, unknown>).fetch = localFetch

class FakeSocket {
  url: string
  constructor(url: string) {
    this.url = url
  }
}
;(globalThis as unknown as Record<string, unknown>).WebSocket = FakeSocket

installNetGuard()

beforeEach(() => {
  localStorage.clear()
  resetFlagsCache()
  clearBlocked()
  localFetch.mockClear()
})

describe('NF-8 · флаги', () => {
  it('по умолчанию всё выключено', () => {
    expect(readFlags()).toEqual(DEFAULT_FLAGS)
    expect(isOffline()).toBe(false)
    expect(isFlagOn('dev')).toBe(false)
  })

  it('флаги переживают перезагрузку страницы', () => {
    setFlag('dev', true)
    setFlag('mcp.skeleton', true)
    setOffline(true)

    /* Новая загрузка: кэша в памяти нет, есть только localStorage. */
    resetFlagsCache()
    const after = readFlags()
    expect(after.flags.dev).toBe(true)
    expect(after.flags['mcp.skeleton']).toBe(true)
    expect(after.flags.experimental).toBe(false)
    expect(after.offline).toBe(true)
  })

  it('мусор в хранилище не ломает флаги', () => {
    localStorage.setItem(FLAGS_KEY, '{это не json')
    resetFlagsCache()
    expect(readFlags()).toEqual(DEFAULT_FLAGS)

    localStorage.setItem(FLAGS_KEY, JSON.stringify({ flags: { dev: 'да' }, offline: 'ага' }))
    resetFlagsCache()
    expect(readFlags().flags.dev).toBe(false)
    expect(readFlags().offline).toBe(false)
  })
})

describe('NF-8 · классификация адреса', () => {
  it('свой origin — локально, чужой — наружу', () => {
    expect(classifyTarget('/ai-api/sessions')).toBe('local')
    expect(classifyTarget('/_next/static/chunk.js')).toBe('local')
    expect(classifyTarget('http://localhost/ai-api/engine')).toBe('local')
    expect(classifyTarget('https://example.com/track')).toBe('external')
    expect(classifyTarget('wss://chat.example.com/socket')).toBe('external')
  })

  it('свои маршруты, которые ходят наружу за нас, считаются исходящими', () => {
    expect(classifyTarget('/proxy/favicon?domain=example.com')).toBe('egress')
    expect(classifyTarget('/ai-api/chat', JSON.stringify({ engine: 'cloud' }))).toBe('egress')
    expect(classifyTarget('/ai-api/chat', JSON.stringify({ engine: 'hybrid' }))).toBe('egress')
    expect(classifyTarget('/ai-api/chat', JSON.stringify({ engine: 'local' }))).toBe('local')
    expect(classifyTarget('/ai-api/telemetry', '{"kind":"client-error"}')).toBe('local')
  })

  it('неразобранный адрес считается внешним', () => {
    expect(classifyTarget(null)).toBe('external')
    expect(targetLabel('/proxy/favicon')).toBe('/proxy/favicon')
  })
})

describe('NF-8 · автономный режим запрещает исходящие', () => {
  it('сеть разрешена — обёртка не мешает', async () => {
    await expect(fetch('https://example.com/api')).resolves.toBeTruthy()
    expect(localFetch).toHaveBeenCalledTimes(1)
    expect(blockedCount()).toBe(0)
  })

  it('в автономном режиме внешних запросов нет', async () => {
    setOffline(true)

    await expect(fetch('https://example.com/api')).rejects.toBeInstanceOf(NetBlockedError)
    await expect(fetch('/proxy/favicon?domain=example.com')).rejects.toBeInstanceOf(NetBlockedError)
    await expect(
      fetch('/ai-api/chat', { method: 'POST', body: JSON.stringify({ engine: 'cloud' }) }),
    ).rejects.toBeInstanceOf(NetBlockedError)

    /* ни один запрещённый запрос не дошёл до настоящего fetch */
    expect(localFetch).not.toHaveBeenCalled()

    /* локальная работа продолжается */
    await expect(fetch('/ai-api/sessions')).resolves.toBeTruthy()
    await expect(
      fetch('/ai-api/chat', { method: 'POST', body: JSON.stringify({ engine: 'local' }) }),
    ).resolves.toBeTruthy()
    expect(localFetch).toHaveBeenCalledTimes(2)

    const log = blockedAttempts()
    expect(log).toHaveLength(3)
    expect(log.map((b) => b.kind)).toEqual(['egress', 'egress', 'external'])
    expect(log.every((b) => b.via === 'fetch')).toBe(true)
  })

  it('WebSocket наружу в автономном режиме не открывается', () => {
    setOffline(true)
    const Sock = (globalThis as unknown as { WebSocket: new (u: string) => unknown }).WebSocket
    expect(() => new Sock('wss://chat.example.com/socket')).toThrow(NetBlockedError)
    expect(() => new Sock('/live')).not.toThrow()
    expect(blockedCount()).toBe(1)
  })

  it('счётчик запретов очищается по требованию', async () => {
    setOffline(true)
    await expect(fetch('https://example.com/x')).rejects.toBeInstanceOf(NetBlockedError)
    expect(blockedCount()).toBe(1)
    clearBlocked()
    expect(blockedCount()).toBe(0)
  })
})
