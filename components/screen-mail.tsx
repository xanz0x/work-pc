'use client'

/* ============================================================
   ПОЧТА · экран: ящики + отправка (фаза 1)
   Слева — карточки ящиков со статусом SMTP/IMAP, справа — форма письма.
   Добавление — диалог из трёх полей с живыми шагами.
   ============================================================ */

import '@/app/styles/screen-mail.css'
import { useCallback, useEffect, useState } from 'react'
import { IconAlertTri, IconMail, IconPlus, IconShield } from './icons'
import { MailAccountCard } from './mail/mail-account-card'
import { MailAddDialog } from './mail/mail-add-dialog'
import { MailSendForm } from './mail/mail-send-form'
import { logJournal } from '@/lib/journal'
import { isFail, mailApi, type AccountView } from '@/lib/mail-client'
import { useToast } from '@/lib/vault-store'

const boxWord = (n: number) => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'ящик'
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 'ящика'
  return 'ящиков'
}

export function ScreenMail() {
  const { flash } = useToast()
  const [accounts, setAccounts] = useState<AccountView[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [adding, setAdding] = useState(false)
  const [fromId, setFromId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await mailApi.list()
    if (isFail(r)) {
      flash(r.error)
      setAccounts([])
      return
    }
    setEnabled(r.enabled)
    setAccounts(r.accounts)
    setFromId((cur) => cur && r.accounts.some((a) => a.id === cur) ? cur : r.accounts[0]?.id ?? null)
  }, [flash])

  useEffect(() => {
    void reload()
  }, [reload])

  async function test(id: string) {
    setBusyId(id)
    const r = await mailApi.test(id)
    setBusyId(null)
    if (isFail(r)) {
      flash(r.error)
      return
    }
    setAccounts((list) => list?.map((a) => (a.id === id ? r.account : a)) ?? null)
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

  return (
    <div className="mail-page" data-testid="mail-screen">
      <div className="mail-shell">
        <header className="mail-head">
          <div>
            <h1 className="mail-title">Почта</h1>
            <p className="mail-sub">
              Ящики подключаются тремя полями — название, адрес, пароль. Настройки SMTP/IMAP приложение ищет само,
              а пароль хранит на сервере зашифрованным и наружу не отдаёт.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!enabled} data-testid="mail-add">
            <IconPlus width={13} height={13} aria-hidden="true" /> Добавить ящик
          </button>
        </header>

        {!enabled && (
          <div className="mail-banner warn" role="alert" data-testid="mail-disabled">
            <IconAlertTri width={15} height={15} aria-hidden="true" />
            <span>
              Модуль выключен: на сервере не задан <code>MAIL_SECRET</code> (32+ символа). Добавьте переменную в <code>.env</code> и перезапустите сервер.
            </span>
          </div>
        )}

        <div className="mail-grid">
          <section className="mail-col" aria-label="Почтовые ящики">
            <div className="mail-col-head">
              <span className="label-mono">Ящики</span>
              <span className="mail-count num" data-testid="mail-account-count">
                {accounts === null ? '…' : `${list.length} ${boxWord(list.length)}`}
              </span>
            </div>
            {accounts !== null && list.length === 0 && (
              <div className="mail-empty" data-testid="mail-empty">
                <span className="mail-empty-ico" aria-hidden="true">
                  <IconMail />
                </span>
                <b>Добавьте первый ящик</b>
                <span>Gmail, Яндекс, Mail.ru, iCloud, свой домен — настройки найдём автоматически.</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)} disabled={!enabled} data-testid="mail-add-empty">
                  <IconPlus width={12} height={12} aria-hidden="true" /> Добавить ящик
                </button>
              </div>
            )}
            <div className="mail-cards" data-testid="mail-account-list">
              {list.map((a) => (
                <MailAccountCard
                  key={a.id}
                  account={a}
                  active={a.id === fromId}
                  busy={busyId === a.id}
                  onPick={() => setFromId(a.id)}
                  onTest={() => void test(a.id)}
                  onRemove={() => void remove(a)}
                />
              ))}
            </div>
            <p className="mail-note">
              <IconShield width={13} height={13} aria-hidden="true" />
              Только TLS. Пароль расшифровывается на время одного соединения и не попадает в журнал и ответы API.
            </p>
          </section>

          <section className="mail-col" aria-label="Новое письмо">
            <MailSendForm
              accounts={list}
              fromId={fromId}
              onFrom={setFromId}
              onSent={(acc) => setAccounts((cur) => cur?.map((a) => (a.id === acc.id ? acc : a)) ?? null)}
            />
          </section>
        </div>
      </div>

      {adding && (
        <MailAddDialog
          onClose={() => setAdding(false)}
          onAdded={(acc) => {
            setAdding(false)
            setFromId(acc.id)
            void reload()
          }}
        />
      )}
    </div>
  )
}
