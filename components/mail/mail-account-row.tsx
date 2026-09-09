'use client'

import { useState } from 'react'
import { IconTrash } from '../icons'
import type { AccountView } from '@/lib/mail-client'

type Props = { account: AccountView; active: boolean; onPick: () => void; onRemove: () => void }

/** Строка ящика в левой рейке: аватар, имя, адрес, непрочитанные, состояние и удаление в два клика. */
export function MailAccountRow({ account: a, active, onPick, onRemove }: Props) {
  const [armed, setArmed] = useState(false)
  const bad = a.status.smtp === 'fail' || (a.imap && a.status.imap === 'fail')
  const unseen = a.imapSync?.unseen ?? 0

  function del(e: React.MouseEvent) {
    e.stopPropagation()
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 5000)
      return
    }
    setArmed(false)
    onRemove()
  }

  return (
    <div
      className={`mail-acc-row${active ? ' on' : ''}${armed ? ' armed' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      aria-current={active ? 'true' : undefined}
      title={a.email}
      data-testid={`mail-account-row-${a.id}`}
      data-account-id={a.id}
    >
      <span className="mail-avatar sm" aria-hidden="true">
        {a.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="mail-acc-text">
        <b>{a.name}</b>
        <span className="mono" data-testid="mail-account-email">
          {a.email}
        </span>
      </span>
      {unseen > 0 && !armed && (
        <span className="mail-folder-unseen num" data-testid="mail-account-unseen">
          {unseen}
        </span>
      )}
      <button
        className={`mail-acc-del${armed ? ' armed' : ''}`}
        onClick={del}
        title={armed ? 'Нажмите ещё раз, чтобы удалить' : `Удалить ящик ${a.name}`}
        aria-label={armed ? `Точно удалить ящик ${a.name}?` : `Удалить ящик ${a.name}`}
        data-testid={`mail-account-row-delete-${a.id}`}
      >
        <IconTrash width={12} height={12} aria-hidden="true" />
        {armed && <span>Точно?</span>}
      </button>
      {!armed && <i className={`mail-acc-dot ${bad ? 'bad' : 'ok'}`} aria-label={bad ? 'есть ошибка соединения' : 'соединение в порядке'} role="img" />}
    </div>
  )
}
