/* ============================================================
   ИНДЕКСАТОР · поисковый слой в памяти (NF-1, шаг 6)
   Поиск живёт в сторе, индексатор — под ним: чтобы не заворачивать
   приложение в ещё один провайдер, содержимое лежит в модульном
   сторе с подпиской (useSyncExternalStore на стороне сейфа).
   ============================================================ */

import type { SearchEntry } from './types'

let entries = new Map<string, SearchEntry>()
let version = 0
const listeners = new Set<() => void>()

function emit(): void {
  version += 1
  listeners.forEach((l) => l())
}

export function setContentIndex(list: SearchEntry[]): void {
  entries = new Map(list.map((e) => [e.id, e]))
  emit()
}

export function upsertContent(list: SearchEntry[]): void {
  if (list.length === 0) return
  for (const e of list) entries.set(e.id, e)
  emit()
}

export function dropContent(ids: string[]): void {
  let hit = false
  for (const id of ids) hit = entries.delete(id) || hit
  if (hit) emit()
}

export function clearContent(): void {
  if (entries.size === 0) return
  entries = new Map()
  emit()
}

export function contentIndex(): Map<string, SearchEntry> {
  return entries
}

export function contentVersion(): number {
  return version
}

export function subscribeContent(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
