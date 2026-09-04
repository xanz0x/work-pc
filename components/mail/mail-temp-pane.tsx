'use client'

/* Временная почта: генератор одноразовых адресов и чтение их входящих в том же экране.
   Отправлять с таких адресов нельзя — только принимать (регистрации, коды, рассылки). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconClock, IconCopy, IconInbox, IconMail, IconRefresh, IconTrash } from '../icons'
import { isFail, tempApi, TEMP_LABEL, type TempBoxView, type TempFull, type TempRow } from '@/lib/mail-client'
import { fmtMailDate, fmtMailDateFull, extractCode, letterWord, subjectCode } from '@/lib/mail-format'
import { escapeHtml } from '@/lib/mail-html'
import { useToast } from '@/lib/vault-store'

type Props = { box: TempBoxView; onBox: (box: TempBoxView) => void; onRemove: () => void }

const REFRESH_MS = 15_000

function left(expiresAt: number | null, now: number): string | null {
  if (!expiresAt) return null
  const s = Math.round((expiresAt - now) / 1000)
  if (s <= 0) return 'срок истёк'
  if (s < 60) return `${s} с`
  return `${Math.ceil(s / 60)} мин`
}

function frameDoc(m: TempFull): string {
  const body = m.html ?? `<pre class="plain">${escapeHtml(m.text ?? '')}</pre>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; font-src 'none'; frame-src 'none'"><base target="_blank"><style>
html,body{margin:0;background:#fff;color:#1c1f24}body{padding:16px 18px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;word-break:break-word}
img{max-width:100%;height:auto}a{color:#1a5fb4}pre.plain{white-space:pre-wrap;font:13.5px/1.55 ui-monospace,Menlo,Consolas,monospace;margin:0}table{max-width:100%}
</style></head><body>${body}</body></html>`
}

export function MailTempPane({ box, onBox, onRemove }: Props) {
  const { flash } = useToast()
  const [rows, setRows] = useState<TempRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [msg, setMsg] = useState<TempFull | null>(null)
  const [msgErr, setMsgErr] = useState<string | null>(null)
  const [msgLoading, setMsgLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const gen = useRef(0)
  const id = box.id

  const load = useCallback(async () => {
    const g = gen.current
    setSyncing(true)
    const r = await tempApi.inbox(id)
    if (g !== gen.current) return
    setSyncing(false)
    if (isFail(r)) {
      setErr(r.error)
      setRows((cur) => cur ?? [])
      return
    }
    setErr(null)
    setRows(r.rows)
    onBox(r.box)
  }, [id, onBox])

  useEffect(() => {
    gen.current += 1
    setRows(null)
    setSel(null)
    setMsg(null)
    setErr(null)
    setMsgErr(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void loadRef.current()
    }, REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(t)
      clearInterval(tick)
    }
  }, [])

  async function open(mid: string) {
    const g = gen.current
    setSel(mid)
    setMsg(null)
    setMsgErr(null)
    setMsgLoading(true)
    const r = await tempApi.message(id, mid)
    if (g !== gen.current) return
    setMsgLoading(false)
    if (isFail(r)) {
      setMsgErr(r.error)
      return
    }
    setMsg(r.message)
  }

  const addrRef = useRef<HTMLElement>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(box.address)
      flash('Адрес скопирован')
    } catch {
      const node = addrRef.current
      if (node) {
        const range = document.createRange()
        range.selectNodeContents(node)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
      flash('Скопировать не удалось — адрес выделен, нажмите Ctrl+C')
    }
  }

  async function extend() {
    setBusy(true)
    const r = await tempApi.extend(id)
    setBusy(false)
    if (isFail(r)) {
      flash(r.error)
      return
    }
    onBox(r.box)
    flash('Ящик продлён на 10 минут')
  }

  const doc = useMemo(() => (msg ? frameDoc(msg) : ''), [msg])
  const code = useMemo(() => (msg ? extractCode(msg.html, msg.text) : null), [msg])
  const remain = left(box.expiresAt, now)

  async function copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      flash(`Код ${value} скопирован`)
    } catch {
      flash(`Код: ${value}`)
    }
  }

  return (
    <>
      <section className="mail-list-col" aria-label="Входящие временного ящика">
        <div className="mail-list-head mail-temp-list-head">
          <span className="mail-inbox-title">
            <IconInbox width={13} height={13} aria-hidden="true" />
            <span className="label-mono">Входящие</span>
            <span className="mail-count num">{rows ? `${rows.length} ${letterWord(rows.length)}` : ''}</span>
          </span>
          <span className="mail-inbox-tools">
            <span
              className="mail-synced mono"
              data-testid="mail-temp-synced"
              title={box.lastSyncAt ? `последняя проверка ${new Date(box.lastSyncAt).toLocaleTimeString('ru-RU')}` : 'ящик ещё не проверялся'}
            >
              {syncing ? 'проверяем…' : box.lastSyncAt ? new Date(box.lastSyncAt).toLocaleTimeString('ru-RU') : ''}
            </span>
            {box.lastSyncAt && (
              <span className="mail-temp-next mono" data-testid="mail-temp-next" title="до следующей автоматической проверки">
                {syncing ? '…' : `+${Math.max(0, Math.ceil((box.lastSyncAt + REFRESH_MS - now) / 1000))} с`}
              </span>
            )}
            <button className="mail-rail-plus" onClick={() => void load()} disabled={syncing} title="Проверить сейчас" aria-label="Обновить" data-testid="mail-temp-refresh">
              <IconRefresh width={12} height={12} aria-hidden="true" className={syncing ? 'mail-spin' : undefined} />
            </button>
          </span>
        </div>
        {err && !rows?.length ? (
          <div className="mail-list-state err" role="alert" data-testid="mail-temp-error">
            {err}
          </div>
        ) : rows === null ? (
          <div className="mail-list-state" data-testid="mail-temp-loading">
            Открываем ящик…
          </div>
        ) : rows.length === 0 ? (
          <div className="mail-temp-idle" data-testid="mail-temp-empty">
            <span className="mail-temp-idle-ico" aria-hidden="true">
              <IconInbox width={20} height={20} />
            </span>
            <b>Ждём первое письмо</b>
            <span>Адрес уже работает. Вставьте его в форму регистрации — письмо появится здесь само, ящик проверяется каждые 15 секунд.</span>
          </div>
        ) : (
          <div className="mail-temp-items" role="list" data-testid="mail-temp-list">
            {rows.map((r) => {
              const on = r.mid === sel
              const pill = subjectCode(r.subject)
              return (
                <div key={r.mid} role="listitem" className={`mail-temp-item${on ? ' on' : ''}`}>
                  <div
                    className="mail-temp-item-main"
                    role="button"
                    tabIndex={0}
                    onClick={() => void open(r.mid)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void open(r.mid)
                      }
                    }}
                    aria-current={on ? 'true' : undefined}
                    data-testid={`mail-temp-open-${r.mid}`}
                  >
                    <span className="mail-temp-ava" aria-hidden="true">
                      {(r.from || '?').replace(/^[^a-zA-Zа-яА-Я0-9]+/, '').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="mail-temp-item-body">
                      <span className="mail-temp-item-top">
                        <span className="mail-temp-item-from">{r.from}</span>
                        {pill && (
                          <button
                            className="mail-temp-pill mono"
                            onClick={(e) => {
                              e.stopPropagation()
                              void copyCode(pill)
                            }}
                            title={`Скопировать код ${pill}`}
                            data-testid={`mail-temp-pill-${r.mid}`}
                          >
                            <IconCopy width={10} height={10} aria-hidden="true" /> {pill}
                          </button>
                        )}
                        <time className="mail-temp-item-date mono" dateTime={r.date ?? undefined}>
                          {fmtMailDate(r.date)}
                        </time>
                      </span>
                      <span className="mail-temp-item-subj">{r.subject || '(без темы)'}</span>
                      {r.intro && <span className="mail-temp-item-intro">{r.intro}</span>}
                    </span>
                  </div>
                </div>
              )
            })}
            <div className="mail-temp-items-foot mono">
              {rows.length} {letterWord(rows.length)} · письма живут, пока жив ящик
            </div>
          </div>
        )}
      </section>

      <section className="mail-view-col" aria-label="Письмо временного ящика">
        <div className="mail-temp-head" data-testid="mail-temp-passport">
          <div className="mail-temp-addr">
            <span className="label-mono">{TEMP_LABEL[box.kind]}</span>
            <b className="mono" ref={addrRef} data-testid="mail-temp-address">
              {box.address}
            </b>
            <span className="mail-temp-facts mono">
              {remain && (
                <span className={box.expiresAt && box.expiresAt - now < 120_000 ? 'warn' : undefined} data-testid="mail-temp-left">
                  <IconClock width={11} height={11} aria-hidden="true" /> {remain}
                </span>
              )}
              <span>только приём писем</span>
            </span>
          </div>
          <div className="mail-temp-acts">
            <button className="btn btn-sm btn-ghost" onClick={() => void copy()} data-testid="mail-temp-copy">
              <IconCopy width={12} height={12} aria-hidden="true" /> Скопировать
            </button>
            {box.kind === 'temp' && (
              <button className="btn btn-sm btn-ghost" onClick={() => void extend()} disabled={busy} data-testid="mail-temp-extend">
                <IconClock width={12} height={12} aria-hidden="true" /> Продлить
              </button>
            )}
            <button className="btn btn-sm btn-ghost mail-del" onClick={onRemove} data-testid="mail-temp-delete">
              <IconTrash width={12} height={12} aria-hidden="true" /> Удалить ящик
            </button>
          </div>
        </div>
        {msgErr ? (
          <div className="mail-view-state err" role="alert" data-testid="mail-temp-msg-error">
            {msgErr}
          </div>
        ) : msg ? (
          <article className="mail-view" data-testid="mail-temp-msg">
            <header className="mail-view-head">
              <div className="mail-view-title">
                <h2 data-testid="mail-temp-msg-subject">{msg.subject || '(без темы)'}</h2>
                {code && (
                  <button className="btn btn-sm btn-primary mail-temp-code" onClick={() => void copyCode(code)} title="Скопировать код подтверждения" data-testid="mail-temp-code">
                    <IconCopy width={12} height={12} aria-hidden="true" /> Код {code}
                  </button>
                )}
              </div>
              <div className="mail-view-meta">
                <span className="mail-avatar" aria-hidden="true">
                  {(msg.from || '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="mail-view-who">
                  <b data-testid="mail-temp-msg-from">{msg.from}</b>
                </div>
                <time className="mail-view-date mono">{fmtMailDateFull(msg.date)}</time>
              </div>
            </header>
            <div className="mail-view-body">
              <iframe
                key={msg.mid}
                className="mail-frame"
                title={`Письмо: ${msg.subject || 'без темы'}`}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                srcDoc={doc}
                data-testid="mail-temp-frame"
              />
            </div>
          </article>
        ) : (
          <div className="mail-view-state" data-testid={msgLoading ? 'mail-temp-msg-loading' : 'mail-temp-msg-empty'}>
            <span className="mail-empty-ico" aria-hidden="true">
              <IconMail />
            </span>
            <span>{msgLoading ? 'Открываем письмо…' : 'Выберите письмо из списка'}</span>
          </div>
        )}
      </section>
    </>
  )
}
