'use client'

import { IconFolder, IconInbox, IconSend, IconTrash } from '../icons'
import type { FolderView } from '@/lib/mail-client'
import { folderLabel } from '@/lib/mail-read'

type Props = { folders: FolderView[] | null; current: string; onPick: (path: string) => void }

function FolderIcon({ f }: { f: FolderView }) {
  const p = { width: 13, height: 13, 'aria-hidden': true as const }
  if (f.specialUse === '\\Inbox' || f.path.toUpperCase() === 'INBOX') return <IconInbox {...p} />
  if (f.specialUse === '\\Sent') return <IconSend {...p} />
  if (f.specialUse === '\\Trash' || f.specialUse === '\\Junk') return <IconTrash {...p} />
  return <IconFolder {...p} />
}

export function MailFolderList({ folders, current, onPick }: Props) {
  if (folders === null) {
    return (
      <div className="mail-folders" data-testid="mail-folders-loading">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="mail-skel" style={{ width: `${70 - i * 10}%` }} />
        ))}
      </div>
    )
  }
  return (
    <nav className="mail-folders" aria-label="Папки" data-testid="mail-folders">
      {folders.map((f) => {
        const on = f.path === current
        const depth = f.delimiter ? f.path.split(f.delimiter).length - 1 : 0
        return (
          <button
            key={f.path}
            className={`mail-folder${on ? ' on' : ''}${f.unseen ? ' has-unseen' : ''}`}
            style={depth ? { paddingLeft: 12 + depth * 10 } : undefined}
            onClick={() => onPick(f.path)}
            aria-current={on ? 'true' : undefined}
            title={f.total !== null ? `${f.path} · всего ${f.total}` : f.path}
            data-testid={`mail-folder-${f.path}`}
          >
            <FolderIcon f={f} />
            <span className="mail-folder-name">{folderLabel(f)}</span>
            {f.unseen ? (
              <span className="mail-folder-unseen num" data-testid={`mail-folder-unseen-${f.path}`}>
                {f.unseen}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
