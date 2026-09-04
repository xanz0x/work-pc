'use client'

/* Диалог «Добавить ящик»: три поля → живой автопоиск → подсказка про пароль
   ДО ввода → шаги проверки SMTP/IMAP → готово или «Настроить вручную». */

import { useEffect, useRef, useState } from 'react'
import { DialogShell } from '../dialog-shell'
import { IconAlertTri, IconCheck, IconClose, IconExternal, IconRefresh } from '../icons'
import { logJournal } from '@/lib/journal'
import { SOURCE_LABEL, isFail, mailApi, type AccountView, type AuthHint, type Discovery, type MailConfig } from '@/lib/mail-client'
import { SECURITY_LABEL, endpointLabel, type Endpoint, type Security } from '@/lib/mail-providers'

type Step = 'idle' | 'run' | 'ok' | 'fail' | 'skip'
type Steps = { discover: Step; smtp: Step; imap: Step }
const STEPS_IDLE: Steps = { discover: 'idle', smtp: 'idle', imap: 'idle' }

const EMAIL_RE = /^[^\s@"'<>]+@([a-z0-9-]+\.)+[a-z]{2,}$/i
const domainOf = (e: string) => e.trim().toLowerCase().split('@')[1] ?? ''

type EpFields = { host: string; port: string; security: Security }
const epToFields = (e: Endpoint | null): EpFields => ({ host: e?.host ?? '', port: e ? String(e.port) : '', security: e?.security ?? 'ssl' })
const fieldsToEp = (f: EpFields): Endpoint => ({ host: f.host.trim(), port: Number(f.port), security: f.security })

function HintPlaque({ hint, testId }: { hint: AuthHint; testId: string }) {
  return (
    <div className={`mail-hint kind-${hint.kind}`} role="note" data-testid={testId}>
      <IconAlertTri width={14} height={14} aria-hidden="true" />
      <div className="mail-hint-text">
        <b>{hint.title}</b>
        <span>{hint.text}</span>
        {hint.url && (
          <a href={hint.url} target="_blank" rel="noreferrer noopener" className="mail-hint-link" data-testid="mail-hint-link">
            {hint.urlLabel ?? 'Где взять'} <IconExternal width={11} height={11} aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  )
}

function StepRow({ state, label, detail }: { state: Step; label: string; detail?: string }) {
  return (
    <li className={`mail-step st-${state}`} data-testid={`mail-step-${label}`} data-state={state}>
      <span className="mail-step-ico" aria-hidden="true">
        {state === 'ok' ? <IconCheck width={11} height={11} /> : state === 'fail' ? <IconClose width={11} height={11} /> : state === 'run' ? <IconRefresh width={11} height={11} className="mail-spin" /> : null}
      </span>
      <span className="mail-step-label">{detail ?? label}</span>
    </li>
  )
}

function EndpointFields({ id, label, value, onChange, optional }: { id: string; label: string; value: EpFields | null; onChange: (v: EpFields | null) => void; optional?: boolean }) {
  return (
    <fieldset className="mail-ep">
      <legend className="label-mono">
        {label}
        {optional && (
          <label className="mail-ep-opt">
            <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : epToFields(null))} data-testid={`mail-${id}-off`} /> без {label}
          </label>
        )}
      </legend>
      {value && (
        <div className="mail-ep-row">
          <input className="mcp-input" placeholder="host" value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value })} data-testid={`mail-${id}-host`} />
          <input className="mcp-input mail-port" placeholder="порт" inputMode="numeric" value={value.port} onChange={(e) => onChange({ ...value, port: e.target.value.replace(/\D/g, '') })} data-testid={`mail-${id}-port`} />
          <select className="mcp-input mail-sec" value={value.security} onChange={(e) => onChange({ ...value, security: e.target.value as Security })} data-testid={`mail-${id}-security`}>
            {(Object.keys(SECURITY_LABEL) as Security[]).map((s) => (
              <option key={s} value={s}>
                {SECURITY_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      )}
    </fieldset>
  )
}

export function MailAddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (a: AccountView) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [login, setLogin] = useState('')
  const [disc, setDisc] = useState<Discovery | null>(null)
  const [discState, setDiscState] = useState<'idle' | 'loading' | 'done' | 'none' | 'error'>('idle')
  const [manual, setManual] = useState(false)
  const [smtp, setSmtp] = useState<EpFields>(epToFields(null))
  const [imap, setImap] = useState<EpFields | null>(epToFields(null))
  const [phase, setPhase] = useState<'form' | 'checking' | 'done' | 'failed'>('form')
  const [steps, setSteps] = useState<Steps>(STEPS_IDLE)
  const [err, setErr] = useState<{ code: string; error: string; hint?: AuthHint } | null>(null)
  const lastDomain = useRef('')

  /* Автопоиск по домену: как только адрес стал валидным, с паузой 500 мс. */
  useEffect(() => {
    if (!EMAIL_RE.test(email.trim())) return
    const domain = domainOf(email)
    if (domain === lastDomain.current) return
    const t = setTimeout(async () => {
      lastDomain.current = domain
      setDiscState('loading')
      setDisc(null)
      const r = await mailApi.discover(email.trim())
      if (isFail(r)) {
        setDiscState('error')
        return
      }
      setDisc(r)
      const best = r.candidates[0]
      setDiscState(best ? 'done' : 'none')
      if (best) {
        setSmtp(epToFields(best.config.smtp))
        setImap(best.config.imap ? epToFields(best.config.imap) : null)
      }
      if (!best) setManual(true)
    }, 500)
    return () => clearTimeout(t)
  }, [email])

  const best = disc?.candidates[0] ?? null
  const hint = disc?.hint ?? null
  const oauthBlocked = hint?.kind === 'oauth' && !manual
  const canSubmit = phase !== 'checking' && EMAIL_RE.test(email.trim()) && password.length > 0 && !oauthBlocked && (!manual || (smtp.host.trim() && smtp.port))

  function prefillManual(cfg: MailConfig | null) {
    setManual(true)
    if (cfg) {
      setSmtp(epToFields(cfg.smtp))
      setImap(cfg.imap ? epToFields(cfg.imap) : null)
    }
    setPhase('form')
    setSteps(STEPS_IDLE)
  }

  async function submit() {
    if (!canSubmit) return
    setErr(null)
    setPhase('checking')
    setSteps({ discover: manual ? 'skip' : best ? 'ok' : 'run', smtp: 'run', imap: 'idle' })
    const config: MailConfig | null = manual ? { smtp: fieldsToEp(smtp), imap: imap ? fieldsToEp(imap) : null } : null
    const r = await mailApi.create({ name, email: email.trim(), password, user: login.trim() || undefined, config })
    if (isFail(r)) {
      const c = r.checks
      setSteps({
        discover: r.code === 'NO_CONFIG' ? 'fail' : manual ? 'skip' : 'ok',
        smtp: c?.smtp === 'ok' ? 'ok' : r.code === 'NO_CONFIG' ? 'idle' : 'fail',
        imap: c?.imap === 'ok' ? 'ok' : c?.imap === 'fail' ? 'fail' : 'idle',
      })
      setErr({ code: r.code, error: r.error, hint: r.hint })
      setPhase('failed')
      if (r.code !== 'INVALID_ARGS' && r.code !== 'RATE_LIMITED') {
        void logJournal('mail-auth-failed', 'Почта: ящик не подключён', `${email.trim()} — ${r.error}`)
      }
      return
    }
    setSteps({ discover: manual ? 'skip' : 'ok', smtp: 'ok', imap: r.checks.imap === 'ok' ? 'ok' : r.checks.imap === 'fail' ? 'fail' : 'skip' })
    setPhase('done')
    void logJournal(
      'mail-account-added',
      'Почта: ящик добавлен',
      `«${r.account.name}» (${r.account.email}) · SMTP ${endpointLabel(r.account.smtp)} · IMAP ${endpointLabel(r.account.imap)} · источник: ${SOURCE_LABEL[r.source] ?? r.source}`,
    )
    setTimeout(() => onAdded(r.account), 900)
  }

  const discoverText =
    discState === 'loading'
      ? `Ищем настройки для ${domainOf(email)}…`
      : discState === 'done' && best
        ? `${endpointLabel(best.config.smtp)} · ${best.config.imap ? endpointLabel(best.config.imap) : 'IMAP не найден'} · источник: ${SOURCE_LABEL[best.source] ?? best.source}`
        : discState === 'none'
          ? `Настройки для ${domainOf(email)} не нашлись — укажите хосты вручную`
          : discState === 'error'
            ? 'Автопоиск недоступен — можно настроить вручную'
            : 'Введите адрес — настройки найдём автоматически'

  return (
    <DialogShell className="mail-modal" label="Добавить почтовый ящик" onClose={onClose} testId="mail-add-dialog">
      <div className="mail-dlg" data-testid="mail-add-form">
        <div className="mail-dlg-head">
          <div>
            <b>Новый ящик</b>
            <span>Название, адрес и пароль — остальное найдём</span>
          </div>
          <button className="mcp-x" onClick={onClose} aria-label="Закрыть" data-testid="mail-add-close">
            <IconClose width={12} height={12} aria-hidden="true" />
          </button>
        </div>

        <label className="mail-field">
          <span className="label-mono">Название</span>
          <input className="mcp-input" placeholder="Рабочая, Личная, Claude на ноутбуке…" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus data-testid="mail-name" />
        </label>

        <label className="mail-field">
          <span className="label-mono">Адрес почты</span>
          <input className="mcp-input mono" type="email" placeholder="name@example.com" value={email} autoComplete="off" spellCheck={false} onChange={(e) => setEmail(e.target.value)} data-testid="mail-email" />
        </label>

        <div className={`mail-discover st-${discState}`} role="status" data-testid="mail-discover-status">
          {discState === 'loading' && <IconRefresh width={12} height={12} className="mail-spin" aria-hidden="true" />}
          {discState === 'done' && <IconCheck width={12} height={12} aria-hidden="true" />}
          <span>{discoverText}</span>
          {disc?.provider && <i className="mail-provider">{disc.provider.name}</i>}
        </div>

        {hint && hint.kind !== 'plain' && <HintPlaque hint={hint} testId="mail-auth-hint" />}

        <label className="mail-field">
          <span className="label-mono">{hint?.kind === 'app-password' ? 'Пароль приложения' : hint?.kind === 'bridge' ? 'Пароль из Proton Bridge' : 'Пароль'}</span>
          <input className="mcp-input mono" type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} data-testid="mail-password" />
        </label>

        <button className="mail-manual-toggle" onClick={() => (manual ? setManual(false) : prefillManual(best?.config ?? null))} aria-expanded={manual} data-testid="mail-manual-toggle">
          {manual ? 'Скрыть ручные настройки' : 'Настроить вручную'}
        </button>

        {manual && (
          <div className="mail-manual" data-testid="mail-manual">
            <label className="mail-field">
              <span className="label-mono">Логин (если не равен адресу)</span>
              <input className="mcp-input mono" placeholder={email.trim() || 'login'} value={login} onChange={(e) => setLogin(e.target.value)} data-testid="mail-login" />
            </label>
            <EndpointFields id="smtp" label="SMTP" value={smtp} onChange={(v) => v && setSmtp(v)} />
            <EndpointFields id="imap" label="IMAP" value={imap} onChange={setImap} optional />
            <p className="setting-note">Без шифрования — только для 127.0.0.1 (Proton Bridge). Разрешённые порты: 25, 465, 587, 143, 993.</p>
          </div>
        )}

        {phase !== 'form' && (
          <ol className="mail-steps" data-testid="mail-steps">
            <StepRow state={steps.discover} label="discover" detail={steps.discover === 'skip' ? 'Настройки заданы вручную' : 'Ищем настройки'} />
            <StepRow state={steps.smtp} label="smtp" detail={`Проверяем SMTP${smtp.host ? ` · ${smtp.host}:${smtp.port}` : ''}`} />
            <StepRow state={steps.imap} label="imap" detail={steps.imap === 'skip' ? 'IMAP не настроен' : `Проверяем IMAP${imap?.host ? ` · ${imap.host}:${imap.port}` : ''}`} />
            {phase === 'done' && (
              <li className="mail-step st-ok" data-testid="mail-step-done">
                <span className="mail-step-ico" aria-hidden="true">
                  <IconCheck width={11} height={11} />
                </span>
                <span className="mail-step-label">
                  <b>Готово</b> — ящик сохранён{steps.imap === 'fail' ? ', IMAP пока не отвечает (отправка работает)' : ''}
                </span>
              </li>
            )}
          </ol>
        )}

        {err && (
          <div className="mail-error" role="alert" data-testid="mail-add-error">
            <b>{err.error}</b>
            {err.hint && err.hint.kind !== 'plain' && err.hint.kind !== hint?.kind && <HintPlaque hint={err.hint} testId="mail-error-hint" />}
            {!manual && err.code !== 'RATE_LIMITED' && (
              <button className="btn btn-sm btn-ghost" onClick={() => prefillManual(best?.config ?? null)} data-testid="mail-error-manual">
                Настроить вручную
              </button>
            )}
          </div>
        )}

        <div className="mail-dlg-foot">
          {oauthBlocked && <span className="setting-note">Этот провайдер требует OAuth2 — появится в следующей версии</span>}
          <span className="grow" />
          <button className="btn btn-ghost" onClick={onClose} data-testid="mail-add-cancel">
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={!canSubmit} data-testid="mail-add-submit">
            {phase === 'checking' ? 'Проверяем…' : phase === 'failed' ? 'Повторить' : 'Подключить'}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
