/* ============================================================
   ИНДЕКСАТОР · доступ к папке (NF-1, шаг 1)
   Основной путь — File System Access API: ручка папки сохраняется в
   IndexedDB и переживает перезагрузку, поэтому инкрементальность
   работает между сессиями. Где API нет (Safari, Firefox) — честный
   фолбэк на `<input webkitdirectory>`: индекс строится, но ручку
   сохранить нельзя, и пользователь об этом узнаёт из интерфейса.
   ============================================================ */

import { metaGet, metaSet } from '@/lib/db/idb'
import type { DirHandleLike, FileHandleLike, IndexItem } from './types'

const HANDLE_KEY = 'idx.folder.handle.v1'

type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirHandleLike>
}

export function supportsFsa(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

/** Диалог выбора папки. null — пользователь отказался. */
export async function pickFolder(): Promise<DirHandleLike | null> {
  const w = window as PickerWindow
  if (!w.showDirectoryPicker) return null
  try {
    return await w.showDirectoryPicker({ mode: 'read' })
  } catch {
    return null
  }
}

export async function saveFolderHandle(handle: DirHandleLike): Promise<void> {
  try {
    await metaSet(HANDLE_KEY, handle)
  } catch {
    /* ручка не сериализуется в этом браузере — работаем в рамках сессии */
  }
}

export async function loadFolderHandle(): Promise<DirHandleLike | null> {
  try {
    return (await metaGet<DirHandleLike>(HANDLE_KEY)) ?? null
  } catch {
    return null
  }
}

export async function forgetFolderHandle(): Promise<void> {
  try {
    await metaSet(HANDLE_KEY, undefined)
  } catch {
    /* нечего забывать */
  }
}

/** Разрешение на чтение: `granted` — можно сканировать. */
export async function folderPermission(
  handle: DirHandleLike,
  ask: boolean,
): Promise<PermissionState> {
  const q = await handle.queryPermission?.({ mode: 'read' })
  if (q === 'granted' || !ask) return q ?? 'prompt'
  return (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
}

const SKIP_DIR = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache', '.venv', '__pycache__',
])

export const SCAN_LIMIT = 5000

/** Рекурсивный обход папки. Служебные каталоги пропускаются. */
export async function scanFolder(
  root: DirHandleLike,
  onFound: (n: number) => void,
  limit = SCAN_LIMIT,
): Promise<IndexItem[]> {
  const out: IndexItem[] = []
  const walk = async (dir: DirHandleLike, prefix: string): Promise<void> => {
    for await (const entry of dir.values()) {
      if (out.length >= limit) return
      if (entry.kind === 'directory') {
        if (entry.name.startsWith('.') || SKIP_DIR.has(entry.name)) continue
        await walk(entry, `${prefix}${entry.name}/`)
        continue
      }
      const handle = entry as FileHandleLike
      if (handle.name.startsWith('.')) continue
      try {
        const file = await handle.getFile()
        out.push({
          path: `${prefix}${handle.name}`,
          name: handle.name,
          size: file.size,
          mtime: file.lastModified,
          handle,
        })
        if (out.length % 25 === 0) onFound(out.length)
      } catch {
        /* файл исчез между обходом и чтением */
      }
    }
  }
  await walk(root, '')
  onFound(out.length)
  return out
}

/** Фолбэк: файлы из `<input webkitdirectory>` или из обычного выбора файлов. */
export function itemsFromFileList(files: File[]): IndexItem[] {
  return files.map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath
    return {
      path: rel && rel.length > 0 ? rel : f.name,
      name: f.name,
      size: f.size,
      mtime: f.lastModified,
      file: f,
    }
  })
}
