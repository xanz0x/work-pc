/* ============================================================
   DB · репозитории (P0-3)
   Один интерфейс на все хранилища: get/put/patch/remove/list + версия
   схемы. Ошибки записи не глушатся: они уходят в шину storage-errors,
   а интерфейс показывает «не сохранилось» с кнопкой «Повторить».
   ============================================================ */

import { DB_VERSION } from './schema'
import { docGet, docList, docPut, docRemove, idbAvailable } from './idb'
import { quotaExceeded, reportStorageError, storageOk } from './errors'

export type Repo<T> = {
  /** Версия схемы, под которую написан репозиторий. */
  readonly version: number
  get(id: string): Promise<T | undefined>
  put(id: string, value: T): Promise<boolean>
  patch(id: string, patch: Partial<T>): Promise<boolean>
  remove(id: string): Promise<boolean>
  list(): Promise<{ id: string; value: T; updatedAt: number }[]>
}

/** Репозиторий над стором документов: ключ = `${prefix}${id}`. */
export function createRepo<T>(prefix: string): Repo<T> {
  const full = (id: string) => `${prefix}${id}`

  const write = async (key: string, value: T): Promise<boolean> => {
    if (!idbAvailable()) {
      reportStorageError(key, 'write', 'IndexedDB недоступен в этом браузере', value)
      return false
    }
    try {
      await docPut(key, value)
      storageOk(key)
      return true
    } catch (e) {
      const kind = quotaExceeded(e) ? 'quota' : 'write'
      reportStorageError(key, kind, e instanceof Error ? e.message : 'ошибка записи', value)
      return false
    }
  }

  return {
    version: DB_VERSION,
    async get(id) {
      if (!idbAvailable()) return undefined
      try {
        return (await docGet<T>(full(id)))?.value
      } catch {
        return undefined
      }
    },
    put(id, value) {
      return write(full(id), value)
    },
    async patch(id, patch) {
      const cur = (await docGet<T>(full(id)))?.value
      const next = { ...(cur ?? ({} as T)), ...patch } as T
      return write(full(id), next)
    },
    async remove(id) {
      try {
        await docRemove(full(id))
        return true
      } catch (e) {
        reportStorageError(full(id), 'write', e instanceof Error ? e.message : 'ошибка удаления')
        return false
      }
    },
    async list() {
      if (!idbAvailable()) return []
      const docs = await docList(prefix)
      return docs.map((d) => ({
        id: d.key.slice(prefix.length),
        value: d.value as T,
        updatedAt: d.updatedAt,
      }))
    },
  }
}

/** Репозиторий состояний интерфейса и архива: ключи `wf.*` как есть. */
export const docs = createRepo<unknown>('')
