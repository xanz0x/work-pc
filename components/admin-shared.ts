/* Общие помощники экрана администрирования. */

export const fmtDate = (at: number | null) =>
  at ? new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export const fmtDay = (at: number) => new Date(at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** Остаток лицензии словами и тон: зелёный / жёлтый (≤ 7 дн.) / красный (истекла или нет). */
export function fmtLeft(until: number | null): { text: string; tone: '' | 'warn' | 'danger'; days: number } {
  if (!until) return { text: 'нет лицензии', tone: 'danger', days: 0 }
  const days = Math.ceil((until - Date.now()) / 86_400_000)
  if (days <= 0) return { text: `истекла ${fmtDay(until)}`, tone: 'danger', days: 0 }
  return { text: `${days} дн. · до ${fmtDay(until)}`, tone: days <= 7 ? 'warn' : '', days }
}

export function genPassword(): string {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => a[b % a.length]).join('')
}

export async function adminFetch<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }).catch(() => null)
  if (!r) return { ok: false, error: 'Сервер не ответил' }
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) return { ok: false, error: j?.error ?? `HTTP ${r.status}` }
  return { ok: true, data: j as T }
}
