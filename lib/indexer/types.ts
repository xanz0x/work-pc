/* ============================================================
   ИНДЕКСАТОР · типы (NF-1)
   До волны 3 «добавить файл» создавал только метаданные, а конвейер
   OCR был набором setTimeout. Здесь описан честный контракт: что
   индексатор читает, что складывает в IndexedDB и о чём он отчитывается.
   ============================================================ */

/** Почему у файла нет текстового слоя. Причина показывается в интерфейсе. */
export type NoTextReason = 'binary' | 'pdf-no-text' | 'empty' | 'too-big' | 'read-error'

export type IndexedRecord = {
  /** Стабильный id: SHA-256 от относительного пути (папка не важна). */
  id: string
  /** Относительный путь внутри выбранной папки. */
  path: string
  name: string
  ext: string
  size: number
  /** Время изменения файла на диске. */
  mtime: number
  /** SHA-256 содержимого: по нему работает инкрементальность. */
  hash: string
  /** Длина извлечённого текста в символах. */
  textLen: number
  chunks: number
  keywords: string[]
  noText?: NoTextReason
  /** Когда файл прошёл конвейер. */
  at: number
}

/** Компактная строка поискового индекса: держится в памяти целиком. */
export type SearchEntry = {
  id: string
  path: string
  name: string
  keywords: string[]
  /** Текст для поиска по содержимому (обрезан, см. SNIPPET_LIMIT). */
  text: string
}

/** Что индексатор получает на вход — файл на диске или из диалога выбора. */
export type IndexItem = {
  path: string
  name: string
  size: number
  mtime: number
  /** Ручка File System Access API (переживает перезагрузку). */
  handle?: FileHandleLike
  /** Обычный File из `<input>` — только на время сессии. */
  file?: File
}

export type FileHandleLike = {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

export type DirHandleLike = {
  kind: 'directory'
  name: string
  values(): AsyncIterableIterator<FileHandleLike | DirHandleLike>
  queryPermission?(opts?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(opts?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

export type IndexPhase = 'idle' | 'scan' | 'index' | 'done' | 'cancelled' | 'error'

export type IndexProgress = {
  phase: IndexPhase
  /** Сколько файлов в задании (известно после фазы scan). */
  total: number
  done: number
  /** Прошли конвейер заново. */
  indexed: number
  /** Не изменились с прошлого запуска — пропущены по хешу/mtime. */
  skipped: number
  failed: number
  /** Имя файла, который читается прямо сейчас. */
  current: string
  startedAt: number
  finishedAt: number
  error?: string
}

export const EMPTY_PROGRESS: IndexProgress = {
  phase: 'idle',
  total: 0,
  done: 0,
  indexed: 0,
  skipped: 0,
  failed: 0,
  current: '',
  startedAt: 0,
  finishedAt: 0,
}

/* ---------- сообщения воркера ---------- */

export type WorkerIn =
  | {
      type: 'index'
      jobId: string
      items: IndexItem[]
      /** Что уже в индексе: path → hash/size/mtime. */
      known: Record<string, { id: string; hash: string; size: number; mtime: number }>
      force: boolean
    }
  | { type: 'cancel'; jobId: string }

export type WorkerOut =
  | { type: 'progress'; jobId: string; done: number; total: number; current: string }
  | {
      type: 'file'
      jobId: string
      record: IndexedRecord
      entry: SearchEntry
      chunks: string[]
      /** true — файл не изменился, запись взята из индекса. */
      skipped: boolean
    }
  | { type: 'failed'; jobId: string; path: string; reason: string }
  | { type: 'done'; jobId: string; cancelled: boolean }
  | { type: 'fatal'; jobId: string; reason: string }

/** Файлы больше этого размера не читаются целиком (честно помечаются). */
export const MAX_READ_BYTES = 8 * 1024 * 1024
/** Сколько текста файла попадает в поисковый индекс в памяти. */
export const SNIPPET_LIMIT = 6000
