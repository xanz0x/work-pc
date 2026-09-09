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
  source?: CloudSource
  note?: CloudNoteSnapshot
  /** Абсолютный путь в папке хранения — отдаётся только администратору. */
  absPath?: string
}