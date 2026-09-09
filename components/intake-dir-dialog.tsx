'use client'

/* ============================================================
   КУДА ПОЛОЖИТЬ ФАЙЛ
   Спрашиваем перед приёмом: файл ляжет в выбранную папку на ПК —
   в её корень или в подпапку. Подпапки настоящие: их создаёт
   сервер внутри папки хранения (POST /ai-api/cloud/folder).
   ============================================================ */

import './folder-picker.css'
import { useEffect, useState } from 'react'
import { IconCheck, IconChevronLeft, IconClose, IconFolder, IconPlus } from './icons'

const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')
const nameOf = (p: string) => p.split('/').slice(-1)[0]

export function IntakeDirDialog({
  root,
  folders,
  initialDir = '',
  count,
  onCancel,
  onPick,
}: {
  /** Абсолютный путь папки хранения — показываем, чтобы было видно, куда именно. */
  root: string | null
  folders: string[]
  initialDir?: string
  /** Сколько файлов принимаем — в заголовке. */
  count: number
  onCancel: () => void
  onPick: (dir: string) => void
}) {
  const [all, setAll] = useState<string[]>(folders)
  const [dir, setDir] = useState(initialDir)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  async function create() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/ai-api/cloud/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: dir, name }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error ?? `Ошибка ${r.status}`)
      const created = dir ? `${dir}/${name}` : name
      setAll((list) => (list.includes(created) ? list : [...list, created]))
      setDir(created)
      setNewName('')
      setCreating(false)
      window.dispatchEvent(new Event('wsx:cloud-changed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать папку')
    } finally {
      setBusy(false)
    }
  }

  const crumbs = dir ? dir.split('/') : []
  const subfolders = all.filter((f) => parentOf(f) === dir).sort((a, b) => a.localeCompare(b, 'ru'))

  return (
    <div
      className="fp-back"
      role="dialog"
      aria-modal="true"
      aria-label="Куда положить файл"
      data-testid="intake-dir"
      onPointerDown={onCancel}
    >
      <div className="fp-card is-compact" onPointerDown={(e) => e.stopPropagation()}>
        <header className="fp-head">
          <span className="fp-ico" aria-hidden="true">
            <IconFolder />
          </span>
          <div className="fp-head-text">
            <b>Куда положить {count === 1 ? 'файл' : `файлы · ${count}`}</b>
            <span>{root ? `Ваша папка: ${root}` : 'Папка на ПК не выбрана — файл ляжет во внутреннее хранилище'}</span>
          </div>
          <button type="button" className="fp-x" onClick={onCancel} aria-label="Отмена" data-testid="intake-dir-close">
            <IconClose />
          </button>
        </header>

        <div className="fp-bar">
          <button
            type="button"
            className="fp-btn fp-icon-btn"
            onClick={() => setDir(parentOf(dir))}
            disabled={!dir}
            title="На уровень выше"
            aria-label="На уровень выше"
            data-testid="intake-dir-up"
          >
            <IconChevronLeft />
          </button>
          <div className="fp-crumbs" data-testid="intake-dir-crumbs">
            <button type="button" className="fp-crumb" onClick={() => setDir('')} data-testid="intake-dir-crumb">
              Моя папка
            </button>
            {crumbs.map((c, i) => {
              const p = crumbs.slice(0, i + 1).join('/')
              return (
                <button key={p} type="button" className="fp-crumb" onClick={() => setDir(p)} data-testid="intake-dir-crumb">
                  {c}
                </button>
              )
            })}
          </div>
        </div>

        <div className="fp-pane" data-testid="intake-dir-body">
          {subfolders.length === 0 ? (
            <p className="fp-note">
              {dir ? 'Внутри пусто — можно положить файл сюда или создать подпапку.' : 'Подпапок пока нет — положите файл в корень или создайте подпапку.'}
            </p>
          ) : (
            <ul className="fp-list">
              {subfolders.map((f) => (
                <li key={f}>
                  <button type="button" onClick={() => setDir(f)} data-testid="intake-dir-row">
                    <IconFolder />
                    <span className="fp-ellipsis">{nameOf(f)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="fp-note is-err" data-testid="intake-dir-error">
              {error}
            </p>
          )}
        </div>

        <footer className="fp-foot">
          {creating ? (
            <span className="fp-new">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
                placeholder="Имя подпапки"
                aria-label="Имя подпапки"
                autoFocus
                data-testid="intake-dir-new-name"
              />
              <button type="button" className="fp-btn" disabled={busy || !newName.trim()} onClick={() => void create()} data-testid="intake-dir-new-create">
                Создать
              </button>
              <button type="button" className="fp-btn" onClick={() => setCreating(false)}>
                Отмена
              </button>
            </span>
          ) : (
            <button type="button" className="fp-btn" onClick={() => setCreating(true)} data-testid="intake-dir-new">
              <IconPlus />
              Новая подпапка
            </button>
          )}
          <span className="fp-grow" />
          <button type="button" className="fp-btn" onClick={onCancel} data-testid="intake-dir-cancel">
            Отмена
          </button>
          <button type="button" className="fp-btn is-primary" disabled={busy} onClick={() => onPick(dir)} data-testid="intake-dir-confirm">
            <IconCheck />
            {dir ? `Положить в «${nameOf(dir)}»` : 'Положить в корень'}
          </button>
        </footer>
      </div>
    </div>
  )
}
