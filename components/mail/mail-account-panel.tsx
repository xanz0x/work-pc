'use client'

/* Правая колонка, пока письмо не выбрано: паспорт активного ящика и его действия. */

import { useState } from 'react'
import { IconRefresh, IconSend, IconShield, IconTrash } from '../icons'
import { SOURCE_LABEL, type AccountView, type CheckState } from '@/lib/mail-client'
import { endpointLabel, providerName } from '@/lib/mail-providers'

const STATE_LABEL: Record<CheckState, string> = { ok: 'работает', fail: 'ошибка', unknown: 'не проверено' }

const fmt = (at: number) => new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Line({ label, state, hint, testId }: { label: string; state: CheckState; hint: string; testId: string }) {
  return (
    <div className="mail-acc-line">
      <span className={`mail-dot st-${state}`} data-testid={testId}>
        <i aria-hidden="true" />
        {label}
      </span>
      <span className="mono mail-acc-host">{hint}</span>
      <span className={`mail-acc-state st-${state}`}>{STATE_LABEL[state]}</span>
    </div>
  )
}

type Props = { account: AccountView; busy: boolean; onTest: () => void; onRemove: () => void; onCompose: () => void }

export function MailAccountPanel({ account: a, busy, onTest, onRemove, onCompose }: Props) {
  const [armed, setArmed] = useState(false)
  const imapState: CheckState = a.imap ? a.status.imap : 'unknown'

  function remove() {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 5000)
      return
    }
    setArmed(false)
    onRemove()
  }

  return (
    <div className="mail-acc-panel" data-testid="mail-account-panel">
      <div className="mail-acc-hero">
        <span className="mail-avatar lg" aria-hidden="true">
          {a.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="mail-acc-hero-text">
          <b>{a.name}</b>
          <span className="mono">{a.email}</span>
          <span className="mail-acc-tags">
            <i className="mail-provider">{providerName(a.provider)}</i>
            {a.bridge && <i className="mail-provider">Bridge</i>}
            <i className="mail-provider">{SOURCE_LABEL[a.discovery.source] ?? a.discovery.source}</i>
          </span>
        </div>
      </div>

      <div className="mail-acc-lines">
        <Line label="SMTP" state={a.status.smtp} hint={endpointLabel(a.smtp)} testId="mail-status-smtp" />
        <Line label="IMAP" state={imapState} hint={a.imap ? endpointLabel(a.imap) : 'не настроен'} testId="mail-status-imap" />
      </div>

      {a.status.error && (a.status.smtp === 'fail' || imapState === 'fail') && (
        <div className="mail-card-err" role="alert" data-testid="mail-account-error">
          {a.status.error}
        </div>
      )}

      <dl className="mail-acc-facts">
        <div>
          <dt>Непрочитанных</dt>
          <dd className="num">{a.imapSync ? a.imapSync.unseen : '—'}</dd>
        </div>
        <div>
          <dt>Во входящих</dt>
          <dd className="num">{a.imapSync ? a.imapSync.total : '—'}</dd>
        </div>
        <div>
          <dt>Отправлено</dt>
          <dd className="num">{a.sentCount}</dd>
        </div>
        <div>
          <dt>Синхронизация</dt>
          <dd className="mono">{a.imapSync ? fmt(a.imapSync.at) : fmt(a.status.checkedAt)}</dd>
        </div>
      </dl>

      <div className="mail-acc-actions">
        <button className="btn btn-primary btn-sm" onClick={onCompose} data-testid="mail-account-compose">
          <IconSend width={12} height={12} aria-hidden="true" /> Написать с этого ящика
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onTest} disabled={busy} title="Проверить SMTP и IMAP" data-testid="mail-account-test">
          <IconRefresh width={12} height={12} aria-hidden="true" className={busy ? 'mail-spin' : undefined} />
          {busy ? 'Проверяем…' : 'Проверить'}
        </button>
        <button className={`btn btn-sm mail-del ${armed ? 'btn-danger' : 'btn-ghost'}`} onClick={remove} aria-label={`Удалить ящик ${a.name}`} data-testid="mail-account-delete">
          <IconTrash width={12} height={12} aria-hidden="true" />
          {armed ? 'Точно удалить?' : 'Удалить'}
        </button>
      </div>

      <p className="mail-note">
        <IconShield width={13} height={13} aria-hidden="true" />
        Только TLS. Пароль хранится на сервере зашифрованным, расшифровывается на время соединения и не попадает в журнал и ответы API.
      </p>
    </div>
  )
}
