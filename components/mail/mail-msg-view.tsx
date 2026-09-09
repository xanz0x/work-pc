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

/** Тело письма живёт в iframe без скриптов; картинки идут через серверный прокси
    /ai-api/mail/img (часть CDN отвергает null-origin из sandbox-iframe), скрипты
    по-прежнему запрещены CSP и sandbox. */
function frameDoc(m: MessageFull): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: http: data:; font-src 'none'; frame-src 'none'`
  const body = m.html ?? `<pre class="plain">${escapeHtml(m.text ?? '')}</pre>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
html,body{margin:0;background:#fff;color:#1c1f24}body{padding:16px 18px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;word-break:break-word}
img{max-width:100%;height:auto}a{color:#1a5fb4}pre.plain{white-space:pre-wrap;font:13.5px/1.55 ui-monospace,Menlo,Consolas,monospace;margin:0}table{max-width:100%}
</style></head><body>${imgProxy(body)}</body></html>`
}

/** src картинок → серверный прокси: iframe письма имеет opaque origin, и часть
    CDN отвечает 403 таким запросам. data:-URI не трогаем. */
function imgProxy(html: string): string {
  return html.replace(/(\ssrc\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi, (_m, pre, q, url) => `${pre}${q}/ai-api/mail/img?url=${encodeURIComponent(url)}${q}`)
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
  /* ПКМ внутри письма: sandbox-iframe без скриптов не пускает событие до React,
     поэтому контекст-меню показывает этот компонент по сообщению от моста. */
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ctx, setCtx] = useState<MailCtx | null>(null)
  const closeCtx = useCallback(() => setCtx(null), [])

  useEffect(() => {
    const bridge = (
      window as unknown as {
        workspacexDesktop?: { onContextMenu?: (cb: (p: MailCtx) => void) => () => void }
      }
    ).workspacexDesktop
    if (!bridge?.onContextMenu) return
    return bridge.onContextMenu((p) => {
      /* Показываем меню, только если клик пришёлся на это письмо. */
      const rect = frameRef.current?.getBoundingClientRect()
      if (!rect) return
      if (p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom) return
      setCtx({ x: p.x, y: p.y, linkURL: p.linkURL ?? null, text: p.text ?? '' })
    })
  }, [])

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
          sandbox="allow-popups allow-popups-to-escape-sandbox"
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
      {ctx && <MailContextMenu ctx={ctx} onClose={closeCtx} />}
    </article>
  )
}
