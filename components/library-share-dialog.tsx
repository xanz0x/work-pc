'use client'

import { useEffect, useRef, useState } from 'react'
import { DialogShell } from './dialog-shell'
import { IconClose, IconDatabase, IconTrash } from './icons'
import { useDataStore, useToast } from '@/lib/vault-store'
import { originalFor } from '@/lib/indexer/originals'
import { getDoc } from '@/lib/indexer/store'
import { sha256Hex } from '@/lib/indexer/pipeline'
import { MAX_READ_BYTES } from '@/lib/indexer/types'
import type { CloudSource } from '@/lib/cloud-types'
import './library-sharing.css'

export type LibraryShareRequest = CloudSource & { mode: 'share' | 'remove'; title: string; cloudId?: string }

export function LibraryShareDialog({ request, validate, onClose }: {
  request: LibraryShareRequest; validate: (r: LibraryShareRequest) => string | null; onClose: () => void
}) {
  const D = useDataStore()
  const { flash } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(request.mode === 'share' && request.kind === 'file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const currentValidation = useRef(validate)
  currentValidation.current = validate
  const removing = request.mode === 'remove'
  const note = request.kind === 'note' ? D.liveNotes.find((n) => n.id === request.id) : undefined

  useEffect(() => {
    if (removing || request.kind !== 'file') return
    let live = true
    originalFor(request.id).then((f) => { if (live) setFile(f) }).catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [request.id, request.kind, removing])

  async function submit() {
    if (inFlight.current) return
    const invalid = currentValidation.current(request)
    if (invalid) { setError(invalid); return }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      let init: RequestInit
      let url = '/ai-api/cloud/share'
      if (removing) {
        if (!request.cloudId) throw new Error('Общая копия не найдена.')
        url = `/ai-api/cloud/file/${encodeURIComponent(request.cloudId)}`
        init = { method: 'DELETE' }
      } else if (request.kind === 'note') {
        if (!note) throw new Error('Заметка больше недоступна.')
        init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'note', sourceId: note.id, title: note.title, body: note.body, tags: note.tags }) }
      } else {
        const original = D.fileById(request.id)
        if (!file || !original) throw new Error('Выберите оригинал файла.')
        if (file.name !== original.name || file.size !== original.bytes) throw new Error('Имя или размер не совпадают с оригиналом в библиотеке.')
        const indexed = await getDoc(request.id)
        if (indexed && await sha256Hex(new Uint8Array(await file.slice(0, MAX_READ_BYTES).arrayBuffer())) !== indexed.record.hash) {
          throw new Error('Содержимое файла изменилось. Выберите исходный файл или заново добавьте изменённый в библиотеку.')
        }
        const fd = new FormData()
        fd.append('sourceId', request.id)
        fd.append('file', file)
        init = { method: 'POST', body: fd }
      }
      const blocked = currentValidation.current(request)
      if (blocked) throw new Error(blocked)
      const response = await fetch(url, init)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`)
      window.dispatchEvent(new Event('wsx:cloud-changed'))
      flash(removing ? 'Общая копия удалена. Личный оригинал сохранён.' : 'Копия добавлена в общий диск.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Операция не выполнена.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <DialogShell className="library-share-overlay" label={removing ? 'Удалить с общего диска' : 'Добавить в общий диск'} testId="library-share-dialog" onClose={() => { if (!busy) onClose() }}>
    <div className="library-share-panel">
      <header><h2 data-testid="library-share-heading">{removing ? 'Удалить с общего диска?' : 'Добавить в общий диск?'}</h2><button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Закрыть" data-testid="library-share-close"><IconClose /></button></header>
      <div className="library-share-body">
        <strong data-testid="library-share-name">{request.title}</strong>
        <p data-testid="library-share-warning">{removing ? 'Общая копия исчезнет у всех участников диска. Личный оригинал не удаляется.' : 'Будет создана отдельная копия, доступная всем участникам без локального ключа. Личный оригинал останется у вас; его изменения не синхронизируются с копией.'}</p>
        {!removing && note?.expiresAt != null && <p className="library-share-warning" data-testid="library-share-timer-warning">Таймер личной заметки не удалит общую копию.</p>}
        {!removing && request.kind === 'file' && <div>
          {loading ? <p role="status" data-testid="library-share-loading">Проверяем доступ к оригиналу…</p> : <>
            <p data-testid="library-share-file-status">{file ? `Оригинал: ${file.name}` : 'Оригинал недоступен в этой сессии. Выберите его на компьютере.'}</p>
            <label className="library-share-file-label" htmlFor="library-share-original" data-testid="library-share-original-label">{file ? 'Выбрать другой файл' : 'Выбрать оригинал'}</label>
            <input id="library-share-original" type="file" data-testid="library-share-original" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }} />
          </>}
        </div>}
        {error && <p className="library-share-error" role="alert" data-testid="library-share-error">{error}</p>}
      </div>
      <footer><button className="btn btn-ghost" disabled={busy} onClick={onClose} data-testid="library-share-cancel">Отмена</button><button className={`btn ${removing ? 'btn-danger' : 'btn-primary'}`} disabled={busy || loading || (!removing && request.kind === 'file' && !file)} onClick={() => void submit()} data-testid="library-share-confirm">{removing ? <IconTrash /> : <IconDatabase />}{busy ? (removing ? 'Удаление…' : 'Публикация…') : removing ? 'Удалить копию' : 'Добавить копию'}</button></footer>
    </div>
  </DialogShell>
}