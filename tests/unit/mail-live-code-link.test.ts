/* QA (живые письма): проверка «код/ссылка» на настоящих письмах, доставленных
   на временный ящик mail.tm (fixture снят с ответа /messages/:mid).
   Файл fixture: tests/unit/fixtures/qa-live-mail.json */

import { describe, expect, it } from 'vitest'
import letters from './fixtures/qa-live-mail.json'
import { extractActionLink, extractCode } from '@/lib/mail-format'

type Letter = { subject: string; html: string | null; text: string | null }
const bySubject = (s: string): Letter => (letters as Letter[]).find((l) => l.subject.startsWith(s))!

describe('живые письма · код и ссылка-кнопка', () => {
  it('письмо-подтверждение без кода: кода нет, ссылка есть', () => {
    const m = bySubject('QA1')
    expect(extractCode(m.html, m.text, m.subject)).toBe(null)
    const link = extractActionLink(m.html, m.text)
    expect(link?.url).toContain('awstrack.me')
    expect(link?.url).not.toContain('unsubscribe')
  })

  it('письмо с кодом: код и ссылка вместе', () => {
    const m = bySubject('QA2')
    expect(extractCode(m.html, m.text, m.subject)).toBe('483920')
    expect(extractActionLink(m.html, m.text)?.url).toBe('https://site.example/verify/zx9')
  })

  it('обычное письмо: ни кода, ни ссылки', () => {
    const m = bySubject('QA3')
    expect(extractCode(m.html, m.text, m.subject)).toBe(null)
    expect(extractActionLink(m.html, m.text)).toBe(null)
  })
})
