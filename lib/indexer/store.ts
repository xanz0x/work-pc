/* ============================================================
   ИНДЕКСАТОР · хранилище индекса (NF-1, шаг 3)
   Содержимое, чанки, поисковая строка и хеш живут в IndexedDB рядом
   с остальным архивом (P0-3): один DOC_STORE, свои префиксы ключей.
   ============================================================ */

import { docGet, docList, docPut, docRemove } from '@/lib/db/idb'
import type { IndexedRecord, SearchEntry } from './types'

const DOC_PREFIX = 'wf.idx.doc.'
export const MANIFEST_KEY = 'wf.idx.manifest.v1'
export const SEARCH_KEY = 'wf.idx.search.v1'

export type IndexManifest = {
  /** Имя подключённой папки — показывается в настройках и библиотеке. */
  folder: string
  at: number
  /** path → отпечаток файла: по нему решается, читать ли его заново. */
  files: Record<string, { id: string; hash: string; size: number; mtime: number }>
}

export const EMPTY_MANIFEST: IndexManifest = { folder: '', at: 0, files: {} }

export async function readManifest(): Promise<IndexManifest> {
  const doc = await docGet<IndexManifest>(MANIFEST_KEY)
  const m = doc?.value
  if (!m || typeof m !== 'object') return EMPTY_MANIFEST
  return { folder: m.folder ?? '', at: m.at ?? 0, files: m.files ?? {} }
}

export async function writeManifest(m: IndexManifest): Promise<void> {
  await docPut(MANIFEST_KEY, m)
}

export async function readSearchIndex(): Promise<SearchEntry[]> {
  const doc = await docGet<SearchEntry[]>(SEARCH_KEY)
  return Array.isArray(doc?.value) ? doc!.value : []
}

export async function writeSearchIndex(entries: SearchEntry[]): Promise<void> {
  await docPut(SEARCH_KEY, entries)
}

/** Полный документ файла: запись + чанки. Читается по требованию. */
export async function putDoc(record: IndexedRecord, chunks: string[]): Promise<void> {
  await docPut(`${DOC_PREFIX}${record.id}`, { record, chunks })
}

export async function getDoc(
  id: string,
): Promise<{ record: IndexedRecord; chunks: string[] } | undefined> {
  return (await docGet<{ record: IndexedRecord; chunks: string[] }>(`${DOC_PREFIX}${id}`))?.value
}

export async function removeDoc(id: string): Promise<void> {
  await docRemove(`${DOC_PREFIX}${id}`)
}

export async function listRecords(): Promise<IndexedRecord[]> {
  const docs = await docList(DOC_PREFIX)
  return docs
    .map((d) => (d.value as { record?: IndexedRecord })?.record)
    .filter((r): r is IndexedRecord => Boolean(r?.id))
}

/** Полный сброс индекса: файлы на диске не трогаются. */
export async function clearIndexStore(): Promise<void> {
  const docs = await docList(DOC_PREFIX)
  await Promise.all(docs.map((d) => docRemove(d.key)))
  await docRemove(SEARCH_KEY)
  await docPut(MANIFEST_KEY, EMPTY_MANIFEST)
}
