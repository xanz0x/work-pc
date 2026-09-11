'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/* ============================================================
   ПОЧТА · КОНТЕКСТНОЕ МЕНЮ ПИСЬМА
   Тело письма живёт в iframe с opaque origin, поэтому правый клик
   ловит мост внутри письма и присылает наружу всё, что было под
   курсором: ссылку, картинку, выделенный текст и текст письма.
   Меню умеет то, чего человек ждёт от письма: копировать выделение
   или ссылку, открыть ссылку/картинку в браузере, скопировать
   адрес отправителя и тему, найти выделенное в поиске.
   ============================================================ */

export type MailCtx = {
  /** Координаты курсора в координатах окна (позиционирование меню). */
  x: number
  y: number
  /** Ссылка под курсором, если ПКМ пришлась на <a>. */
  linkURL: string | null
  /** Видимый текст этой ссылки. */
  linkText?: string | null
  /** Адрес картинки под курсором. */
  imageSrc?: string | null
  /** Выделенный текст внутри письма, если есть. */
  text: string
  /** Весь текст письма — для «копировать письмо целиком». */
  bodyText?: string
  subject?: string
  fromAddress?: string | null
}

type Bridge = { openExternal?: (url: string) => void }

const bridge = (): Bridge =>
  typeof window === 'undefined' ? {} : ((window as unknown as { workspacexDesktop?: Bridge }).workspacexDesktop ?? {})

/** В приложении для Windows ссылка уходит в системный браузер, в вебе — в новую вкладку. */
function openOutside(url: string) {
  const b = bridge()
  if (b.openExternal) b.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

type Item =
  | { sep: true }
  | {
      sep?: false
      id: string
      label: string
      hint?: string
      run: () => void
      disabled?: boolean
      danger?: boolean
    }

export function MailContextMenu({
  ctx,
  onClose,
  onSelectAll,
}: {
  ctx: MailCtx
  onClose: () => void
  onSelectAll?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<string | null>(null)
  /* Меню рисуется у самого курсора. Размер до первого кадра неизвестен,
     поэтому сперва вешаем его скрытым, замеряем и ставим на место. */
  const [place, setPlace] = useState<{ left: number; top: number; ready: boolean }>({ left: 0, top: 0, ready: false })

  /* Закрытие: клик мимо меню, Escape, прокрутка и resize. */
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    /* Прокрутка страницы уводит письмо из-под меню — закрываем. */
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  const copy = (text: string, id: string) => {
    if (!text) return
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(id)
        window.setTimeout(onClose, 350)
      })
      .catch(() => onClose())
  }

  const selection = ctx.text.trim()
  const items: Item[] = []

  if (ctx.linkURL) {
    items.push({ id: 'open', label: 'Открыть ссылку в браузере', run: () => (openOutside(ctx.linkURL!), onClose()) })
    items.push({ id: 'copy-link', label: 'Копировать адрес ссылки', hint: ctx.linkURL, run: () => copy(ctx.linkURL!, 'copy-link') })
    if (ctx.linkText) {
      items.push({ id: 'copy-link-text', label: 'Копировать текст ссылки', run: () => copy(ctx.linkText!, 'copy-link-text') })
    }
    items.push({ sep: true })
  }

  if (ctx.imageSrc) {
    items.push({ id: 'open-img', label: 'Открыть картинку в новой вкладке', run: () => (openOutside(ctx.imageSrc!), onClose()) })
    items.push({
      id: 'copy-img',
      label: 'Копировать адрес картинки',
      run: () => copy(ctx.imageSrc!, 'copy-img'),
      disabled: ctx.imageSrc.startsWith('data:'),
      hint: ctx.imageSrc.startsWith('data:') ? 'встроенная картинка без адреса' : ctx.imageSrc,
    })
    items.push({ sep: true })
  }

  items.push({
    id: 'copy-text',
    label: 'Копировать выделенный текст',
    run: () => copy(selection, 'copy-text'),
    disabled: !selection,
    hint: selection ? undefined : 'в письме нет выделенного текста',
  })
  items.push({
    id: 'copy-all',
    label: 'Копировать письмо целиком',
    run: () => copy(ctx.bodyText ?? '', 'copy-all'),
    disabled: !ctx.bodyText,
  })
  if (onSelectAll) {
    items.push({ id: 'select-all', label: 'Выделить всё письмо', run: () => (onSelectAll(), onClose()) })
  }
  items.push({ sep: true })
  items.push({
    id: 'search',
    label: 'Найти выделенное в интернете',
    run: () => (openOutside(`https://www.google.com/search?q=${encodeURIComponent(selection)}`), onClose()),
    disabled: !selection,
  })
  items.push({ sep: true })
  items.push({
    id: 'copy-from',
    label: 'Копировать адрес отправителя',
    run: () => copy(ctx.fromAddress ?? '', 'copy-from'),
    disabled: !ctx.fromAddress,
    hint: ctx.fromAddress ?? undefined,
  })
  items.push({
    id: 'copy-subject',
    label: 'Копировать тему письма',
    run: () => copy(ctx.subject ?? '', 'copy-subject'),
    disabled: !ctx.subject,
  })

  /* Меню держится курсора: если снизу/справа не хватает места — разворачивается
     влево/вверх от точки клика, а не прилипает к краю окна далеко от курсора.
     Координаты приходят в пикселях окна, а `left/top` считаются в единицах
     каркаса (на <body> действует `zoom`), поэтому делим на масштаб. */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const scale = (el.offsetWidth ? r.width / el.offsetWidth : 1) || 1
    const w = r.width || 266
    const h = r.height || 300
    const pad = 6
    const maxX = window.innerWidth - pad
    const maxY = window.innerHeight - pad
    let left = ctx.x
    let top = ctx.y
    if (left + w > maxX) left = Math.max(pad, ctx.x - w)
    if (top + h > maxY) top = Math.max(pad, ctx.y - h)
    /* Меню выше окна: прижимаем к верху, но всё равно рядом с курсором. */
    if (h > window.innerHeight - 2 * pad) top = pad
    setPlace({ left: left / scale, top: top / scale, ready: true })
  }, [ctx.x, ctx.y, items.length])

  return createPortal(
    <div
      ref={ref}
      className="mail-ctx-menu"
      role="menu"
      aria-label="Действия с письмом"
      style={{ left: place.left, top: place.top, width: 266, visibility: place.ready ? 'visible' : 'hidden' }}
      data-testid="mail-ctx-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.sep ? (
          // eslint-disable-next-line react/no-array-index-key
          <div key={`sep-${i}`} className="mail-ctx-sep" role="separator" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className="mail-ctx-item"
            disabled={it.disabled}
            title={it.hint}
            onClick={it.run}
            data-testid={`mail-ctx-${it.id}`}
          >
            <span className="mail-ctx-label">{copied === it.id ? 'Скопировано' : it.label}</span>
            {it.hint && !it.disabled && <span className="mail-ctx-hint mono">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
