/** Общая копия не содержит локальных ключей, таймеров и привязок оригинала. */
export type CloudNoteSnapshot = {
  title: string
  body: string
  tags: string[]
}

export type CloudSource = { kind: 'file' | 'note'; id: string }

export type CloudLibraryItem = {
  id: string
  name: string
  dir: string
  size: number
  at: string
  kind?: 'file' | 'note'
  /** true — файл на общем диске; false — личный файл в локальной папке. */
  shared?: boolean
  source?: CloudSource
  note?: CloudNoteSnapshot
  /** Абсолютный путь в папке хранения — отдаётся только администратору. */
  absPath?: string
  /* ---- результат разбора файла ИИ-архивариусом ---- */
  /** Название, которое дал ИИ (вместо имени файла). */
  title?: string
  /** Описание: что это, что внутри, чем полезно. */
  description?: string
  /** Метки от ИИ: вид документа, тема, назначение. */
  analysisTags?: string[]
  analysisStatus?: 'queued' | 'done' | 'partial' | 'failed'
  analysisKind?: string
  analyzedAt?: string
  analysisError?: string
}