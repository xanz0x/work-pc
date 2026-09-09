/* ============================================================
   DB · тонкая обёртка над IndexedDB
   Без зависимостей: промисификация запросов, апгрейд схемы v1→v2 и
   единая точка, где ошибка записи НЕ глушится, а уезжает наверх.
   ============================================================ */

import {
  DB_VERSION,
  DOC_STORE,
  JOURNAL_STORE,
  META_STORE,
  type Doc,
} from './schema'
import { dbName } from './scope'

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB: запрос не выполнен'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: транзакция отменена'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: ошибка транзакции'))
  })
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null

/** Апгрейд схемы. Вынесен наружу, чтобы миграция была покрыта тестом. */
export function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (!db.objectStoreNames.contains(DOC_STORE)) {
    db.createObjectStore(DOC_STORE, { keyPath: 'key' })
  }
  if (oldVersion < 2) {
    if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    // v1 писала записи без updatedAt — добираем, чтобы «последняя запись» была честной.
    const store = tx.objectStore(DOC_STORE)
    const cursorReq = store.openCursor()
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result
      if (!cur) return
      const rec = cur.value as Partial<Doc>
      if (typeof rec?.updatedAt !== 'number') {
        cur.update({ key: String(rec?.key ?? cur.key), value: rec?.value, updatedAt: 0 })
      }
      cur.continue()
    }
  }
  if (oldVersion < 3) {
    // LG-3: журнал безопасности — отдельный стор, только добавление.
    if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
      db.createObjectStore(JOURNAL_STORE, { keyPath: 'seq', autoIncrement: true })
    }
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error('IndexedDB недоступен'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(dbName(), DB_VERSION)
    open.onupgradeneeded = (e) => {
      const tx = open.transaction
      if (tx) upgrade(open.result, tx, e.oldVersion)
    }
    open.onsuccess = () => {
      const db = open.result
      // Другая вкладка попросила апгрейд — отпускаем соединение.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    open.onerror = () => reject(open.error ?? new Error('IndexedDB: база не открылась'))
    open.onblocked = () => reject(new Error('IndexedDB: база занята другой вкладкой'))
  }).catch((e) => {
    dbPromise = null
    throw e
  })
  return dbPromise
}

/** Только для тестов и после смены схемы: следующий вызов откроет базу заново. */
export function resetDbHandle(): void {
  dbPromise = null
}

export async function docGet<T>(key: string): Promise<Doc<T> | undefined> {
  const db = await openDb()
  const tx = db.transaction(DOC_STORE, 'readonly')
  const rec = await req<Doc<T> | undefined>(
    tx.objectStore(DOC_STORE).get(key) as IDBRequest<Doc<T> | undefined>,
  )
  return rec
}

export async function docPut<T>(key: string, value: T): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(DOC_STORE, 'readwrite')
  tx.objectStore(DOC_STORE).put({ key, value, updatedAt: Date.now() } satisfies Doc<T>)
  await done(tx)
}

export async function docRemove(key: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(DOC_STORE, 'readwrite')
  tx.objectStore(DOC_STORE).delete(key)
  await done(tx)
}

export async function docList(prefix = ''): Promise<Doc[]> {
  const db = await openDb()
  const tx = db.transaction(DOC_STORE, 'readonly')
  const all = await req<Doc[]>(tx.objectStore(DOC_STORE).getAll() as IDBRequest<Doc[]>)
  return prefix ? all.filter((d) => d.key.startsWith(prefix)) : all
}

export async function metaGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  const tx = db.transaction(META_STORE, 'readonly')
  return req<T | undefined>(tx.objectStore(META_STORE).get(key) as IDBRequest<T | undefined>)
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).put(value, key)
  await done(tx)
}

/** Версия схемы открытой базы — для диагностики в настройках. */
export async function schemaVersion(): Promise<number> {
  const db = await openDb()
  return db.version
}

/* ---------- журнал безопасности (LG-3) ---------- */

/**
 * Добавить запись журнала. Только добавление: обновления и удаления в этом
 * сторе не предусмотрены ни одним путём кода.
 */
export async function journalAppend<T extends object>(entry: T): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(JOURNAL_STORE, 'readwrite')
  tx.objectStore(JOURNAL_STORE).add(entry)
  await done(tx)
}

export async function journalAll<T>(): Promise<T[]> {
  const db = await openDb()
  const tx = db.transaction(JOURNAL_STORE, 'readonly')
  return req<T[]>(tx.objectStore(JOURNAL_STORE).getAll() as IDBRequest<T[]>)
}
