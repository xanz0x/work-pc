import { beforeEach, describe, expect, it } from 'vitest'
import { DB_NAME, DB_VERSION, DOC_STORE, META_STORE, isLocalOnly, isMigratableKey } from '@/lib/db/schema'
import { docGet, docList, docPut, docRemove, metaGet, openDb, resetDbHandle, upgrade } from '@/lib/db/idb'
import { createRepo } from '@/lib/db/repo'
import { migrateLocalStorage } from '@/lib/db/migrate'
import { quotaExceeded, reportStorageError, storageFailures, clearStorageFailures } from '@/lib/db/errors'

function wipe(): Promise<void> {
  resetDbHandle()
  return new Promise((resolve) => {
    const del = indexedDB.deleteDatabase(DB_NAME)
    del.onsuccess = () => resolve()
    del.onerror = () => resolve()
    del.onblocked = () => resolve()
  })
}

/** База версии 1: стор docs без updatedAt и без стора meta. */
function makeV1(records: { key: string; value: unknown }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(DOC_STORE, { keyPath: 'key' })
    }
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(DOC_STORE, 'readwrite')
      for (const r of records) tx.objectStore(DOC_STORE).put(r)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    open.onerror = () => reject(open.error)
  })
}

describe('слой IndexedDB: схема и миграции', () => {
  beforeEach(async () => {
    localStorage.clear()
    clearStorageFailures()
    await wipe()
  })

  it('чистая база открывается на актуальной версии со всеми сторами', async () => {
    const db = await openDb()
    expect(db.version).toBe(DB_VERSION)
    expect(db.objectStoreNames.contains(DOC_STORE)).toBe(true)
    expect(db.objectStoreNames.contains(META_STORE)).toBe(true)
    expect(db.objectStoreNames.contains('journal')).toBe(true)
  })

  it('миграция v1→v3: записи получают updatedAt, появляются сторы meta и journal', async () => {
    await makeV1([{ key: 'wf.notes.v1', value: [{ id: 'n1' }] }])
    resetDbHandle()

    const db = await openDb()
    expect(db.version).toBe(DB_VERSION)
    expect(db.objectStoreNames.contains(META_STORE)).toBe(true)
    expect(db.objectStoreNames.contains('journal')).toBe(true)

    const doc = await docGet<{ id: string }[]>('wf.notes.v1')
    expect(doc?.value).toEqual([{ id: 'n1' }])
    expect(typeof doc?.updatedAt).toBe('number')
  })

  it('апгрейд идемпотентен: повторный вызов не ломает существующие сторы', async () => {
    const db = await openDb()
    expect(() => upgrade(db, db.transaction(DOC_STORE, 'readonly'), DB_VERSION)).not.toThrow()
  })

  it('репозиторий: get/put/patch/remove/list с одним интерфейсом', async () => {
    const repo = createRepo<{ a: number; b?: number }>('wf.test.')
    expect(repo.version).toBe(DB_VERSION)
    expect(await repo.get('x')).toBeUndefined()
    expect(await repo.put('x', { a: 1 })).toBe(true)
    expect(await repo.get('x')).toEqual({ a: 1 })
    expect(await repo.patch('x', { b: 2 })).toBe(true)
    expect(await repo.get('x')).toEqual({ a: 1, b: 2 })
    expect((await repo.list()).map((r) => r.id)).toEqual(['x'])
    expect(await repo.remove('x')).toBe(true)
    expect(await repo.get('x')).toBeUndefined()
  })

  it('10 000 записей переживают закрытие и повторное открытие базы', async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: `f${i}`, name: `файл ${i}` }))
    await docPut('wf.files.v1', rows)
    resetDbHandle()
    const back = await docGet<typeof rows>('wf.files.v1')
    expect(back?.value).toHaveLength(10_000)
    expect(back?.value?.[9_999].id).toBe('f9999')
    await docRemove('wf.files.v1')
  }, 60_000)

  it('миграция из localStorage: копия, проверка чтением, бэкап до второго запуска', async () => {
    localStorage.setItem('wf.notes.v1', JSON.stringify([{ id: 'n1' }]))
    localStorage.setItem('wf.lock.config', JSON.stringify({ enabled: false }))

    const first = await migrateLocalStorage()
    expect(first.copied).toContain('wf.notes.v1')
    // Конфиг замка нужен синхронно в bootstrap — он остаётся в localStorage.
    expect(first.copied).not.toContain('wf.lock.config')
    expect((await docGet('wf.notes.v1'))?.value).toEqual([{ id: 'n1' }])
    // Бэкап на месте: первый запуск ничего не удаляет.
    expect(localStorage.getItem('wf.notes.v1')).not.toBeNull()
    expect(await metaGet('ls.migrated.v1')).toBeTruthy()

    const second = await migrateLocalStorage()
    expect(second.cleaned).toContain('wf.notes.v1')
    expect(localStorage.getItem('wf.notes.v1')).toBeNull()
    expect(localStorage.getItem('wf.lock.config')).not.toBeNull()
    expect((await docGet('wf.notes.v1'))?.value).toEqual([{ id: 'n1' }])
  })

  it('битый JSON в localStorage не теряется молча, а помечается сбойным', async () => {
    localStorage.setItem('wf.broken.v1', '{не json')
    const r = await migrateLocalStorage()
    expect(r.failed).toContain('wf.broken.v1')
    expect(localStorage.getItem('wf.broken.v1')).not.toBeNull()
  })

  it('раскладка ключей: что живёт в localStorage, а что в базе', () => {
    expect(isLocalOnly('wf.lock.config')).toBe(true)
    expect(isLocalOnly('wf.vault.keys.f1')).toBe(true)
    expect(isLocalOnly('wf.secrets.sek.v1')).toBe(true)
    expect(isLocalOnly('wf.files.v1')).toBe(false)
    expect(isMigratableKey('wf.chat.v1')).toBe(true)
    expect(isMigratableKey('other.key')).toBe(false)
  })

  it('ошибка записи попадает в шину, а не в пустой catch', () => {
    reportStorageError('wf.files.v1', 'quota', 'нет места', [1, 2])
    const fails = storageFailures()
    expect(fails).toHaveLength(1)
    expect(fails[0]).toMatchObject({ key: 'wf.files.v1', kind: 'quota' })
    clearStorageFailures()
    expect(storageFailures()).toEqual([])
  })

  it('переполнение квоты распознаётся по имени исключения', () => {
    expect(quotaExceeded(new DOMException('full', 'QuotaExceededError'))).toBe(true)
    expect(quotaExceeded(new Error('storage quota exceeded'))).toBe(true)
    expect(quotaExceeded(new Error('сеть'))).toBe(false)
  })

  it('список документов фильтруется по префиксу', async () => {
    await docPut('wf.a', 1)
    await docPut('other', 2)
    expect((await docList('wf.')).map((d) => d.key)).toEqual(['wf.a'])
  })
})
