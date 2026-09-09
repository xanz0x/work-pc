'use client'

/* ============================================================
   ВЫБОР ЛОКАЛЬНОЙ ПАПКИ
   Браузер не отдаёт абсолютный путь выбранной папки, а серверу
   нужен именно он. Поэтому папку выбираем обзором на той машине,
   где работает программа: /ai-api/cloud/browse отдаёт подпапки.
   Раскладка как в файловом менеджере: слева дерево с ленивым
   раскрытием, справа содержимое выбранной папки, сверху путь
   хлебными крошками. В приложении для Windows сначала пробуем
   нативный диалог моста.
   ============================================================ */

import './folder-picker.css'
import { useCallback, useEffect, useState } from 'react'
import { IconCheck, IconChevronDown, IconChevronLeft, IconClose, IconFolder, IconPlus, IconRefresh } from './icons'

type Entry = { name: string; path: string }

type BrowseView = {
  path: string | null
  parent: string | null
  roots: Entry[]
  dirs: Entry[]
  error?: string
}

async function browse(target: string | null, create?: string): Promise<BrowseView> {
  const q = new URLSearchParams()
  if (target) q.set('path', target)
  if (create) q.set('create', create)
  const r = await fetch(`/ai-api/cloud/browse?${q}`, { cache: 'no-store' })
  const j = (await r.json()) as BrowseView
  if (!r.ok) throw new Error(j.error ?? `Сервер ответил ${r.status}`)
  return j
}

const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/')

/** Крошки пути: [{name, path}] от корня к самой папке. */
function crumbsOf(p: string): Entry[] {
  const sep = sepOf(p)
  const parts = p.split(sep).filter(Boolean)
  const out: Entry[] = []
  let acc = sep === '/' ? '' : ''
  for (const part of parts) {
    acc = acc ? `${acc}${sep}${part}` : sep === '/' ? `/${part}` : part
    out.push({ name: part, path: acc })
  }
  if (sep === '/') out.unshift({ name: '/', path: '/' })
  return out
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
  const [roots, setRoots] = useState<Entry[]>([])
  const [children, setChildren] = useState<Record<string, Entry[]>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [path, setPath] = useState<string | null>(current)
  const [parent, setParent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  /** Открыть папку: её содержимое едет в правую панель и в дерево. */
  const go = useCallback(async (target: string, create?: string) => {
    setLoading(true)
    setError(null)
    try {
      const v = await browse(target, create)
      setChildren((c) => ({ ...c, [v.path ?? target]: v.dirs }))
      setPath(v.path ?? target)
      setParent(v.parent)
      setOpen((o) => ({ ...o, [v.path ?? target]: true }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Папка недоступна.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const start = await browse(null)
        if (!live) return
        setRoots(start.roots)
        if (current) await go(current)
        else if (start.roots[0]) await go(start.roots[0].path)
        else setLoading(false)
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : 'Обзор папок недоступен.')
          setLoading(false)
        }
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function toggle(p: string) {
    if (open[p]) {
      setOpen((o) => ({ ...o, [p]: false }))
      return
    }
    setOpen((o) => ({ ...o, [p]: true }))
    if (!children[p]) {
      try {
        const v = await browse(p)
        setChildren((c) => ({ ...c, [p]: v.dirs }))
      } catch {
        setChildren((c) => ({ ...c, [p]: [] }))
      }
    }
  }

  async function create() {
    const name = newName.trim()
    if (!name || !path) return
    await go(path, name)
    setNewName('')
    setCreating(false)
  }

  function TreeRow({ entry, depth }: { entry: Entry; depth: number }) {
    const kids = children[entry.path]
    const isOpen = !!open[entry.path]
    return (
      <li>
        <div className={`fp-tree-row${path === entry.path ? ' is-on' : ''}`} style={{ paddingLeft: 6 + depth * 13 }}>
          <button
            type="button"
            className="fp-tree-caret"
            onClick={() => void toggle(entry.path)}
            aria-label={isOpen ? 'Свернуть' : 'Развернуть'}
            aria-expanded={isOpen}
            data-testid="fp-tree-caret"
          >
            {isOpen ? <IconChevronDown /> : <IconChevronLeft className="fp-caret-right" />}
          </button>
          <button
            type="button"
            className="fp-tree-name"
            onClick={() => void go(entry.path)}
            title={entry.path}
            data-testid={depth === 0 ? 'fp-root' : 'fp-tree-dir'}
          >
            <IconFolder />
            <span className="fp-ellipsis">{entry.name}</span>
          </button>
        </div>
        {isOpen && kids && kids.length > 0 && (
          <ul>
            {kids.map((k) => (
              <TreeRow key={k.path} entry={k} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const list = path ? (children[path] ?? []) : []

  return (
    <div
      className="fp-back"
      role="dialog"
      aria-modal="true"
      aria-label="Выбор локальной папки"
      data-testid="folder-picker"
      onPointerDown={onClose}
    >
      <div className="fp-card" onPointerDown={(e) => e.stopPropagation()}>
        <header className="fp-head">
          <span className="fp-ico" aria-hidden="true">
            <IconFolder />
          </span>
          <div className="fp-head-text">
            <b>Моя локальная папка</b>
            <span>Файлы, которые вы добавляете, лягут сюда — на этот компьютер и только для вас</span>
          </div>
          <button type="button" className="fp-x" onClick={onClose} aria-label="Закрыть" data-testid="fp-close">
            <IconClose />
          </button>
        </header>

        <div className="fp-bar">
          <button
            type="button"
            className="fp-btn fp-icon-btn"
            onClick={() => parent && void go(parent)}
            disabled={loading || !parent}
            title="На уровень выше"
            aria-label="На уровень выше"
            data-testid="fp-up"
          >
            <IconChevronLeft />
          </button>
          <div className="fp-crumbs" data-testid="fp-crumbs">
            {path ? (
              crumbsOf(path).map((c) => (
                <button key={c.path} type="button" className="fp-crumb" onClick={() => void go(c.path)} data-testid="fp-crumb">
                  {c.name}
                </button>
              ))
            ) : (
              <span className="fp-crumb-empty">Выберите папку слева</span>
            )}
          </div>
          <span className="fp-path mono" title={path ?? undefined} data-testid="fp-path">
            {path ?? '—'}
          </span>
          <button
            type="button"
            className="fp-btn fp-icon-btn"
            onClick={() => path && void go(path)}
            disabled={loading || !path}
            title="Обновить"
            aria-label="Обновить"
            data-testid="fp-refresh"
          >
            <IconRefresh />
          </button>
        </div>

        <div className="fp-body">
          <nav className="fp-tree" aria-label="Дерево папок" data-testid="fp-tree">
            <ul>
              {roots.map((r) => (
                <TreeRow key={r.path} entry={r} depth={0} />
              ))}
            </ul>
          </nav>

          <div className="fp-pane" data-testid="fp-body">
            {loading ? (
              <p className="fp-note">Читаем папку…</p>
            ) : error ? (
              <p className="fp-note is-err" data-testid="fp-error">
                {error}
              </p>
            ) : list.length === 0 ? (
              <p className="fp-note">Внутри нет подпапок — можно выбрать эту папку или создать новую.</p>
            ) : (
              <ul className="fp-list">
                {list.map((d) => (
                  <li key={d.path}>
                    <button type="button" onClick={() => void go(d.path)} title={d.path} data-testid="fp-dir">
                      <IconFolder />
                      <span className="fp-ellipsis">{d.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          <span className="fp-grow" />
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
