'use client'

import { useEffect, useRef, useState } from 'react'
import { IconSend, IconClip, IconClose, IconLock, IconTarget, IconCheck } from '../icons'
import { useVault } from '@/lib/vault-store'

const MAX = 600

/**
 * Строка запроса. Enter отправляет, Shift+Enter переносит строку; ввод с
 * иероглифической раскладкой не отправляется на середине набора. Пока модель
 * пишет, кнопка отправки честно превращается в «Стоп» — генерацию можно
 * прервать, а не ждать. Скрепка не декорация: она прикрепляет к разговору
 * файлы из сейфа, и модель обязана читать их первыми.
 */
export function Composer({
  onSend,
  onStop,
  busy,
  pinned,
  onTogglePin,
  lastQuery,
  draft,
  onDraft,
}: {
  onSend: (text: string) => void
  onStop: () => void
  busy: boolean
  pinned: string[]
  onTogglePin: (fileId: string) => void
  lastQuery: string | null
  draft: string
  onDraft: (next: string) => void
}) {
  const vault = useVault()
  const [picking, setPicking] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const pick = useRef<HTMLDivElement>(null)

  const value = draft

  /** Автовысота: поле растёт до 5 строк, дальше скроллится. */
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [value])

  /** «/» ставит курсор в поле, Esc прерывает генерацию из любого места. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
      if (e.key === '/' && !typing) {
        e.preventDefault()
        area.current?.focus()
      }
      if (e.key === 'Escape') {
        if (picking) setPicking(false)
        else if (busy) onStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onStop, picking])

  /** Клик вне списка закрывает выбор файлов. */
  useEffect(() => {
    if (!picking) return
    function onDown(e: MouseEvent) {
      if (!pick.current?.contains(e.target as Node)) setPicking(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [picking])

  function send() {
    const text = value.trim()
    if (!text || busy) return
    onSend(text.slice(0, MAX))
    onDraft('')
  }

  return (
    <div className={`dock${busy ? ' is-busy' : ''}`}>
      {pinned.length ? (
        <div className="dock-pins">
          <span className="label-mono">контекст</span>
          <ul className="pin-list">
            {pinned.map((id) => {
              const f = vault.viewById(id)
              if (!f) return null
              const Icon = f.Icon
              return (
                <li key={id}>
                  <span className="pin-chip">
                    <Icon aria-hidden="true" />
                    <span className="ellipsis">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => onTogglePin(id)}
                      aria-label={`Убрать ${f.name} из контекста`}
                    >
                      <IconClose aria-hidden="true" />
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <div className="dock-field">
        <div className="dock-pick" ref={pick}>
          <button
            type="button"
            className={`icon-btn dock-clip${picking ? ' is-on' : ''}`}
            aria-label="Прикрепить файл к разговору"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            <IconClip aria-hidden="true" />
          </button>
          {picking ? (
            <div className="pick-pop" role="dialog" aria-label="Выбор файлов из сейфа">
              <p className="label-mono pick-head">
                прикрепить из сейфа · {vault.views.length}
              </p>
              {vault.views.length === 0 ? (
                <p className="pick-foot">Сейф пуст — прикреплять нечего.</p>
              ) : null}
              <ul className="pick-list">
                {vault.views.map((f) => {
                  const Icon = f.Icon
                  const on = pinned.includes(f.id)
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={`pick-row${on ? ' is-on' : ''}`}
                        onClick={() => onTogglePin(f.id)}
                        aria-pressed={on}
                      >
                        <Icon aria-hidden="true" />
                        <span className="pick-name ellipsis">{f.name}</span>
                        <span className="pick-cat mono">{f.cat}</span>
                        {on ? <IconCheck aria-hidden="true" /> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="pick-foot">Прикреплённые файлы модель читает первыми.</p>
            </div>
          ) : null}
        </div>

        <textarea
          ref={area}
          className="dock-input"
          data-testid="chat-input"
          rows={1}
          value={value}
          maxLength={MAX}
          placeholder="Спросите о своих файлах…"
          aria-label="Запрос к локальной модели"
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              send()
            }
            if (e.key === 'ArrowUp' && !value && lastQuery) {
              e.preventDefault()
              onDraft(lastQuery)
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn btn-ghost btn-sm dock-stop" onClick={onStop}>
            <span className="stop-mark" aria-hidden="true" />
            Стоп
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm dock-send"
            data-testid="chat-send-btn"
            onClick={send}
            disabled={!value.trim()}
          >
            <IconSend aria-hidden="true" />
            Спросить
          </button>
        )}
      </div>

      <div className="dock-foot">
        <span className="dock-hint">
          <kbd>Enter</kbd> отправить · <kbd>Shift</kbd>+<kbd>Enter</kbd> перенос ·{' '}
          {busy ? (
            <>
              <kbd>Esc</kbd> остановить
            </>
          ) : (
            <>
              <kbd>↑</kbd> прошлый запрос
            </>
          )}
        </span>
        <span className="grow" />
        {pinned.length ? (
          <span className="dock-stat">
            <IconTarget aria-hidden="true" />
            контекст: {pinned.length}
          </span>
        ) : null}
        <span className="dock-stat">
          <IconLock aria-hidden="true" />
          Claude Opus 5 · облако Emergent
        </span>
        {value.length > MAX - 120 ? (
          <span className="dock-stat mono">
            {value.length}/{MAX}
          </span>
        ) : null}
      </div>
    </div>
  )
}
