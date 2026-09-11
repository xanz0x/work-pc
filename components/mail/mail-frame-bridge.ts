'use client'

/* ============================================================
   ПОЧТА · МОСТ ВНУТРИ ПИСЬМА
   Тело письма живёт в iframe с opaque origin (нет allow-same-origin),
   поэтому добраться до страницы приложения оно не может. Скрипты
   разрешены только нашему мосту — по nonce в CSP: скрипты самого
   письма вырезает санитайзер, а уцелевший inline-скрипт без nonce
   браузер не выполнит. Мост нужен для честного правого клика внутри
   письма: он сообщает наружу, что под курсором (ссылка, картинка,
   выделенный текст). Один и тот же мост работает и для обычных
   ящиков, и для временной почты.
   ============================================================ */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { MailCtx } from './mail-context-menu'

export const BRIDGE_NONCE = 'wsxmailbridge'

export const MAIL_BRIDGE = `
(function () {
  function anchorOf(node) {
    while (node && node !== document) {
      if (node.tagName === 'A' && node.getAttribute('href')) return node
      node = node.parentNode
    }
    return null
  }
  function post(kind, extra) {
    parent.postMessage(Object.assign({ wsxMail: kind }, extra || {}), '*')
  }
  function report(e) {
    var a = anchorOf(e.target)
    var img = e.target && e.target.tagName === 'IMG' ? e.target : null
    post('ctx', {
      x: e.clientX,
      y: e.clientY,
      linkURL: a ? a.href : null,
      linkText: a ? (a.textContent || '').trim().slice(0, 300) : null,
      imageSrc: img ? img.getAttribute('data-wsx-src') || img.currentSrc || img.src : null,
      selection: String(window.getSelection ? window.getSelection() : '').slice(0, 20000),
      bodyText: (document.body.innerText || '').slice(0, 200000),
    })
  }
  /* Правый клик: обычно приходит contextmenu. Если браузер (или среда
     автотестов) его не присылает, спасает отложенный правый mousedown. */
  var waiting = null
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault()
    if (waiting) { clearTimeout(waiting); waiting = null }
    report(e)
  })
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 2) return
    var snapshot = { target: e.target, clientX: e.clientX, clientY: e.clientY }
    waiting = setTimeout(function () {
      waiting = null
      report(snapshot)
    }, 220)
  })
  /* Высота письма уезжает наружу: страница подгоняет размер iframe под
     содержимое, и прокручивает письмо своей полосой. Внутренняя прокрутка
     iframe при этом не нужна — её край часто оказывается за окном. */
  var lastH = 0
  function measure() {
    var d = document.documentElement
    var b = document.body
    var h = Math.max(d.scrollHeight, d.offsetHeight, b ? b.scrollHeight : 0, b ? b.offsetHeight : 0)
    if (Math.abs(h - lastH) < 2) return
    lastH = h
    post('size', { h: h })
  }
  measure()
  window.addEventListener('load', measure)
  document.addEventListener('load', measure, true)
  if (window.ResizeObserver) {
    try { new ResizeObserver(measure).observe(document.documentElement) } catch (e) {}
  }
  ;[80, 300, 800, 2000, 4000].forEach(function (t) { setTimeout(measure, t) })
  /* Колесо мыши внутри iframe наружу само не уходит (песочница без общего
     origin не отдаёт прокрутку родителю), поэтому дельту пересылаем мостом. */
  document.addEventListener('wheel', function (e) {
    post('wheel', { dy: e.deltaY, dx: e.deltaX, mode: e.deltaMode })
  }, { passive: true })
  document.addEventListener('keydown', function (e) {
    var keys = { PageDown: 1, PageUp: 1, Home: 1, End: 1 }
    if (keys[e.key]) { e.preventDefault(); post('key', { key: e.key }) }
  })
  document.addEventListener('pointerdown', function (e) { if (e.button !== 2) post('close') })
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') post('close') })
  document.addEventListener('scroll', function () { post('close') }, true)
  window.addEventListener('message', function (e) {
    if (e.data && e.data.wsxMailCmd === 'select-all') {
      var r = document.createRange()
      r.selectNodeContents(document.body)
      var sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
    }
  })
})()
`

/** Тег скрипта моста: вставляется последним элементом <body> письма. */
export const bridgeTag = () => `<script nonce="${BRIDGE_NONCE}">${MAIL_BRIDGE}</script>`

/** Правило CSP для скриптов: только мост, только по nonce. */
export const bridgeCsp = () => `script-src 'nonce-${BRIDGE_NONCE}'`

