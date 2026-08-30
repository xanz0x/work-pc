/* ============================================================
   DB · квота (P0-3, шаг 4)
   Честный ответ на вопрос «сколько места осталось». Переполнение
   показывается пользователем экраном, а не тихим сбоем записи.
   ============================================================ */

export type QuotaInfo = {
  usage: number
  quota: number
  /** Доля занятого места, 0…1; null — браузер не сказал. */
  ratio: number | null
  persisted: boolean
}

export async function quotaInfo(): Promise<QuotaInfo | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const est = await navigator.storage.estimate()
    const usage = est.usage ?? 0
    const quota = est.quota ?? 0
    let persisted = false
    try {
      persisted = (await navigator.storage.persisted?.()) ?? false
    } catch {
      /* Safari до 17 не умеет persisted() */
    }
    return { usage, quota, ratio: quota > 0 ? usage / quota : null, persisted }
  } catch {
    return null
  }
}

/** Просим постоянное хранилище: без него браузер вправе вычистить архив. */
export async function ensurePersistent(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

/** Порог, после которого предупреждаем заранее (место ещё есть). */
export const QUOTA_WARN_RATIO = 0.9
