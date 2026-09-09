import { folderPermission, loadFolderHandle } from './fs'
import { getDoc } from './store'
import type { IndexItem, DirHandleLike } from './types'

// File остаётся только в памяти текущей страницы; не пишем незашифрованные оригиналы в базу.
const originals = new Map<string, IndexItem>()
export function rememberOriginals(items: IndexItem[]) {
  for (const item of items) originals.set(item.path, item)
}

export async function originalFor(id: string): Promise<File | null> {
  const doc = await getDoc(id)
  if (!doc) return null
  const key = doc.record.path
  const item = originals.get(key)
  if (item?.file) return item.file
  if (item?.handle) return item.handle.getFile().catch(() => null)
  const root = await loadFolderHandle()
  if (!root || await folderPermission(root, false) !== 'granted') return null
  const parts = key.split('/')
  let dir: DirHandleLike = root
  for (let i = 0; i < parts.length; i++) {
    let child
    for await (const entry of dir.values()) if (entry.name === parts[i]) { child = entry; break }
    if (!child) return null
    if (i === parts.length - 1) return child.kind === 'file' ? child.getFile().catch(() => null) : null
    if (child.kind !== 'directory') return null
    dir = child
  }
  return null
}