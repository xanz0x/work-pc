'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconClip, IconClose, IconEye, IconEyeOff, IconMail } from '../icons'
import { MailContextMenu, type MailCtx } from './mail-context-menu'
import { Star } from './mail-msg-list'
import { fmtBytes } from '@/lib/data'
import type { MessageFull } from '@/lib/mail-client'
import { addrFull, fmtMailDateFull } from '@/lib/mail-format'
import { escapeHtml } from '@/lib/mail-html'

type Props = {
  message: MessageFull | null
  loading: boolean
  error: string | null
  onFlag: (patch: { seen?: boolean; flagged?: boolean }) => void
  onBack?: () => void
}

/**
 * Тело письма живёт в iframe с opaque origin (нет allow-same-origin), поэтому
 * добраться до страницы приложения оно не может. Скрипты разрешены только
 * нашему мосту — по nonce в CSP: скрипты самого письма вырезает санитайзер
 * на сервере, а даже уцелевший inline-скрипт без nonce браузер не выполнит.
 * Мост нужен для честного правого клика внутри письма: он сообщает наружу,
 * что под курсором (ссылка, картинка, выделенный текст).
 */
const BRIDGE_NONCE = 'wsxmailbridge'

const BRIDGE = `
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

/** cid:-ссылки заменяются данными из вложений: иначе встроенные картинки битые. */
function inlineCids(html: string, m: MessageFull): string {
  const byCid = new Map<string, string>()
  for (const a of m.attachments) {
    if (a.cid && a.dataUrl) byCid.set(a.cid.replace(/^<|>$/g, '').toLowerCase(), a.dataUrl)
  }
  if (byCid.size === 0) return html
  return html.replace(/(["'(])\s*cid:([^"')\s]+)\s*(["')])/gi, (whole, open: string, cid: string, close: string) => {
    const url = byCid.get(decodeURIComponent(cid).toLowerCase())
    return url ? `${open}${url}${close}` : whole
  })
}

function frameDoc(m: MessageFull): string {
  /* Картинки грузятся напрямую с их адресов; скрипт — только наш, по nonce. */
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src https: http: data: blob:',
    `script-src 'nonce-${BRIDGE_NONCE}'`,
    "font-src https: data:",
    "frame-src 'none'",
  ].join('; ')
  const raw = m.html ?? `<pre class="plain">${escapeHtml(m.text ?? '')}</pre>`
  const body = inlineCids(raw, m)
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
html,body{margin:0;background:#fff;color:#1c1f24}body{padding:16px 18px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;word-break:break-word}
img{max-width:100%;height:auto}a{color:#1a5fb4}pre.plain{white-space:pre-wrap;font:13.5px/1.55 ui-monospace,Menlo,Consolas,monospace;margin:0}table{max-width:100%}
::selection{background:#cfe3ff}
</style></head><body>${body}<script nonce="${BRIDGE_NONCE}">${BRIDGE}</script></body></html>`
}

function AddrLine({ label, list }: { label: string; list: { name: string; address: string }[] }) {
  if (list.length === 0) return null
  return (
    <div className="mail-view-addr">
      <span className="label-mono">{label}</span>
      <span className="mono">{list.map(addrFull).join(', ')}</span>
    </div>
  )
}

