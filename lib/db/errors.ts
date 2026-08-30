/* ============================================================
   DB · шина ошибок записи (P0-3, шаг 5)
   Раньше `catch {}` — данные молча не сохранялись. Теперь каждая
   неудачная запись помнит своё значение, чтобы «Повторить» имело смысл.
   ============================================================ */

export type StorageFailKind = 'write' | 'quota'

export type StorageFailure = {
  key: string
  kind: StorageFailKind
  message: string
  at: number
}

type Pending = StorageFailure & { value?: unknown }

const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()

export function quotaExceeded(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  }
  return e instanceof Error && /quota|exceed/i.test(e.message)
}

function emit(): void {
  listeners.forEach((l) => l())
}

export function reportStorageError(
  key: string,
  kind: StorageFailKind,
  message: string,
  value?: unknown,
): void {
  pending.set(key, { key, kind, message, at: Date.now(), value })
  console.error(`[storage] ${kind} ${key}: ${message}`)
  emit()
}

/** Успешная запись снимает прошлую жалобу по этому ключу. */
export function storageOk(key: string): void {
  if (pending.delete(key)) emit()
}

export function subscribeStorage(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function storageFailures(): StorageFailure[] {
  return [...pending.values()].map(({ key, kind, message, at }) => ({ key, kind, message, at }))
}

/** Повторная запись всех неудачных значений; true — всё село. */
export async function retryStorage(
  write: (key: string, value: unknown) => Promise<boolean>,
): Promise<boolean> {
  const items = [...pending.values()]
  let allOk = true
  for (const it of items) {
    if (it.value === undefined) {
      pending.delete(it.key)
      continue
    }
    const ok = await write(it.key, it.value)
    if (!ok) allOk = false
  }
  emit()
  return allOk
}

export function clearStorageFailures(): void {
  pending.clear()
  emit()
}