type Meta = {
  subject?: string
  fromAddress?: string | null
  /** Смена письма закрывает открытое меню. */
  resetKey?: string | number | null
}

/**
 * Слушает мост письма и отдаёт готовый контекст меню в координатах окна.
 */
export function useMailFrameBridge(frameRef: RefObject<HTMLIFrameElement | null>, meta: Meta) {
  const [ctx, setCtx] = useState<MailCtx | null>(null)
  const [frameHeight, setFrameHeight] = useState<number | null>(null)
  const closeCtx = useCallback(() => setCtx(null), [])
  const metaRef = useRef(meta)
  metaRef.current = meta

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = frameRef.current
      if (!frame) return
      const d = e.data as {
        wsxMail?: string
        h?: number
        dy?: number
        dx?: number
        mode?: number
        key?: string
        x?: number
        y?: number
        linkURL?: string | null
        linkText?: string | null
        imageSrc?: string | null
        selection?: string
        bodyText?: string
      }
      if (!d || typeof d.wsxMail !== 'string') return
      /* Источник сверяем, только если браузер его отдал: у песочницы с
         opaque origin e.source в части сборок приходит пустым. */
      if (e.source && frame.contentWindow && e.source !== frame.contentWindow) return
      if (d.wsxMail === 'size') {
        const h = Number(d.h)
        if (Number.isFinite(h) && h > 0) setFrameHeight(Math.ceil(h))
        return
      }
      if (d.wsxMail === 'wheel' || d.wsxMail === 'key') {
        const pane = frame.closest('.mail-view-body') as HTMLElement | null
        if (!pane) return
        if (d.wsxMail === 'wheel') {
          const mode = d.mode ?? 0
          const unit = mode === 1 ? 16 : mode === 2 ? pane.clientHeight : 1
          pane.scrollBy({ top: (d.dy ?? 0) * unit, left: (d.dx ?? 0) * unit })
          return
        }
        const step = pane.clientHeight * 0.9
        if (d.key === 'PageDown') pane.scrollBy({ top: step })
        else if (d.key === 'PageUp') pane.scrollBy({ top: -step })
        else if (d.key === 'Home') pane.scrollTo({ top: 0 })
        else if (d.key === 'End') pane.scrollTo({ top: pane.scrollHeight })
        return
      }
      if (d.wsxMail === 'close') {
        setCtx(null)
        return
      }
      if (d.wsxMail !== 'ctx') return
      const rect = frame.getBoundingClientRect()
      /* Внутри письма координаты считаются в его собственных пикселях: на
         каркас действует `zoom`, и рамка на экране крупнее/мельче своей
         разметки. Переводим точку клика в пиксели окна, иначе меню уезжает
         от курсора тем сильнее, чем дальше письмо от левого верхнего угла. */
      const scale = (frame.offsetWidth ? rect.width / frame.offsetWidth : 1) || 1
      setCtx({
        x: rect.left + (d.x ?? 0) * scale,
        y: rect.top + (d.y ?? 0) * scale,
        linkURL: d.linkURL ?? null,
        linkText: d.linkText ?? null,
        imageSrc: d.imageSrc ?? null,
        text: d.selection ?? '',
        bodyText: d.bodyText ?? '',
        subject: metaRef.current.subject,
        fromAddress: metaRef.current.fromAddress ?? null,
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frameRef])

  useEffect(() => {
    setCtx(null)
    setFrameHeight(null)
    const pane = frameRef.current?.closest('.mail-view-body') as HTMLElement | null
    if (pane) pane.scrollTop = 0
    /* Открытие письма не должно тащить за собой выделение, начатое в
       списке: страница перерисовывает правую колонку, и такой «хвост»
       растягивается на весь интерфейс. */
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) {
      const el = document.activeElement as HTMLElement | null
      const inField =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (!inField) sel.removeAllRanges()
    }
  }, [meta.resetKey, frameRef])

  const selectAll = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ wsxMailCmd: 'select-all' }, '*')
  }, [frameRef])

  /* Ctrl+A на экране почты означает «выделить письмо», а не «закрасить
     весь интерфейс»: выделение уходит внутрь iframe письма. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'a' && e.key !== 'A' && e.key !== 'ф' && e.key !== 'Ф') return
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const frame = frameRef.current
      if (!frame) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      frame.contentWindow?.postMessage({ wsxMailCmd: 'select-all' }, '*')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [frameRef])

  return { ctx, closeCtx, selectAll, frameHeight }
}
