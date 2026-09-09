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
      imageSrc: img ? img.currentSrc || img.src : null,
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
  const closeCtx = useCallback(() => setCtx(null), [])
  const metaRef = useRef(meta)
  metaRef.current = meta

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = frameRef.current
      if (!frame) return
      const d = e.data as {
        wsxMail?: string
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
      if (d.wsxMail === 'close') {
        setCtx(null)
        return
      }
      if (d.wsxMail !== 'ctx') return
      const rect = frame.getBoundingClientRect()
      setCtx({
        x: rect.left + (d.x ?? 0),
        y: rect.top + (d.y ?? 0),
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
  }, [meta.resetKey])

  const selectAll = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ wsxMailCmd: 'select-all' }, '*')
  }, [frameRef])

  return { ctx, closeCtx, selectAll }
}
