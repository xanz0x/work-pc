import type { Page } from '@playwright/test'

/**
 * Чтение документа из IndexedDB приложения из теста.
 * Осторожно: `indexedDB.open('workflow')` без версии СОЗДАЁТ базу версии 1
 * без стора `docs`, если приложение ещё не успело её открыть — дальше
 * `transaction('docs')` бросает NotFoundError, а апгрейд приложения блокируется.
 * Поэтому сначала проверяем, что база уже существует и стор на месте.
 */
export function readDoc<T>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate(async (k) => {
    const dbs = (await indexedDB.databases?.()) ?? []
    if (!dbs.some((d) => d.name === 'workflow')) return undefined
    return new Promise<T | undefined>((resolve) => {
      const open = indexedDB.open('workflow')
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('docs')) {
          db.close()
          resolve(undefined)
          return
        }
        const req = db.transaction('docs', 'readonly').objectStore('docs').get(k)
        req.onsuccess = () => resolve((req.result as { value?: T } | undefined)?.value)
        req.onerror = () => resolve(undefined)
      }
      open.onerror = () => resolve(undefined)
    })
  }, key) as Promise<T | undefined>
}
