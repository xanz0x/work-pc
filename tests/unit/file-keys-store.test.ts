import { beforeEach, describe, expect, it } from 'vitest'
import { FILE_KEY_PREFIX } from '@/lib/crypto-vault'
import {
  FILE_KEYS_DOC,
  clearFileKeysSync,
  countFileKeyIds,
  fileKeysSnapshot,
  listFileKeyIds,
  loadFileKeys,
  putFileKey,
  readFileKey,
  removeFileKey,
  replaceFileKeys,
  resetFileKeysCache,
  type FileKeyBlob,
} from '@/lib/file-keys-store'
import { docGet, docPut } from '@/lib/db/idb'

const blob = (id: string): FileKeyBlob => ({
  v: 1,
  wct: `wct-${id}`,
  wiv: `wiv-${id}`,
  pct: `pct-${id}`,
  piv: `piv-${id}`,
  kct: `kct-${id}`,
  kiv: `kiv-${id}`,
})

function legacy(id: string, b: Partial<FileKeyBlob> = blob(id)): void {
  localStorage.setItem(FILE_KEY_PREFIX + id, JSON.stringify(b))
}

/**
 * §1.1 хвоста волны 2: обёртки файловых ключей переехали из записи-на-файл
 * в localStorage в один документ-словарь IndexedDB. Главное, что проверяем:
 * инвариант «есть обёртка ⇒ файл открывается» держится до, во время
 * и после переноса, в том числе при частично перенесённом профиле.
 */
describe('словарь обёрток файловых ключей', () => {
  beforeEach(async () => {
    localStorage.clear()
    resetFileKeysCache()
    await docPut(FILE_KEYS_DOC, {})
    resetFileKeysCache()
  })

  it('до загрузки словаря обёртка читается из старой записи localStorage', () => {
    legacy('f1')
    expect(readFileKey('f1')?.wct).toBe('wct-f1')
    expect(countFileKeyIds()).toBe(1)
  })

  it('перенос: словарь получает все ключи, старые записи убираются', async () => {
    legacy('f1')
    legacy('f2')
    const map = await loadFileKeys()
    expect(Object.keys(map).sort()).toEqual(['f1', 'f2'])
    const doc = await docGet<Record<string, FileKeyBlob>>(FILE_KEYS_DOC)
    expect(Object.keys(doc?.value ?? {}).sort()).toEqual(['f1', 'f2'])
    expect(localStorage.getItem(`${FILE_KEY_PREFIX}f1`)).toBeNull()
    expect(localStorage.getItem(`${FILE_KEY_PREFIX}f2`)).toBeNull()
    // Инвариант после переноса: обёртки на месте и читаются.
    expect(readFileKey('f1')?.pct).toBe('pct-f1')
    expect(readFileKey('f2')?.pct).toBe('pct-f2')
  })

  it('частично перенесённый профиль открывается целиком', async () => {
    /* f1 уже в базе, f2 ещё в localStorage — так выглядит прерванный перенос. */
    await docPut(FILE_KEYS_DOC, { f1: blob('f1') })
    resetFileKeysCache()
    legacy('f2')
    /* До загрузки синхронно видна только старая копия — потому загрузка
       словаря и запускается сразу при монтировании хука. */
    expect(listFileKeyIds()).toEqual(['f2'])
    await loadFileKeys()
    expect(readFileKey('f1')).not.toBeNull()
    expect(readFileKey('f2')).not.toBeNull()
    expect(countFileKeyIds()).toBe(2)
  })

  it('база важнее старой копии: переупакованная обёртка не откатывается', async () => {
    await docPut(FILE_KEYS_DOC, { f1: { ...blob('f1'), wct: 'новая-обёртка' } })
    resetFileKeysCache()
    legacy('f1')
    const map = await loadFileKeys()
    expect(map.f1.wct).toBe('новая-обёртка')
  })

  it('маркер миграции стикеров обёрткой не считается', async () => {
    localStorage.setItem(`${FILE_KEY_PREFIX}migrated`, '1')
    expect(listFileKeyIds()).toEqual([])
    await loadFileKeys()
    expect(localStorage.getItem(`${FILE_KEY_PREFIX}migrated`)).toBe('1')
  })

  it('старая запись без поля версии не теряется', async () => {
    legacy('old', { wct: 'w', wiv: 'i' } as Partial<FileKeyBlob>)
    expect(readFileKey('old')?.wct).toBe('w')
    await loadFileKeys()
    expect(readFileKey('old')?.wct).toBe('w')
  })

  it('запись, удаление и полная очистка', async () => {
    await putFileKey('f9', blob('f9'))
    expect(readFileKey('f9')?.kct).toBe('kct-f9')
    await removeFileKey('f9')
    expect(readFileKey('f9')).toBeNull()

    await putFileKey('f10', blob('f10'))
    clearFileKeysSync()
    expect(countFileKeyIds()).toBe(0)
  })

  it('10 000 обёрток живут одним документом и читаются обратно', async () => {
    const many: Record<string, FileKeyBlob> = {}
    for (let i = 0; i < 10_000; i += 1) many[`f${i}`] = blob(`f${i}`)
    expect(await replaceFileKeys(many)).toBe(true)
    resetFileKeysCache()
    const back = await loadFileKeys()
    expect(Object.keys(back)).toHaveLength(10_000)
    expect(back.f9999.wct).toBe('wct-f9999')
    // Ни одной записи localStorage: ровно этого требовала приёмка P0-3.
    expect(Object.keys(fileKeysSnapshot())).toHaveLength(10_000)
    let lsCount = 0
    for (let i = 0; i < localStorage.length; i += 1) {
      if (localStorage.key(i)?.startsWith(FILE_KEY_PREFIX)) lsCount += 1
    }
    expect(lsCount).toBe(0)
  }, 60_000)
})
