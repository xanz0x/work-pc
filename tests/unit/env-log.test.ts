import { describe, expect, it, vi, afterEach } from 'vitest'
import { assertEnv, readEnv } from '@/lib/env'
import { ipTag, log, startRequest } from '@/lib/log'

const full = {
  APP_PASSWORD: 'пароль-приложения',
  APP_SESSION_SECRET: 'a'.repeat(64),
}

describe('валидация окружения (AR-5)', () => {
  it('полная конфигурация проходит', () => {
    const r = readEnv(full)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.present).toContain('APP_PASSWORD')
  })

  it('без обязательных переменных сервер не должен стартовать', () => {
    const r = readEnv({})
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('APP_PASSWORD')
    expect(() => assertEnv({})).toThrow(/Конфигурация неполная/)
  })

  it('короткий секрет сессии отвергается', () => {
    const r = readEnv({ ...full, APP_SESSION_SECRET: 'коротко' })
    expect(r.ok).toBe(false)
  })

  it('адрес шлюза проверяется на схему', () => {
    expect(readEnv({ ...full, AI_PROXY_URL: 'ftp://x' }).ok).toBe(false)
    expect(readEnv({ ...full, AI_PROXY_URL: 'https://x/llm' }).ok).toBe(true)
  })

  it('облачный движок считается настроенным только с ключом и адресом', () => {
    expect(readEnv({ ...full, AI_PROXY_URL: 'https://x' }).cloudReady).toBe(false)
    expect(
      readEnv({ ...full, AI_PROXY_URL: 'https://x', EMERGENT_LLM_KEY: 'sk-длинный-ключ' }).cloudReady,
    ).toBe(true)
  })

  it('значения переменных наружу не отдаются — только имена', () => {
    const r = readEnv(full)
    expect(JSON.stringify(r)).not.toContain('пароль-приложения')
  })
})

describe('структурированный лог (AR-5)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('в лог попадают только разрешённые поля: фильтр PII', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log('info', 'test', {
      rid: 'abc',
      route: '/ai-api/chat',
      // @ts-expect-error поле не входит в схему: не должно попасть в строку
      fileName: 'паспорт.pdf',
    })
    const line = spy.mock.calls[0][0] as string
    expect(line).toContain('"rid":"abc"')
    expect(line).not.toContain('паспорт')
  })

  it('уровень ниже порога не пишется', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log('debug', 'quiet')
    expect(spy).not.toHaveBeenCalled()
  })

  it('request-id уникален, латентность считается', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const a = startRequest('/x', 'GET')
    const b = startRequest('/x', 'GET')
    expect(a.rid).not.toBe(b.rid)
    expect(a.done(200)).toBeGreaterThanOrEqual(0)
  })

  it('адрес пишется хешем, а не как есть', () => {
    expect(ipTag('10.1.2.3')).not.toContain('10.1')
    expect(ipTag('10.1.2.3')).toBe(ipTag('10.1.2.3'))
  })
})
