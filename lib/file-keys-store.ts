/* ============================================================
   FILE-KEYS STORE · обёртки файловых ключей (§1.1 хвоста волны 2)
   Раньше каждая обёртка была отдельной записью localStorage
   (`wf.vault.keys.<id>`): на 10 000 файлов это 10 000 записей в
   хранилище на 5 МБ. Теперь все обёртки живут ОДНИМ документом-словарём
   в IndexedDB, а в localStorage остаётся только SEK и конфиг замка.

   Инвариант «locked ⇒ шифртекст существует» держится так:
   — чтение всегда объединяет словарь из базы и старые ключи localStorage,
     поэтому частично перенесённый профиль открывается полностью;
   — старая запись localStorage удаляется ТОЛЬКО после того, как словарь
     успешно записан и прочитан обратно.
   ============================================================ */

import { FILE_KEY_PREFIX } from './crypto-vault'
import { docGet, idbAvailable } from './db/idb'
import { docs } from './db/repo'

/** Ключ документа-словаря. В localStorage не попадает (см. isLocalOnly). */
export const FILE_KEYS_DOC = 'wf.filekeys.map.v1'

export type FileKeyBlob = {
  /** Версия обёртки. У самых старых записей её могло не быть. */
  v?: 1
  /** обёртка мастера: AES-GCM(masterKey, fileKeyRaw-b64). */
  wct: string
  wiv: string
  /** обёртка пароля файла. */
  pct: string
  piv: string
  /** верификатор под самим файловым ключом. */
  kct: string
  kiv: string
  /** зашифрованное описание. */
  dct?: string
  div?: string
}

export type FileKeyMap = Record<string, FileKeyBlob>

/**
 * Достаточное условие «это обёртка»: обёртка мастера на месте.
 * Строже проверять нельзя — иначе старая запись пропадёт молча, а инвариант
 * «locked ⇒ шифртекст существует» требует обратного: ничего не терять.
 */
function isBlob(x: unknown): x is FileKeyBlob {
  if (typeof x !== 'object' || x === null) return false
  const b = x as Partial<FileKeyBlob>
  return typeof b.wct === 'string' && typeof b.wiv === 'string'
}

/* ---------- старые ключи localStorage ---------- */

function legacyKeys(): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      // 'wf.vault.keys.migrated' — маркер миграции стикеров, не обёртка.
      if (k?.startsWith(FILE_KEY_PREFIX) && k !== `${FILE_KEY_PREFIX}migrated`) out.push(k)
    }
  } catch {
    /* нет доступа к storage */
  }
  return out
}

function legacyRead(id: string): FileKeyBlob | null {
  try {
    const raw = localStorage.getItem(FILE_KEY_PREFIX + id)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isBlob(parsed) ? parsed : null
  } catch {
    return null
  }
}

function legacyMap(): FileKeyMap {
  const out: FileKeyMap = {}
  for (const k of legacyKeys()) {
    const id = k.slice(FILE_KEY_PREFIX.length)
    const blob = legacyRead(id)
    if (blob) out[id] = blob
  }
  return out
}

function legacyRemove(id: string): void {
  try {
    localStorage.removeItem(FILE_KEY_PREFIX + id)
  } catch {
    /* нет доступа — старая копия просто остаётся */
  }
}

/* ---------- кэш в памяти ---------- */

let cache: FileKeyMap | null = null
let loading: Promise<FileKeyMap> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((fn) => fn())
}

export function subscribeFileKeys(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function fileKeysLoaded(): boolean {
  return cache !== null
}

/** Полный словарь: база (или кэш) плюс всё, что ещё не перенесено. */
export function fileKeysSnapshot(): FileKeyMap {
  return { ...legacyMap(), ...(cache ?? {}) }
}

export function listFileKeyIds(): string[] {
  return Object.keys(fileKeysSnapshot())
}

export function countFileKeyIds(): number {
  return listFileKeyIds().length
}

/** Синхронное чтение: кэш, а до его загрузки — старая запись localStorage. */
export function readFileKey(id: string): FileKeyBlob | null {
  return cache?.[id] ?? legacyRead(id)
}

async function writeMap(map: FileKeyMap): Promise<boolean> {
  if (!idbAvailable()) return false
  return docs.put(FILE_KEYS_DOC, map)
}

/**
 * Однократная загрузка словаря + перенос старых ключей.
 * Идемпотентна; при сбое записи старые ключи остаются на месте.
 */
export function loadFileKeys(): Promise<FileKeyMap> {
  if (cache) return Promise.resolve(cache)
  if (loading) return loading
  loading = (async () => {
    let fromDb: FileKeyMap = {}
    if (idbAvailable()) {
      try {
        const doc = await docGet<FileKeyMap>(FILE_KEYS_DOC)
        if (doc?.value && typeof doc.value === 'object') {
          for (const [id, blob] of Object.entries(doc.value)) if (isBlob(blob)) fromDb[id] = blob
        }
      } catch {
        fromDb = {}
      }
    }
    const legacy = legacyMap()
    /* База важнее: она уже могла быть переупакована под новый мастер-ключ. */
    const merged: FileKeyMap = { ...legacy, ...fromDb }
    const needMigration = Object.keys(legacy).some((id) => fromDb[id] === undefined)
    cache = merged
    if (needMigration && idbAvailable()) {
      const ok = await writeMap(merged)
      if (ok) {
        const back = await docGet<FileKeyMap>(FILE_KEYS_DOC).catch(() => undefined)
        if (back?.value) {
          for (const id of Object.keys(legacy)) if (isBlob(back.value[id])) legacyRemove(id)
        }
      }
    }
    emit()
    return merged
  })()
  return loading
}

export async function putFileKey(id: string, blob: FileKeyBlob): Promise<boolean> {
  const map = { ...(await loadFileKeys()) }
  map[id] = blob
  cache = map
  emit()
  const ok = await writeMap(map)
  if (!ok) {
    /* База недоступна — не теряем ключ: старая схема как аварийная копия. */
    try {
      localStorage.setItem(FILE_KEY_PREFIX + id, JSON.stringify(blob))
    } catch {
      /* приватный режим — ключ проживёт сессию не дольше памяти */
    }
  }
  return ok
}

export async function removeFileKey(id: string): Promise<void> {
  const map = { ...(await loadFileKeys()) }
  delete map[id]
  cache = map
  legacyRemove(id)
  emit()
  await writeMap(map)
}

/** Заменить весь словарь (переупаковка под новый мастер-ключ). */
export async function replaceFileKeys(map: FileKeyMap): Promise<boolean> {
  cache = { ...map }
  emit()
  const ok = await writeMap(cache)
  if (ok) for (const id of Object.keys(legacyMap())) legacyRemove(id)
  return ok
}

/** Полная очистка: и словарь, и старые ключи. */
export function clearFileKeysSync(): void {
  cache = {}
  for (const id of Object.keys(legacyMap())) legacyRemove(id)
  emit()
  void writeMap({})
}

/** Только для тестов: забыть кэш. */
export function resetFileKeysCache(): void {
  cache = null
  loading = null
}
