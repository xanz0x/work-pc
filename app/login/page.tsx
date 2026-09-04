'use client'

import { useEffect, useRef, useState } from 'react'
import { IconKey, IconLockRound, IconUser } from '@/components/icons'
import { MeteorLayer } from '@/components/screen-lock'
import { LogoWord } from '@/components/screen-lock-logo'
import { PlanBadge } from '@/components/plan-badge'
import { KEY_RE, loginProblem, normalizeKey, type PlanRef } from '@/lib/users'

type KeyInfo = { plan: PlanRef; tagline: string; days: number }

/**
 * Вход и регистрация. Логин + пароль; пустой логин — вход первого
 * администратора одним паролем (совместимость). Регистрация возможна
 * только по ключу лицензии: ключ проверяется на лету и показывает тариф.
 */
export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [key, setKey] = useState('')
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null)
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* Значение берём из DOM: менеджер паролей и автозаполнение успевают
     заполнить поле до гидратации, и тогда React-state пуст, а поле — нет. */
  const passRef = useRef<HTMLInputElement>(null)
  const loginRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.classList.remove('lock-pending')
  }, [])

  /* Ключ полный → спрашиваем сервер, что за тариф. Один запрос на ключ. */
  useEffect(() => {
    if (mode !== 'register') return
    if (!KEY_RE.test(key)) {
      setKeyInfo(null)
      setKeyErr(null)
      return
    }
    let stale = false
    setKeyBusy(true)
    fetch('/ai-api/auth/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (KeyInfo & { error?: string }) | null
        if (stale) return
        if (r.ok && j) {
          setKeyInfo(j)
          setKeyErr(null)
        } else {
          setKeyInfo(null)
          setKeyErr(j?.error ?? 'Ключ не принят.')
        }
      })
      .catch(() => !stale && setKeyErr('Сервер не ответил.'))
      .finally(() => !stale && setKeyBusy(false))
    return () => {
      stale = true
    }
  }, [key, mode])

  function switchMode(m: 'login' | 'register') {
    setMode(m)
    setErr(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const pass = passRef.current?.value ?? password
    const who = (loginRef.current?.value ?? login).trim()
    if (mode === 'register') {
      const lp = loginProblem(who)
      if (lp) return setErr(lp)
      if (pass.length < 8) return setErr('Пароль — не короче 8 знаков.')
      if (pass !== again) return setErr('Пароли не совпадают.')
      if (!KEY_RE.test(key)) return setErr('Введите ключ лицензии полностью.')
    } else if (pass.length === 0) return setErr('Введите пароль.')
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(mode === 'login' ? '/ai-api/auth/login' : '/ai-api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'login' ? { login: who || undefined, password: pass } : { login: who, password: pass, passwordConfirm: again, key },
        ),
      })
      if (r.ok) {
        window.location.replace('/')
        return
      }
      const j = (await r.json().catch(() => null)) as { error?: string } | null
      setErr(j?.error ?? 'Не удалось войти.')
    } catch {
      setErr('Сервер не ответил.')
    }
    setBusy(false)
  }

  const mismatch = mode === 'register' && again.length > 0 && again !== password
  const canRegister = mode === 'login' || (keyInfo !== null && password.length >= 8 && password === again && login.trim().length >= 3)

  return (
    <main className={`lock-screen login-scene${err ? ' has-error' : ''}`} data-testid="login-page">
      <div className="lock-floor" aria-hidden="true">
        <i />
      </div>
      <MeteorLayer />

      <p className="lock-engrave num">{mode === 'login' ? 'SESSION · ВХОД В УЧЁТНУЮ ЗАПИСЬ' : 'SESSION · РЕГИСТРАЦИЯ ПО КЛЮЧУ'}</p>

      <form className={`lock-card login-card${mode === 'register' ? ' is-register' : ''}`} onSubmit={submit} data-testid="login-form">
        <i className="lock-edge" aria-hidden="true" />
        <div className="lock-head">
          <div className="lock-mark" aria-hidden="true">
            {mode === 'login' ? <IconLockRound /> : <IconKey />}
            <i className="lock-pulse" />
            <i className="lock-pulse p2" />
          </div>
          <h1 className="login-title" data-testid="login-logo">
            <LogoWord className="lock-logo" />
          </h1>
          <p className="lock-tagline">local ai workspace · {mode === 'login' ? 'личный сейф под учётной записью' : 'доступ по ключу лицензии'}</p>
        </div>

        <div className="lock-well login-well">
          <div className="autolock-seg login-mode" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} data-testid="login-tab-login">
              Вход
            </button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')} data-testid="login-tab-register">
              Регистрация
            </button>
          </div>

          {mode === 'register' && (
            <label className="login-field login-key-field">
              <span className="label-mono">ключ лицензии</span>
              <span className="lf-row">
              <IconKey className="lf-ico" aria-hidden="true" />
              <input
                className={`lock-input login-key${keyInfo ? ' ok' : keyErr ? ' bad' : ''}`}
                placeholder="WSX-XXXX-XXXX-XXXX-XXXX"
                value={key}
                onChange={(e) => setKey(e.target.value.trim() ? normalizeKey(e.target.value) : '')}
                onPaste={(e) => {
                  e.preventDefault()
                  setKey(normalizeKey(e.clipboardData.getData('text')))
                }}
                autoComplete="off"
                spellCheck={false}
                maxLength={23}
                data-testid="login-key"
              />
              </span>
              <div className="login-key-state" aria-live="polite">
                {keyBusy && <span className="label-mono">проверяю…</span>}
                {!keyBusy && keyInfo && (
                  <span className="login-key-ok" data-testid="login-key-plan">
                    <PlanBadge plan={keyInfo.plan} />
                    <span>
                      <b>{keyInfo.days} дн.</b> · {keyInfo.tagline}
                    </span>
                  </span>
                )}
                {!keyBusy && keyErr && (
                  <span className="login-err" role="alert" data-testid="login-key-error">
                    {keyErr}
                  </span>
                )}
              </div>
            </label>
          )}

          <label className="login-field">
            <span className="label-mono">{mode === 'login' ? 'логин · пусто = администратор' : 'логин'}</span>
            <span className="lf-row">
            <IconUser className="lf-ico" aria-hidden="true" />
            <input
              className="lock-input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              ref={loginRef}
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase())}
              maxLength={32}
              data-testid="login-login"
            />
            </span>
          </label>
          <label className="login-field">
            <span className="label-mono">пароль</span>
            <span className="lf-row">
            <IconLockRound className="lf-ico" aria-hidden="true" />
            <input
              className="lock-input"
              type="password"
              autoFocus
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              ref={passRef}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
            />
            </span>
          </label>
          {mode === 'register' && (
            <label className="login-field">
              <span className="label-mono">пароль ещё раз</span>
              <span className="lf-row">
              <IconLockRound className="lf-ico" aria-hidden="true" />
              <input
                className={`lock-input${mismatch ? ' bad' : ''}`}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                data-testid="login-password-again"
              />
              </span>
            </label>
          )}

          <button type="submit" className="lock-submit login-submit" disabled={busy || !canRegister} data-testid="login-submit">
            {busy ? 'Проверяю…' : mode === 'login' ? 'Войти' : keyInfo ? `Создать аккаунт · ${keyInfo.plan.name}` : 'Создать аккаунт'}
          </button>

          <p className={`lock-status num${err ? ' err' : ''}`} role={err ? 'alert' : 'status'} data-testid={err ? 'login-error' : undefined}>
            {err ?? (mode === 'login' ? 'Сессия живёт 12 часов · cookie httpOnly' : 'Ключ выдаёт администратор · определяет тариф и срок')}
          </p>
        </div>
      </form>

      <footer className="lock-statusline num">
        <span>SESSION</span>
        <span className="sb-sep ls-aux">·</span>
        <span className="ls-aux">AES-256</span>
        <span className="sb-sep ls-aux">·</span>
        <span className="ls-aux">ДАННЫЕ КАЖДОГО ПОЛЬЗОВАТЕЛЯ ОТДЕЛЕНЫ</span>
        <span className="ls-grow" />
        <span className="ls-attempts">{mode === 'login' ? 'ВХОД' : 'РЕГИСТРАЦИЯ'}</span>
        <span className="sb-sep ls-aux">·</span>
        <span className="ls-net ls-aux">
          <i className="net-dot" />ONLINE · 0 УТЕЧЕК
        </span>
      </footer>
    </main>
  )
}
