/* ============================================================
   NF-7 · СБОРКА СНИМКА
   Читаем ровно те ключи, которые перечислил реестр: документы — из
   IndexedDB, мелочь из isLocalOnly — из localStorage, журнал — из своего
   append-only стора. Ничего не выдумываем: чего в сейфе нет, того нет и
   в снимке, и превью покажет ноль, а не «примерно».
   ============================================================ */

import { docGet, docList } from '@/lib/db/idb'
import { readJournal, type JournalEntry } from '@/lib/journal'
import { collectKeyMaterial, isKeyMaterial, type KeyMaterial } from './keys'
import {
  APP_BUILD,
  MODULES,
  NOTES_DOC,
  docKeysOf,
  itemsIn,
  localKeysOf,
  moduleLabel,
  moduleOf,
  type BackupModule,
  type ModuleId,
} from './registry'

export const SNAPSHOT_KIND = 'workflow-vault-snapshot'

/**
 * Значения, которые сейчас показаны на экране, но в хранилище ещё не
 * записаны: `usePersistedState` пишет документ только при изменении.
 * Ключ → текущее значение из стора.
 */
export type LiveState = Record<string, unknown>

export type ModuleData = {
  docs: Record<string, unknown>
  local: Record<string, string>
  journal?: JournalEntry[]
}

export type SnapshotPayload = {
  kind: typeof SNAPSHOT_KIND
  v: 1
  at: number
  build: string
  modules: Partial<Record<ModuleId, ModuleData>>
  keys: KeyMaterial | null
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

async function collectModule(mod: BackupModule, live: LiveState): Promise<ModuleData> {
  const data: ModuleData = { docs: {}, local: {} }

  for (const key of docKeysOf(mod)) {
    const doc = await docGet(key).catch(() => undefined)
    if (doc !== undefined) {
      data.docs[key] = doc.value
      continue
    }
    /* Документа в хранилище нет, но состояние живёт в сторе на значениях по
       умолчанию (демо-набор первого запуска, ещё ни разу не изменённый).
       Снимок обязан содержать то, что человек видит на экране, иначе после
       восстановления он потеряет ровно эти данные. */
    if (live[key] !== undefined) data.docs[key] = live[key]
  }
  for (const prefix of mod.prefixes) {
    const list = await docList(prefix).catch(() => [])
    for (const doc of list) data.docs[doc.key] = doc.value
  }
  for (const key of localKeysOf(mod)) {
    const raw = lsGet(key)
    if (raw !== null) data.local[key] = raw
  }
  if (mod.journal) data.journal = await readJournal()

  return data
}

export async function collectSnapshot(
  ids: ModuleId[],
  live: LiveState = {},
): Promise<SnapshotPayload> {
  const modules: Partial<Record<ModuleId, ModuleData>> = {}
  for (const id of ids) {
    const mod = moduleOf(id)
    if (mod) modules[id] = await collectModule(mod, live)
  }
  const notesDoc = modules.library?.docs[NOTES_DOC]
  return {
    kind: SNAPSHOT_KIND,
    v: 1,
    at: Date.now(),
    build: APP_BUILD,
    modules,
    keys: await collectKeyMaterial(notesDoc),
  }
}

export function isSnapshotPayload(x: unknown): x is SnapshotPayload {
  if (typeof x !== 'object' || x === null) return false
  const b = x as Partial<SnapshotPayload>
  return (
    b.kind === SNAPSHOT_KIND &&
    b.v === 1 &&
    typeof b.at === 'number' &&
    typeof b.modules === 'object' &&
    b.modules !== null &&
    (b.keys === null || isKeyMaterial(b.keys))
  )
}

export type ModuleSummary = {
  id: ModuleId
  label: string
  note: string
  docs: number
  items: number
  journal: number
}

export type SnapshotSummary = {
  at: number
  build: string
  hasKeys: boolean
  modules: ModuleSummary[]
  items: number
}

/** Превью снимка: состав модулей до того, как что-то будет записано. */
export function summarize(payload: SnapshotPayload): SnapshotSummary {
  const modules: ModuleSummary[] = []
  for (const mod of MODULES) {
    const data = payload.modules[mod.id]
    if (!data) continue
    const items = Object.values(data.docs).reduce<number>((acc, v) => acc + itemsIn(v), 0)
    modules.push({
      id: mod.id,
      label: moduleLabel(mod.id),
      note: mod.note,
      docs: Object.keys(data.docs).length + Object.keys(data.local).length,
      items: mod.journal ? (data.journal?.length ?? 0) : items,
      journal: data.journal?.length ?? 0,
    })
  }
  return {
    at: payload.at,
    build: payload.build,
    hasKeys: payload.keys !== null,
    modules,
    items: modules.reduce((acc, m) => acc + m.items, 0),
  }
}
