/* ВРЕМЕННАЯ ПОЧТА · разбор ответов провайдеров. Чистые функции: mail.tm отдаёт коллекцию
   и hydra-объектом, и плоским массивом (зависит от заголовка Accept), SmailPro — {messages:[…]}. */

export type TempRow = { mid: string; subject: string; from: string; date: string | null }

export const MID_RE = /^[A-Za-z0-9_.:@+=-]{1,200}$/

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')

const iso = (v: unknown): string | null => {
  const s = asStr(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function mtRows(body: unknown): TempRow[] {
  const list = Array.isArray(body) ? body : ((body as { 'hydra:member'?: unknown[] } | null)?.['hydra:member'] ?? [])
  return list.map((raw) => {
    const m = raw as { id?: string; subject?: string; from?: { address?: string; name?: string }; createdAt?: string }
    return { mid: asStr(m.id), subject: asStr(m.subject), from: asStr(m.from?.name).trim() || asStr(m.from?.address) || '—', date: iso(m.createdAt) }
  })
}

export function spRows(body: unknown): TempRow[] {
  const list = (body as { messages?: unknown[] } | null)?.messages ?? []
  return list.map((raw) => {
    const m = raw as { mid?: string; textSubject?: string; textFrom?: string; textDate?: string }
    return { mid: asStr(m.mid), subject: asStr(m.textSubject), from: asStr(m.textFrom) || '—', date: iso(m.textDate) }
  })
}

/** Новые письма сверху: провайдеры отдают порядок как попало. */
export const sortRows = (rows: TempRow[]): TempRow[] => [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
