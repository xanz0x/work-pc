'use client'

import { DialogShell } from '../dialog-shell'
import { MailSendForm } from './mail-send-form'
import type { AccountView } from '@/lib/mail-client'

type Props = { accounts: AccountView[]; fromId: string | null; onFrom: (id: string) => void; onSent: (acc: AccountView) => void; onClose: () => void }

/** Окно «Новое письмо» поверх клиента — форма фазы 1 без изменений. */
export function MailComposeDialog(p: Props) {
  return (
    <DialogShell className="mail-modal" label="Новое письмо" onClose={p.onClose} testId="mail-compose-dialog">
      <div className="mail-dlg mail-compose-dlg">
        <MailSendForm accounts={p.accounts} fromId={p.fromId} onFrom={p.onFrom} onSent={p.onSent} onClose={p.onClose} />
      </div>
    </DialogShell>
  )
}
