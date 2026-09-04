/* ПОЧТА · форматирование для списка и карточки письма (клиент). */

import type { Addr } from './mail-client'

export const addrLabel = (a: Addr | null | undefined): string => (a ? a.name?.trim() || a.address : '—')

export const addrFull = (a: Addr): string => (a.name?.trim() ? `${a.name.trim()} <${a.address}>` : a.address)

/** Сегодня — время, в этом году — «12 июн», иначе — дата с годом. */
export function fmtMailDate(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export const fmtMailDateFull = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

export const letterWord = (n: number): string => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'письмо'
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 'письма'
  return 'писем'
}

export const REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'вручную' },
  { value: 30, label: 'каждые 30 с' },
  { value: 60, label: 'каждую минуту' },
  { value: 300, label: 'каждые 5 мин' },
]

export const REFRESH_KEY = 'wf.mail.refresh.v1'

export function readRefresh(): number {
  if (typeof window === 'undefined') return 60
  const raw = window.localStorage.getItem(REFRESH_KEY)
  if (raw === null) return 60
  const n = Number(raw)
  return REFRESH_OPTIONS.some((o) => o.value === n) ? n : 60
}

const CODE_TOKEN = /(?<![A-Za-z0-9])(?:(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}|\d{4,8})(?![A-Za-z0-9])/g
const CODE_WORDS = /код|code|otp|pin|пароль|verification|подтвержд/i
const CODE_ANY = /(?<![A-Za-z0-9.,:/-])(\d{4,8})(?![A-Za-z0-9.,:/-])/

/** Код подтверждения из письма: сперва токен, рядом с которым стоят слова «код/code/OTP», иначе отдельное 4–8-значное число. */
export function extractCode(html: string | null, text: string | null): string | null {
  const raw = `${text ?? ''}\n${(html ?? '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')}`
  const body = raw.replace(/&nbsp;|&#160;/gi, ' ').replace(/[\u00a0\u200b]/g, ' ')
  for (const m of body.matchAll(CODE_TOKEN)) {
    const before = body.slice(Math.max(0, (m.index ?? 0) - 60), m.index)
    if (CODE_WORDS.test(before)) return m[0]
  }
  const any = body.match(CODE_ANY)
  return any ? any[1] : null
}

/** Код прямо из темы письма — показываем в списке только когда тема явно про код. */
export function subjectCode(subject: string): string | null {
  if (!CODE_WORDS.test(subject)) return null
  return extractCode(null, subject)
}

/** Свежая страница поверх уже загруженных: новые письма сверху, флаги обновляются, старые страницы остаются. */export function mergeRows<T extends { uid: number }>(fresh: T[], old: T[]): T[] {
  if (fresh.length === 0) return fresh
  const minFresh = Math.min(...fresh.map((r) => r.uid))
  return [...fresh, ...old.filter((r) => r.uid < minFresh)]
}
