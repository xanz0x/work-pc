'use client'

import type { AccountView } from '@/lib/mail-client'

type Props = { account: AccountView; active: boolean; onPick: () => void }

/** Строка ящика в левой рейке: аватар, имя, адрес, непрочитанные, точка состояния. */
export function MailAccountRow({ account: a, active, onPick }: Props) {
  const bad = a.status.smtp === 'fail' || (a.imap && a.status.imap === 'fail')
  const unseen = a.imapSync?.unseen ?? 0
  return (
    <button
      className={`mail-acc-row${active ? ' on' : ''}`}
      onClick={onPick}
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
      {unseen > 0 && (
        <span className="mail-folder-unseen num" data-testid="mail-account-unseen">
          {unseen}
        </span>
      )}
      <i className={`mail-acc-dot ${bad ? 'bad' : 'ok'}`} aria-label={bad ? 'есть ошибка соединения' : 'соединение в порядке'} role="img" />
    </button>
  )
}
