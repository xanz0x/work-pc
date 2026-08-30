/* ============================================================
   DB · адаптер для usePersistedState (P0-3)
   Крупные документы — в IndexedDB, мелочь из isLocalOnly — в
   localStorage (нужна синхронно в bootstrap либо не жалко потерять).
   ============================================================ */

import { isLocalOnly } from './schema'
import { docGet, idbAvailable } from './idb'
import { docs } from './repo'
import { migrateLocalStorage } from './migrate'
import { quotaExceeded, reportStorageError, storageOk } from './errors'
import { ensurePersistent, QUOTA_WARN_RATIO, quotaInfo } from './quota'

let ready: Promise<void> | null = null

/** Одна на приложение: миграция + запрос постоянного хранилища + проверка квоты. */
export function storageReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (!idbAvailable()) return
      try {
        await migrateLocalStorage()
      } catch (e) {
        reportStorageError('wf.db', 'write', e instanceof Error ? e.message : 'миграция не удалась')
      }
      void ensurePersistent()
      const q = await quotaInfo()
      if (q && q.ratio !== null && q.ratio >= QUOTA_WARN_RATIO) {
        reportStorageError('wf.db', 'quota', `занято ${Math.round(q.ratio * 100)}% места`)
      }
    })()
  }
  return ready
}

/** Только для тестов: сбросить memo готовности. */
export function resetStorageReady(): void {
  ready = null
}

function lsRead<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}

export async function loadPersisted<T>(key: string): Promise<T | undefined> {
  if (typeof window === 'undefined') return undefined
  if (isLocalOnly(key)) return lsRead<T>(key)
  await storageReady()
  if (!idbAvailable()) return lsRead<T>(key)
  try {
    const doc = await docGet<T>(key)
    // Пока миграция не добралась до ключа, читаем старую копию.
    return doc === undefined ? lsRead<T>(key) : doc.value
  } catch {
    return lsRead<T>(key)
  }
}

/** Последняя запись на ключ побеждает: очередь на ключ, а не общая. */
const queues = new Map<string, Promise<unknown>>()

export function savePersisted<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  if (isLocalOnly(key)) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      storageOk(key)
    } catch (e) {
      reportStorageError(key, quotaExceeded(e) ? 'quota' : 'write', 'localStorage отказал', value)
    }
    return
  }
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(() => storageReady())
    .then(() => docs.put(key, value))
  queues.set(key, next)
  void next
}

/** Повтор всех неудачных записей — из баннера «не сохранилось». */
export function retryPersisted(): Promise<boolean> {
  return import('./errors').then((m) => m.retryStorage((k, v) => docs.put(k, v)))
}
