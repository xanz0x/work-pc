/* Общие помощники экрана администрирования. */

export const fmtDate = (at: number | null) =>
  at ? new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export function genPassword(): string {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => a[b % a.length]).join('')
}

const ACCESS_LABEL = { ok: 'работает', blocked: 'заблокирован', license: 'ждёт лицензию', password: 'сменит пароль' } as const

export async function adminFetch<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }).catch(() => null)
  if (!r) return { ok: false, error: 'Сервер не ответил' }
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) return { ok: false, error: j?.error ?? `HTTP ${r.status}` }
  return { ok: true, data: j as T }
}

