'use client'

/* ============================================================
   ВЫБОР ПАПКИ ХРАНЕНИЯ
   Браузер не отдаёт абсолютный путь выбранной папки, а серверу
   нужен именно он. Поэтому папку выбираем обзором на той машине,
   где работает программа: /ai-api/cloud/browse отдаёт подпапки,
   здесь по ним ходят, создают новые и подтверждают выбор.
   В приложении для Windows сначала пробуем нативный диалог моста.
   ============================================================ */

import './folder-picker.css'
import { useCallback, useEffect, useState } from 'react'
import { IconCheck, IconChevronLeft, IconClose, IconFolder, IconPlus, IconRefresh } from './icons'

type Entry = { name: string; path: string }

type BrowseView = {
  path: string | null
  parent: string | null
  roots: Entry[]
  dirs: Entry[]
  error?: string
}

export function FolderPickerDialog({
  current,
  onClose,
  onPick,
}: {
  current: string | null
  onClose: () => void
  onPick: (path: string) => void
}) {
  const [path, setPath] = useState<string | null>(current)
  const [view, setView] = useState<BrowseView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async (target: string | null, create?: string) => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams()
      if (target) q.set('path', target)
      if (create) q.set('create', create)
      const r = await fetch(`/ai-api/cloud/browse?${q}`, { cache: 'no-store' })
      const j = (await r.json()) as BrowseView
      if (!r.ok) throw new Error(j.error ?? `Сервер ответил ${r.status}`)
      setView(j)
      setPath(j.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Папка недоступна.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(current)
  }, [current, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function create() {
    const name = newName.trim()
    if (!name || !path) return
    await load(path, name)
    setNewName('')
    setCreating(false)
  }

  return (
    <div className="fp-back" role="dialog" aria-modal="true" aria-label="Выбор папки хранения" data-testid="folder-picker" onPointerDown={onClose}>
      <div className="fp-card" onPointerDown={(e) => e.stopPropagation()}>
        <header className="fp-head">
          <span className="fp-ico" aria-hidden="true">
            <IconFolder />
          </span>
          <div className="fp-head-text">
            <b>Папка хранения</b>
            <span>Все добавленные файлы будут лежать здесь, на этом компьютере</span>
          </div>
          <button type="button" className="fp-x" onClick={onClose} aria-label="Закрыть" data-testid="fp-close">
            <IconClose />
          </button>
        </header>

        <div className="fp-bar">
          <button
            type="button"
            className="fp-btn"
            onClick={() => void load(view?.parent ?? null)}
            disabled={loading || (!view?.parent && !view?.path)}
            title="На уровень выше"
            data-testid="fp-up"
          >
            <IconChevronLeft />
            Выше
          </button>
          <span className="fp-path mono" title={path ?? undefined} data-testid="fp-path">
            {path ?? 'Начните с домашней папки или корня диска'}
          </span>
          <button type="button" className="fp-btn" onClick={() => void load(path)} disabled={loading} title="Обновить" data-testid="fp-refresh">
            <IconRefresh />
          </button>
        </div>

        <div className="fp-body" data-testid="fp-body">
          {loading ? (
            <p className="fp-note">Читаем папку…</p>
          ) : error ? (
            <p className="fp-note is-err" data-testid="fp-error">
              {error}
            </p>
          ) : (
            <ul className="fp-list">
              {(view?.roots ?? []).map((r) => (
                <li key={r.path}>
                  <button type="button" onClick={() => void load(r.path)} data-testid="fp-root">
                    <IconFolder />
                    <span className="ellipsis">{r.name}</span>
                    <i className="mono">{r.path}</i>
                  </button>
                </li>
              ))}
              {(view?.dirs ?? []).map((d) => (
                <li key={d.path}>
                  <button type="button" onClick={() => void load(d.path)} data-testid="fp-dir">
                    <IconFolder />
                    <span className="ellipsis">{d.name}</span>
                  </button>
                </li>
              ))}
              {view && view.dirs.length === 0 && view.roots.length === 0 && (
                <li className="fp-note">Внутри нет подпапок — можно выбрать эту папку или создать новую.</li>
              )}
            </ul>
          )}
        </div>

        <footer className="fp-foot">
          {creating ? (
            <span className="fp-new">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Имя новой папки"
                aria-label="Имя новой папки"
                autoFocus
                data-testid="fp-new-name"
              />
              <button type="button" className="fp-btn" onClick={() => void create()} disabled={!newName.trim() || !path} data-testid="fp-new-create">
                Создать
              </button>
              <button type="button" className="fp-btn" onClick={() => setCreating(false)}>
                Отмена
              </button>
            </span>
          ) : (
            <button type="button" className="fp-btn" onClick={() => setCreating(true)} disabled={!path} data-testid="fp-new">
              <IconPlus />
              Новая папка
            </button>
          )}
          <span className="grow" />
          <button type="button" className="fp-btn" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="fp-btn is-primary"
            onClick={() => path && onPick(path)}
            disabled={!path}
            data-testid="fp-confirm"
          >
            <IconCheck />
            Выбрать эту папку
          </button>
        </footer>
      </div>
    </div>
  )
}
