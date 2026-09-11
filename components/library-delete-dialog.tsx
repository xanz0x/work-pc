'use client'

/* ============================================================
   БИБЛИОТЕКА · ДИАЛОГ УДАЛЕНИЯ
   «Удалить из библиотеки?» с выбором судьбы байтов на ПК: файл,
   лежащий в папке хранения, по галочке (по умолчанию ВКЛ) удаляется
   и с компьютера. Без галочки остаётся в папке — уходит только
   запись из библиотеки. Удаление с ПК подтверждается сервером:
   если байты не ушли, файл остаётся в библиотеке.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { DialogShell } from './dialog-shell'
import { IconClose, IconTrash } from './icons'
import './library-sharing.css'

export type LibraryDeleteRequest = {
  kind: 'file' | 'note'
  id: string
  title: string
  /** Есть физический файл в папке хранения: путь и id на общем диске. */
  absPath?: string | null
  cloudId?: string | null
}

export function LibraryDeleteDialog({
  request,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  request: LibraryDeleteRequest
  busy: boolean
  error: string | null
  onConfirm: (removeBytes: boolean) => void
  onClose: () => void
}) {
  const canTouchDisk = request.kind === 'file' && Boolean(request.absPath)
  const [removeBytes, setRemoveBytes] = useState(canTouchDisk)
  const confirmedRef = useRef(false)
  useEffect(() => {
    if (!busy) return
    return () => {
      // окно закрывается снаружи после успеха — галочка уже отработала
    }
  }, [busy])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <DialogShell
      className="library-share-overlay"
      label="Удалить из библиотеки"
      testId="library-delete-dialog"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="library-share-panel">
        <header>
          <h2 data-testid="library-delete-heading">Удалить из библиотеки?</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Закрыть" data-testid="library-delete-close">
            <IconClose />
          </button>
        </header>
        <div className="library-share-body">
          <strong data-testid="library-delete-name">{request.title}</strong>
          <p data-testid="library-delete-warning">
            {request.kind !== 'file'
              ? 'Заметка будет стёрта без восстановления.'
              : canTouchDisk
                ? 'Файл исчезнет из библиотеки и из контекста ИИ. С галочкой ниже он удаляется и из папки хранения на компьютере — без восстановления.'
                : 'Файл исчезнет из библиотеки и из контекста ИИ. Вернуть можно 10 секунд, пока не исчезли байты.'}
          </p>
          {canTouchDisk ? (
            <label className="check">
              <input
                type="checkbox"
                checked={removeBytes}
                onChange={(e) => setRemoveBytes(e.target.checked)}
                data-testid="library-delete-remove-bytes"
              />
              <span>
                Удалить также файл с компьютера
                <em className="library-share-path">{request.absPath}</em>
              </span>
            </label>
          ) : null}
          {error ? (
            <p className="library-share-error" role="alert" data-testid="library-delete-error">
              {error}
            </p>
          ) : null}
        </div>
        <footer>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose} data-testid="library-delete-cancel">
            Отмена
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => onConfirm(removeBytes)} data-testid="library-delete-confirm">
            <IconTrash />
            {busy ? 'Удаление…' : 'Удалить'}
          </button>
        </footer>
      </div>
    </DialogShell>
  )
}
