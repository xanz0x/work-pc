'use client'

/* ============================================================
   ПОЧТА · один экран без прокрутки страницы: рейка ящиков и папок → список → письмо/паспорт ящика.
   «Написать» и «Добавить ящик» — окна поверх клиента.
   ============================================================ */

import '@/app/styles/screen-mail.css'
import { useCallback, useEffect, useState } from 'react'
import { IconAlertTri, IconMail, IconPlus, IconSend } from './icons'
import { MailAddDialog } from './mail/mail-add-dialog'
import { MailComposeDialog } from './mail/mail-compose-dialog'
import { MailInbox } from './mail/mail-inbox'
import { logJournal } from '@/lib/journal'
import { isFail, mailApi, type AccountView } from '@/lib/mail-client'
import { useToast } from '@/lib/vault-store'

const ACTIVE_KEY = 'wf.mail.active.v1'

export function ScreenMail() {
  const { flash } = useToast()
  const [accounts, setAccounts] = useState<AccountView[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [adding, setAdding] = useState(false)
  const [composing, setComposing] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tempAddress, setTempAddress] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await mailApi.list()
    if (isFail(r)) {
      flash(r.error)
      setAccounts([])
      return
    }
    setEnabled(r.enabled)
    setAccounts(r.accounts)
    setActiveId((cur) => {
      const want = cur ?? window.localStorage.getItem(ACTIVE_KEY)
      return want && r.accounts.some((a) => a.id === want) ? want : r.accounts[0]?.id ?? null
    })
  }, [flash])

  useEffect(() => {
    void reload()
  }, [reload])

  function pick(id: string) {
    setActiveId(id)
    window.localStorage.setItem(ACTIVE_KEY, id)
  }

  const patchAccount = useCallback((id: string, patch: Partial<AccountView>) => {
    setAccounts((cur) => cur?.map((a) => (a.id === id ? { ...a, ...patch } : a)) ?? null)
  }, [])

  async function test(id: string) {
    setBusyId(id)
    const r = await mailApi.test(id)
    setBusyId(null)
    if (isFail(r)) {
      flash(r.error)
      return
    }
    patchAccount(id, r.account)
    if (r.checks.smtp === 'ok' && r.checks.imap !== 'fail') flash('Соединение в порядке: SMTP и IMAP отвечают')
    else {
      flash(r.checks.error ?? 'Проверка не пройдена')
      void logJournal('mail-auth-failed', 'Почта: проверка не пройдена', `Ящик «${r.account.name}» (${r.account.email}): ${r.checks.error ?? 'сервер отклонил соединение'}`)
    }
  }

  async function remove(acc: AccountView) {
    const r = await mailApi.remove(acc.id)
    if (isFail(r)) {
      flash(r.error)
      return
    }
    void logJournal('mail-account-removed', 'Почта: ящик удалён', `«${acc.name}» (${acc.email}) убран с сервера вместе с зашифрованным паролем`)
    flash(`Ящик «${acc.name}» удалён`)
    await reload()
  }

  const list = accounts ?? []
  const active = list.find((a) => a.id === activeId) ?? null

  return (
    <div className="mail-page" data-testid="mail-screen">
      <header className="mail-bar">
        <span className="mail-bar-title">
          <IconMail width={15} height={15} aria-hidden="true" />
          <h1>Почта</h1>
          <span className="mail-bar-sub">{tempAddress ?? (accounts === null ? 'загрузка…' : active ? active.email : 'ящики не подключены')}</span>
        </span>
        <span className="mail-bar-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)} disabled={!enabled} data-testid="mail-add-bar">
            <IconPlus width={12} height={12} aria-hidden="true" /> Ящик
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setComposing(true)} disabled={!enabled || list.length === 0} data-testid="mail-compose-open">
            <IconSend width={12} height={12} aria-hidden="true" className="mail-rot" /> Написать
          </button>
        </span>
      </header>

      {!enabled && (
        <div className="mail-banner warn" role="alert" data-testid="mail-disabled">
          <IconAlertTri width={15} height={15} aria-hidden="true" />
          <span>
            Модуль выключен: на сервере не задан <code>MAIL_SECRET</code> (32+ символа). Добавьте переменную в <code>.env</code> и перезапустите сервер.
          </span>
        </div>
      )}

      {accounts !== null && (
        <MailInbox
          accounts={list}
          active={active}
          busyId={busyId}
          enabled={enabled}
          onPickAccount={pick}
          onAdd={() => setAdding(true)}
          onTest={(id) => void test(id)}
          onRemove={(acc) => void remove(acc)}
          onCompose={() => setComposing(true)}
          onAccountPatch={patchAccount}
          onTempAddress={setTempAddress}
        />
      )}

      {adding && (
        <MailAddDialog
          onClose={() => setAdding(false)}
          onAdded={(acc) => {
            setAdding(false)
            pick(acc.id)
            void reload()
          }}
        />
      )}
      {composing && (
        <MailComposeDialog
          accounts={list}
          fromId={activeId}
          onFrom={pick}
          onSent={(acc) => patchAccount(acc.id, acc)}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  )
}
