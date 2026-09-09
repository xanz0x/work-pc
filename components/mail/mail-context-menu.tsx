'use client'

import { useEffect, useRef } from 'react'

/* ============================================================
   ПОЧТА · КОНТЕКСТНОЕ МЕНЮ ПИСЬМА
   Тело письма живёт в iframe с sandbox без скриптов, поэтому меню
   показывает React: точку и ссылку под курсором сообщает мост
   (window.workspacexDesktop.onContextMenu — их ловит главный процесс).
   Копирование — navigator.clipboard, открытие — openExternal моста.
   ============================================================ */

export type MailCtx = {
  /** Координаты курсора в координатах окна (позиционирование меню). */
  x: number
  y: number
  /** Ссылка под курсором, если ПКМ пришлась на <a>. */
  linkURL: string | null
  /** Выделенный текст внутри письма, если есть. */
  text: string
}

type Bridge = {
  openExternal?: (url: string) => void
}

export function MailContextMenu({ ctx, onClose }: { ctx: MailCtx; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  /* Закрытие: клик мимо меню, Escape, прокрутка и resize. */
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const bridge = (): Bridge =>
    typeof window === 'undefined' ? {} : (window as unknown as { workspacexDesktop?: Bridge }).workspacexDesktop ?? {}

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {})
    onClose()
  }
  const openLink = () => {
    if (ctx.linkURL) bridge().openExternal?.(ctx.linkURL)
    onClose()
  }

  /* Меню не должно вылезать за край окна. */
  const width = 240
  const left = Math.max(4, Math.min(ctx.x, window.innerWidth - width - 8))
  const top = Math.max(4, Math.min(ctx.y, window.innerHeight - 150))

  return (
    <div
      ref={ref}
      className="mail-ctx-menu"
      role="menu"
      aria-label="Действия с письмом"
      style={{ left, top }}
      data-testid="mail-ctx-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {ctx.linkURL && (
        <>
          <button type="button" role="menuitem" className="mail-ctx-item" onClick={openLink} data-testid="mail-ctx-open">
            Открыть ссылку в браузере
          </button>
          <button
            type="button"
            role="menuitem"
            className="mail-ctx-item"
            onClick={() => copy(ctx.linkURL ?? '')}
            data-testid="mail-ctx-copy-link"
          >
            Копировать адрес ссылки
          </button>
          <div className="mail-ctx-sep" role="separator" />
        </>
      )}
      <button
        type="button"
        role="menuitem"
        className="mail-ctx-item"
        disabled={!ctx.text}
        onClick={() => copy(ctx.text)}
        title={ctx.text ? undefined : 'В письме нет выделенного текста'}
        data-testid="mail-ctx-copy-text"
      >
        Копировать текст
      </button>
    </div>
  )
}
