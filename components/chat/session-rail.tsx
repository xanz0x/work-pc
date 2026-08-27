'use client'

import { useMemo, useState } from 'react'
import { IconPlus, IconTrash, IconChat, IconChevronLeft, IconSearch } from '../icons'
import type { Session } from './types'

function ago(ts: number, now: number) {
  const m = Math.max(0, Math.round((now - ts) / 60000))
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч`
  return `${Math.round(h / 24)} дн`
}

/**
 * Рельс разговоров. Показывает не только заголовок, но и число цитат в ветке:
 * так видно, какая переписка реально опирается на архив, а какая — болтовня.
 * Двойной клик по названию переименовывает разговор на месте.
 */
export function SessionRail({
  sessions,
  activeId,
  now,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onCollapse,
}: {
  sessions: Session[]
  activeId: string | null
  now: number
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onCollapse: () => void
}) {
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.msgs.some((m) => m.text.toLowerCase().includes(q)),
    )
  }, [sessions, query])

  function commit(id: string) {
    const next = draft.trim()
    setEditId(null)
    if (next) onRename(id, next.slice(0, 60))
  }

  return (
    <div className="rail">
      <header className="rail-head">
        <span className="label-mono">диалоги</span>
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onNew} aria-label="Новый диалог">
          <IconPlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn rail-collapse"
          onClick={onCollapse}
          aria-label="Скрыть список диалогов"
        >
          <IconChevronLeft aria-hidden="true" />
        </button>
      </header>

      {sessions.length > 1 ? (
        <div className="rail-find">
          <IconSearch aria-hidden="true" width={14} height={14} />
          <input
            type="search"
            value={query}
            placeholder="Поиск по разговорам"
            aria-label="Поиск по разговорам"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}

      {found.length === 0 ? (
        <p className="rail-empty">
          {sessions.length === 0
            ? 'Пока ни одного разговора. Спросите что-нибудь о файлах.'
            : 'Ни один разговор не подходит под запрос.'}
        </p>
      ) : (
        <ul className="rail-list">
          {found.map((s) => {
            const cites = s.msgs.reduce(
              (n, m) => n + (m.role === 'ai' ? m.sources.length : 0),
              0,
            )
            const last = [...s.msgs].reverse().find((m) => m.role === 'user')
            return (
              <li key={s.id} className={s.id === activeId ? 'is-on' : undefined}>
                {editId === s.id ? (
                  <div className="rail-rename">
                    <input
                      autoFocus
                      value={draft}
                      aria-label="Название разговора"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commit(s.id)
                        }
                        if (e.key === 'Escape') setEditId(null)
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="rail-item"
                    onClick={() => onSelect(s.id)}
                    onDoubleClick={() => {
                      setEditId(s.id)
                      setDraft(s.title)
                    }}
                    title="Двойной клик — переименовать"
                    aria-current={s.id === activeId ? 'true' : undefined}
                  >
                    <span className="rail-mark" aria-hidden="true">
                      <IconChat />
                    </span>
                    <span className="rail-text">
                      <span className="rail-title ellipsis">{s.title}</span>
                      <span className="rail-sub mono">
                        {ago(s.createdAt, now)} · цитат {cites}
                      </span>
                      {last ? <span className="rail-prev ellipsis">{last.text}</span> : null}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="rail-del"
                  onClick={() => onDelete(s.id)}
                  aria-label={`Удалить диалог «${s.title}»`}
                >
                  <IconTrash aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="rail-foot">Разговоры хранятся на устройстве и не синхронизируются.</p>
    </div>
  )
}
