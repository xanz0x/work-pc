'use client'

import type { Note } from '@/lib/notes'
import { IconGraph, IconTrash } from './icons'
import { useNavStore } from '@/lib/vault-store'

export function SharedNoteInspector({ note, canWrite, onRemove }: { note: Note; canWrite: boolean; onRemove: () => void }) {
  const nav = useNavStore()
  return <aside className="inspector panel shared-note-inspector" aria-label="Общая заметка" data-testid="shared-note-inspector">
    <div className="insp-tabs"><span className="chip chip-note" data-testid="shared-note-badge">заметка · общий диск</span></div>
    <h2 className="file-name" data-testid="shared-note-title">{note.title}</h2>
    <p className="shared-note-body" data-testid="shared-note-body">{note.body}</p>
    <div className="tags" data-testid="shared-note-tags">{note.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
    <p className="setting-note" data-testid="shared-note-readonly">Общая копия · только чтение</p>
    <div className="insp-actions">
      <button className="btn btn-ghost btn-full" data-testid="shared-note-map" onClick={() => nav.openOnMap(note.id)}><IconGraph />На карте</button>
      {canWrite && <button className="btn btn-ghost btn-full btn-danger" data-testid="shared-note-delete" onClick={onRemove}><IconTrash />Удалить с общего диска</button>}
    </div>
  </aside>
}