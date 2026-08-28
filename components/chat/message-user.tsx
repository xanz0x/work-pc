'use client'

import { useEffect, useRef, useState } from 'react'
import { IconPencil, IconChevronLeft } from '../icons'
import type { UserMsg } from './types'

/**
 * Запрос пользователя. Правка не создаёт новое сообщение, а добавляет ветку:
 * прежняя формулировка остаётся доступной переключателем 1/2 — видно, как
 * менялся вопрос, а не только последний его вид.
 */
export function MessageUser({
  msg,
  onEdit,
}: {
  msg: UserMsg
  onEdit: (id: string, text: string) => void
}) {
  const variants = msg.variants?.length ? msg.variants : [msg.text]
  const [idx, setIdx] = useState(variants.length - 1)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.text)

  // Появилась новая ветка после правки — показываем именно её, а не прежнюю.
  const seen = useRef(variants.length)
  useEffect(() => {
    if (variants.length !== seen.current) {
      seen.current = variants.length
      setIdx(variants.length - 1)
      setDraft(variants[variants.length - 1])
    }
  }, [variants])

  const shown = variants[Math.min(idx, variants.length - 1)]

  function commit() {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== shown) onEdit(msg.id, next)
    else setDraft(shown)
  }

  return (
    <article className="m-user" aria-label="Ваш запрос">
      <div className="m-user-row">
        <span className="m-user-time mono">{msg.time}</span>
        <div className="m-user-bubble">
          {editing ? (
            <div className="m-edit">
              <textarea
                className="textarea m-edit-field"
                data-testid="msg-edit-field"
                value={draft}
                autoFocus
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditing(false)
                    setDraft(shown)
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    e.preventDefault()
                    commit()
                  }
                }}
                aria-label="Изменить запрос"
              />
              <div className="m-edit-foot">
                <span className="label-mono">enter — переспросить</span>
                <button type="button" className="btn btn-ghost btn-sm" data-testid="msg-edit-cancel" onClick={() => setEditing(false)}>
                  Отмена
                </button>
                <button type="button" className="btn btn-primary btn-sm" data-testid="msg-edit-submit" onClick={commit}>
                  Переспросить
                </button>
              </div>
            </div>
          ) : (
            <p className="m-user-text">{shown}</p>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="m-user-acts">
          {variants.length > 1 ? (
            <div className="m-branch" role="group" aria-label="Версии запроса">
              <button
                type="button"
                className="m-branch-btn"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
                aria-label="Предыдущая формулировка"
              >
                <IconChevronLeft aria-hidden="true" />
              </button>
              <span className="mono">
                {idx + 1}/{variants.length}
              </span>
              <button
                type="button"
                className="m-branch-btn is-next"
                onClick={() => setIdx((i) => Math.min(variants.length - 1, i + 1))}
                disabled={idx === variants.length - 1}
                aria-label="Следующая формулировка"
              >
                <IconChevronLeft aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="m-act"
            data-testid="msg-edit-open"
            onClick={() => {
              setDraft(shown)
              setEditing(true)
            }}
          >
            <IconPencil aria-hidden="true" />
            Изменить
          </button>
        </div>
      ) : null}
    </article>
  )
}
