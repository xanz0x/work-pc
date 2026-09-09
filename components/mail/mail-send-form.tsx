'use client'

/* Форма письма: от кого (ящик), кому, копия, тема, текст, вложения с компьютера. */

import { useRef, useState } from 'react'
import { IconClip, IconClose, IconSend } from '../icons'
import { logJournal } from '@/lib/journal'
import { isFail, mailApi, readAsBase64, type AccountView, type Attachment } from '@/lib/mail-client'
import { fmtBytes } from '@/lib/data'
import { useToast } from '@/lib/vault-store'

const MAX_TOTAL = 15 * 1024 * 1024
const EMAIL_RE = /^[^\s@"'<>]+@([a-z0-9-]+\.)+[a-z]{2,}$/i
const splitAddr = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)

type Props = { accounts: AccountView[]; fromId: string | null; onFrom: (id: string) => void; onSent: (acc: AccountView) => void; onClose?: () => void }

export function MailSendForm({ accounts, fromId, onFrom, onSent, onClose }: Props) {
  const { flash } = useToast()
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const from = accounts.find((a) => a.id === fromId) ?? null
  const total = files.reduce((n, f) => n + f.size, 0)
  const toList = splitAddr(to)
  const toOk = toList.length > 0 && toList.every((a) => EMAIL_RE.test(a))
  const ccOk = splitAddr(cc).every((a) => EMAIL_RE.test(a))
  const canSend = !!from && toOk && ccOk && (subject.trim() || text.trim()) && !busy && total <= MAX_TOTAL

  async function addFiles(list: FileList | null) {
    if (!list) return
    const next = [...files]
    let sum = total
    for (const f of Array.from(list)) {
      if (sum + f.size > MAX_TOTAL) {
        flash('Вложения больше 15 МБ — почтовые серверы такое не примут')
        break
      }
      sum += f.size
      next.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataBase64: await readAsBase64(f) })
    }
    setFiles(next)
  }

  async function send() {
    if (!from || !canSend) return
    setBusy(true)
    setResult(null)
    const r = await mailApi.send(from.id, {
      to,
      cc: cc.trim() || undefined,
      subject: subject.trim(),
      text,
      attachments: files.map(({ name, type, dataBase64 }) => ({ name, type, dataBase64 })),
    })
    setBusy(false)
    if (isFail(r)) {
      setResult({ ok: false, text: r.error })
      if (r.code !== 'INVALID_ARGS') void logJournal('mail-auth-failed', 'Почта: письмо не отправлено', `С ящика «${from.name}» → ${toList.length} получ. — ${r.error}`)
      return
    }
    onSent(r.account)
    setResult({ ok: true, text: `Отправлено · ${r.recipients} получ.${files.length ? ` · ${files.length} влож.` : ''}` })
    void logJournal('mail-sent', 'Почта: письмо отправлено', `С ящика «${from.name}» (${from.email}) — ${r.recipients} получателей, тема ${subject.trim().length} симв., вложений ${files.length}`)
    flash('Письмо отправлено')
    setTo('')
    setCc('')
    setSubject('')
    setText('')
    setFiles([])
  }

  return (
    <form
      className="mail-compose"
      data-testid="mail-send-form"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <div className="mail-col-head">
        <span className="label-mono">Новое письмо</span>
        <span className="mail-compose-head-r">
          {from ? <span className="mail-from-pill mono" data-testid="mail-send-from">{from.email}</span> : <span className="mask-flag">нет ящика</span>}
          {onClose && (
            <button type="button" className="mcp-x" onClick={onClose} aria-label="Закрыть" data-testid="mail-compose-close">
              <IconClose width={11} height={11} aria-hidden="true" />
            </button>
          )}
        </span>
      </div>

      <label className="mail-field">
        <span className="label-mono">От кого</span>
        <select className="mcp-input" value={from?.id ?? ''} onChange={(e) => onFrom(e.target.value)} disabled={accounts.length === 0} data-testid="mail-send-account">
          {accounts.length === 0 && <option value="">Сначала добавьте ящик</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.email}
            </option>
          ))}
        </select>
      </label>

      <label className="mail-field">
        <span className="label-mono">
          Кому
          {!showCc && (
            <button type="button" className="mail-cc-toggle" onClick={() => setShowCc(true)} data-testid="mail-send-cc-toggle">
              + копия
            </button>
          )}
        </span>
        <input className={`mcp-input mono${to && !toOk ? ' err' : ''}`} placeholder="кому@example.com, ещё@example.com" value={to} onChange={(e) => setTo(e.target.value)} data-testid="mail-send-to" />
      </label>

      {showCc && (
        <label className="mail-field">
          <span className="label-mono">Копия</span>
          <input className={`mcp-input mono${cc && !ccOk ? ' err' : ''}`} value={cc} onChange={(e) => setCc(e.target.value)} data-testid="mail-send-cc" />
        </label>
      )}

      <label className="mail-field">
        <span className="label-mono">Тема</span>
        <input className="mcp-input" value={subject} maxLength={500} onChange={(e) => setSubject(e.target.value)} data-testid="mail-send-subject" />
      </label>

      <label className="mail-field grow">
        <span className="label-mono">Текст</span>
        <textarea className="mcp-input mail-text" value={text} rows={9} onChange={(e) => setText(e.target.value)} data-testid="mail-send-text" />
      </label>

      <input ref={picker} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void addFiles(e.target.files).then(() => (e.target.value = ''))} data-testid="mail-attach-input" />
      {files.length > 0 && (
        <ul className="mail-attach-list" data-testid="mail-attach-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="mail-attach">
              <IconClip width={11} height={11} aria-hidden="true" />
              <span className="ellipsis">{f.name}</span>
              <span className="mono">{fmtBytes(f.size)}</span>
              <button type="button" className="mcp-x" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Убрать ${f.name}`} data-testid="mail-attach-remove">
                <IconClose width={10} height={10} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div className={`mail-result ${result.ok ? 'ok' : 'fail'}`} role="status" data-testid="mail-send-result">
          {result.text}
        </div>
      )}

      <div className="mail-compose-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => picker.current?.click()} data-testid="mail-attach">
          <IconClip width={12} height={12} aria-hidden="true" /> Вложить{files.length ? ` · ${fmtBytes(total)}` : ''}
        </button>
        <span className="grow" />
        <button type="submit" className="btn btn-primary" disabled={!canSend} data-testid="mail-send-submit">
          <IconSend width={12} height={12} aria-hidden="true" className="mail-rot" /> {busy ? 'Отправляем…' : 'Отправить'}
        </button>
      </div>
    </form>
  )
}
