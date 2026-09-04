import { describe, expect, it } from 'vitest'
import { extractCode } from '@/lib/mail-format'
import { mtRows, sortRows, spRows } from '@/lib/temp-mail-parse'

describe('временная почта · разбор ответов провайдеров', () => {
  const mtMsg = { id: 'abc123', subject: 'Код входа', from: { address: 'noreply@site.io', name: 'Site' }, createdAt: '2026-06-01T10:00:00+00:00' }

  it('mail.tm: hydra-коллекция', () => {
    expect(mtRows({ 'hydra:member': [mtMsg] })).toEqual([{ mid: 'abc123', subject: 'Код входа', from: 'Site', date: '2026-06-01T10:00:00.000Z' }])
  })

  it('mail.tm: плоский массив (Accept: application/json)', () => {
    expect(mtRows([mtMsg])[0].mid).toBe('abc123')
  })

  it('mail.tm: без имени отправителя берётся адрес, мусор не роняет разбор', () => {
    expect(mtRows([{ id: 'x', from: { address: 'a@b.io' } }])[0]).toEqual({ mid: 'x', subject: '', from: 'a@b.io', date: null })
    expect(mtRows(null)).toEqual([])
    expect(mtRows({ messages: [] })).toEqual([])
  })

  it('SmailPro: {messages:[…]}', () => {
    const rows = spRows({ messages: [{ mid: 'm1', textSubject: 'Hello', textFrom: 'GitHub', textDate: '2026-05-30T10:15:00Z' }] })
    expect(rows).toEqual([{ mid: 'm1', subject: 'Hello', from: 'GitHub', date: '2026-05-30T10:15:00.000Z' }])
    expect(spRows(null)).toEqual([])
  })

  it('новые письма оказываются сверху', () => {
    const rows = sortRows([
      { mid: 'a', subject: '', from: '', date: '2026-06-01T10:00:00.000Z' },
      { mid: 'b', subject: '', from: '', date: '2026-06-02T10:00:00.000Z' },
      { mid: 'c', subject: '', from: '', date: null },
    ])
    expect(rows.map((r) => r.mid)).toEqual(['b', 'a', 'c'])
  })
})

describe('временная почта · код подтверждения', () => {
  it('берёт код рядом со словом «код»', () => {
    expect(extractCode(null, 'Ваш код подтверждения: 483920. Никому его не сообщайте.')).toBe('483920')
  })

  it('понимает англоязычные письма и HTML', () => {
    expect(extractCode('<p>Your verification <b>code</b> is <strong>91 234</strong></p>', null)).toBe(null)
    expect(extractCode('<p>Your verification code is <strong>912345</strong></p>', null)).toBe('912345')
  })

  it('берёт буквенно-цифровой код', () => {
    expect(extractCode(null, 'Code: A1B2C3')).toBe('A1B2C3')
  })

  it('без ключевых слов берёт отдельное 4–8-значное число', () => {
    expect(extractCode(null, 'Подтвердите вход: 1234')).toBe('1234')
  })

  it('игнорирует даты, суммы и годы в тексте без кода', () => {
    expect(extractCode(null, 'Счёт на 1 200,50 от 12.03.2026')).toBe(null)
  })

  it('пустое письмо — без кода', () => {
    expect(extractCode(null, null)).toBe(null)
    expect(extractCode('<div><style>.a{color:#123456}</style>Привет</div>', null)).toBe(null)
  })
})