export function MailMsgView({ message: m, loading, error, onFlag, onBack }: Props) {
  const doc = useMemo(() => (m ? frameDoc(m) : ''), [m])
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ctx, setCtx] = useState<MailCtx | null>(null)
  const closeCtx = useCallback(() => setCtx(null), [])

  const selectAll = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ wsxMailCmd: 'select-all' }, '*')
  }, [])

  /* Сообщения от моста внутри письма: координаты пересчитываем в окно. */
  useEffect(() => {
    if (!m) return
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
      if (d?.wsxMail === 'close') {
        setCtx(null)
        return
      }
      if (d?.wsxMail !== 'ctx') return
      const rect = frame.getBoundingClientRect()
      setCtx({
        x: rect.left + (d.x ?? 0),
        y: rect.top + (d.y ?? 0),
        linkURL: d.linkURL ?? null,
        linkText: d.linkText ?? null,
        imageSrc: d.imageSrc ?? null,
        text: d.selection ?? '',
        bodyText: d.bodyText ?? '',
        subject: m.subject,
        fromAddress: m.from?.address ?? null,
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [m])

  /* Новое письмо — старое меню не нужно. */
  useEffect(() => {
    setCtx(null)
  }, [m?.folder, m?.uid])

  if (error) {
    return (
      <div className="mail-view-state err" role="alert" data-testid="mail-msg-view-error">
        {error}
      </div>
    )
  }
  if (!m) {
    return (
      <div className="mail-view-state" data-testid={loading ? 'mail-msg-view-loading' : 'mail-msg-view-empty'}>
        <span className="mail-empty-ico" aria-hidden="true">
          <IconMail />
        </span>
        <span>{loading ? 'Открываем письмо…' : 'Выберите письмо из списка'}</span>
      </div>
    )
  }
  const files = m.attachments.filter((a) => !a.inline)
  return (
    <article className={`mail-view${loading ? ' dim' : ''}`} data-testid="mail-msg-view" data-uid={m.uid}>
      <header className="mail-view-head">
        <div className="mail-view-title">
          <h2 data-testid="mail-msg-view-subject">{m.subject || '(без темы)'}</h2>
          <div className="mail-view-tools">
            <button
              className={`btn btn-sm btn-ghost mail-view-star${m.flagged ? ' on' : ''}`}
              onClick={() => onFlag({ flagged: !m.flagged })}
              aria-pressed={m.flagged}
              title={m.flagged ? 'Снять звезду' : 'Поставить звезду'}
              data-testid="mail-msg-view-star"
            >
              <Star on={m.flagged} size={13} /> {m.flagged ? 'Со звездой' : 'Звезда'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => onFlag({ seen: !m.seen })} title={m.seen ? 'Пометить как непрочитанное' : 'Пометить как прочитанное'} data-testid="mail-msg-view-seen">
              {m.seen ? <IconEyeOff width={13} height={13} aria-hidden="true" /> : <IconEye width={13} height={13} aria-hidden="true" />}
              {m.seen ? 'Не прочитано' : 'Прочитано'}
            </button>
            {onBack && (
              <button className="mcp-x" onClick={onBack} aria-label="Закрыть письмо" title="Закрыть письмо" data-testid="mail-msg-view-close">
                <IconClose width={11} height={11} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="mail-view-meta">
          <span className="mail-avatar" aria-hidden="true">
            {(m.from?.name || m.from?.address || '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="mail-view-who">
            <b data-testid="mail-msg-view-from">{m.from ? addrFull(m.from) : '—'}</b>
            <AddrLine label="кому" list={m.to} />
            <AddrLine label="копия" list={m.cc} />
          </div>
          <time className="mail-view-date mono" dateTime={m.date ?? undefined} data-testid="mail-msg-view-date">
            {fmtMailDateFull(m.date)}
          </time>
        </div>
        {m.truncated && (
          <div className="mail-view-bar">
            <span className="mail-view-hint warn">Письмо больше 6 МБ — показана только его часть.</span>
          </div>
        )}
      </header>
      <div className="mail-view-body">
        <iframe
          key={`${m.folder}:${m.uid}`}
          ref={frameRef}
          className="mail-frame"
          title={`Письмо: ${m.subject || 'без темы'}`}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          data-testid="mail-msg-view-frame"
        />
      </div>
      {files.length > 0 && (
        <footer className="mail-view-files" data-testid="mail-msg-view-attachments">
          <span className="label-mono">
            <IconClip width={11} height={11} aria-hidden="true" /> Вложения · {files.length}
          </span>
          <ul>
            {files.map((a, i) => (
              <li key={`${a.filename}-${i}`} className="mail-file" title={a.contentType}>
                <span className="mail-file-name">{a.filename}</span>
                <span className="mono">{fmtBytes(a.size)}</span>
              </li>
            ))}
          </ul>
        </footer>
      )}
      {ctx && <MailContextMenu ctx={ctx} onClose={closeCtx} onSelectAll={selectAll} />}
    </article>
  )
}
