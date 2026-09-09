'use client'

import { IconClip, IconRefresh } from '../icons'
import type { MessageRow } from '@/lib/mail-client'
import { addrLabel, fmtMailDate, letterWord } from '@/lib/mail-format'

export function Star({ on, size = 12 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.6l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.9l-5.4 2.9 1.2-5.9L3.4 9.8l6-.7z" />
    </svg>
  )
}

type Props = {
  rows: MessageRow[] | null
  total: number
  selected: number | null
  loading: boolean
  more: boolean
  error: string | null
  onPick: (uid: number) => void
  onStar: (row: MessageRow) => void
  onMore: () => void
}

export function MailMsgList({ rows, total, selected, loading, more, error, onPick, onStar, onMore }: Props) {
  if (error && !rows) {
    return (
      <div className="mail-list-state err" role="alert" data-testid="mail-list-error">
        {error}
      </div>
    )
  }
  if (rows === null) {
    return (
      <div className="mail-list-state" data-testid="mail-list-loading">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="mail-row-skel">
            <span className="mail-skel" style={{ width: '45%' }} />
            <span className="mail-skel" style={{ width: `${85 - i * 8}%` }} />
          </div>
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="mail-list-state" data-testid="mail-list-empty">
        В этой папке писем нет.
      </div>
    )
  }
  return (
    <div className="mail-rows" role="list" data-testid="mail-msg-list">
      {rows.map((r) => {
        const on = r.uid === selected
        return (
          <div key={r.uid} role="listitem" className={`mail-row${r.seen ? '' : ' unread'}${on ? ' on' : ''}`} data-testid={`mail-msg-row-${r.uid}`} data-unread={!r.seen || undefined}>
            <button
              className={`mail-row-star${r.flagged ? ' on' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onStar(r)
              }}
              aria-label={r.flagged ? 'Снять звезду' : 'Поставить звезду'}
              aria-pressed={r.flagged}
              data-testid={`mail-msg-star-${r.uid}`}
            >
              <Star on={r.flagged} />
            </button>
            <button className="mail-row-main" onClick={() => onPick(r.uid)} aria-current={on ? 'true' : undefined} data-testid={`mail-msg-open-${r.uid}`}>
              <span className="mail-row-top">
                <span className="mail-row-from">{addrLabel(r.from)}</span>
                <span className="mail-row-date mono">{fmtMailDate(r.date)}</span>
              </span>
              <span className="mail-row-subj">
                {r.hasAttachments && <IconClip width={11} height={11} aria-hidden="true" />}
                {r.subject || '(без темы)'}
              </span>
            </button>
          </div>
        )
      })}
      <div className="mail-rows-foot">
        <span className="mono">
          {rows.length} из {total} {letterWord(total)}
        </span>
        {more && (
          <button className="btn btn-ghost btn-sm" onClick={onMore} disabled={loading} data-testid="mail-msg-more">
            <IconRefresh width={11} height={11} aria-hidden="true" className={loading ? 'mail-spin' : undefined} />
            {loading ? 'Загружаем…' : 'Показать ещё'}
          </button>
        )}
      </div>
    </div>
  )
}
