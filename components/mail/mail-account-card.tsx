'use client'

import { useState } from 'react'
import { IconCheck, IconRefresh, IconSend, IconTrash } from '../icons'
import { SOURCE_LABEL, type AccountView, type CheckState } from '@/lib/mail-client'
import { endpointLabel, providerName } from '@/lib/mail-providers'

const STATE_LABEL: Record<CheckState, string> = { ok: 'ok', fail: 'ошибка', unknown: 'не проверено' }

const fmt = (at: number) =>
  new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Dot({ label, state, hint }: { label: string; state: CheckState; hint: string }) {
  return (
    <span className={`mail-dot st-${state}`} title={`${label} ${hint} — ${STATE_LABEL[state]}`} data-testid={`mail-status-${label.toLowerCase()}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  )
}

type Props = {
  account: AccountView
  active: boolean
  busy: boolean
  onPick: () => void
  onTest: () => void
  onRemove: () => void
}

export function MailAccountCard({ account: a, active, busy, onPick, onTest, onRemove }: Props) {
  const [armed, setArmed] = useState(false)

  function remove() {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 5000)
      return
    }
    setArmed(false)
    onRemove()
  }

  const imapState: CheckState = a.imap ? a.status.imap : 'unknown'

  return (
    <article className={`mail-card${active ? ' active' : ''}`} data-testid={`mail-account-row-${a.id}`} data-account-id={a.id}>
      <button className="mail-card-main" onClick={onPick} title="Писать с этого ящика" data-testid="mail-account-pick">
        <span className="mail-avatar" aria-hidden="true">
          {a.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="mail-card-text">
          <span className="mail-card-top">
            <b className="mail-card-name">{a.name}</b>
            <i className="mail-provider">{providerName(a.provider)}</i>
            {a.bridge && <i className="mail-provider">Bridge</i>}
            {active && (
              <span className="mail-active-flag">
                <IconCheck width={10} height={10} aria-hidden="true" /> от кого
              </span>
            )}
          </span>
          <span className="mail-card-email mono" data-testid="mail-account-email">
            {a.email}
          </span>
          <span className="mail-card-meta mono">
            <Dot label="SMTP" state={a.status.smtp} hint={endpointLabel(a.smtp)} />
            <Dot label="IMAP" state={imapState} hint={endpointLabel(a.imap)} />
            <span className="mail-meta-sep">·</span>
            <span>{SOURCE_LABEL[a.discovery.source] ?? a.discovery.source}</span>
            {a.imapSync && (
              <>
                <span className="mail-meta-sep">·</span>
                <span className={a.imapSync.unseen ? 'mail-unseen-live' : undefined} title={`Синхронизация ${fmt(a.imapSync.at)} · всего ${a.imapSync.total}`} data-testid="mail-account-unseen">
                  {a.imapSync.unseen ? `${a.imapSync.unseen} непрочит.` : 'всё прочитано'}
                </span>
              </>
            )}
            {a.sentCount > 0 && (
              <>
                <span className="mail-meta-sep">·</span>
                <span>
                  <IconSend width={10} height={10} aria-hidden="true" /> {a.sentCount}
                </span>
              </>
            )}
          </span>
          {a.status.error && (a.status.smtp === 'fail' || imapState === 'fail') && (
            <span className="mail-card-err" data-testid="mail-account-error">
              {a.status.error}
            </span>
          )}
        </span>
      </button>
      <div className="mail-card-actions">
        <span className="mail-checked mono" title="Последняя проверка">
          {fmt(a.status.checkedAt)}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={onTest} disabled={busy} title="Проверить SMTP и IMAP" data-testid="mail-account-test">
          <IconRefresh width={12} height={12} aria-hidden="true" className={busy ? "mail-spin" : undefined} />
          {busy ? 'Проверяем…' : 'Проверить'}
        </button>
        <button
          className={`btn btn-sm mail-del ${armed ? 'btn-danger' : 'btn-ghost'}`}
          onClick={remove}
          title="Удалить ящик с сервера"
          aria-label={`Удалить ящик ${a.name}`}
          data-testid="mail-account-delete"
        >
          <IconTrash width={12} height={12} aria-hidden="true" />
          {armed ? 'Точно удалить?' : 'Удалить'}
        </button>
      </div>
    </article>
  )
}
