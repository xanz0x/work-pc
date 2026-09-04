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

/** Свежая страница поверх уже загруженных: новые письма сверху, флаги обновляются, старые страницы остаются. */
export function mergeRows<T extends { uid: number }>(fresh: T[], old: T[]): T[] {
  if (fresh.length === 0) return fresh
  const minFresh = Math.min(...fresh.map((r) => r.uid))
  return [...fresh, ...old.filter((r) => r.uid < minFresh)]
}
