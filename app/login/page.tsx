'use client'

import { useEffect, useRef, useState } from 'react'
import { IconKey, IconLockRound } from '@/components/icons'
import { PasswordInput } from '@/components/password-input'
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

  /* Ссылка-приглашение в облако: сохраняем код до входа, чтобы после
     редиректа на «/» каркас подключил друга автоматически. */
  useEffect(() => {
    try {
      const code = new URL(window.location.href).searchParams.get('cloud')
      if (code) sessionStorage.setItem('wsx-cloud-code', code)
    } catch {
      /* приватный режим — пропускаем */
    }
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
    <main className="access-scene" data-testid="login-page">
      <div className="access-stack">
      <div className="access-brand" data-testid="login-logo"><LogoWord /></div>
      <form className="access-card" onSubmit={submit} data-testid="login-form" aria-busy={busy}>
        <header className="access-heading">
          <span className="access-mark" aria-hidden="true">
            {mode === 'login' ? <IconLockRound /> : <IconKey />}
          </span>
          <h1 data-testid="login-heading">{mode === 'login' ? 'Вход в аккаунт' : 'Создание аккаунта'}</h1>
          <p data-testid="login-description">{mode === 'login' ? 'Введите логин и пароль.' : 'Нужен ключ лицензии от администратора.'}</p>
        </header>
        <div className="access-body">
          <div className="access-tabs" role="tablist" aria-label="Вход или регистрация">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} data-testid="login-tab-login">
              Вход
            </button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')} data-testid="login-tab-register">
              Регистрация
            </button>
          </div>

          {mode === 'register' && (
            <div className="access-field">
              <label htmlFor="account-key" data-testid="login-key-label">Ключ лицензии</label>
              <input
                id="account-key"
                className="access-input num"
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
                aria-invalid={!!keyErr}
                aria-describedby="account-key-status"
              />
              <div className="access-key-state" id="account-key-status" aria-live="polite" data-testid="login-key-status">
                {keyBusy && <span data-testid="login-key-checking">Проверяем ключ…</span>}
                {!keyBusy && keyInfo && (
                  <span className="access-key-ok" data-testid="login-key-plan">
                    <PlanBadge plan={keyInfo.plan} />
                    <span>
                      <b>{keyInfo.days} дн.</b> · {keyInfo.tagline}
                    </span>
                  </span>
                )}
                {!keyBusy && keyErr && (
                  <span className="access-error" role="alert" data-testid="login-key-error">
                    {keyErr}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="access-field">
            <label htmlFor="account-login" data-testid="login-login-label">Логин</label>
            <input
              id="account-login"
              className="access-input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              ref={loginRef}
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase())}
              maxLength={32}
              data-testid="login-login"
              placeholder={mode === 'login' ? 'Ваш логин' : 'От 3 до 32 символов'}
            />
          </div>
          <div className="access-field">
            <label htmlFor="account-password" data-testid="login-password-label">Пароль</label>
            <PasswordInput
              id="account-password"
              autoFocus
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              inputRef={passRef}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              testId="login-password"
              placeholder={mode === 'register' ? 'Не менее 8 символов' : 'Введите пароль'}
            />
          </div>
          {mode === 'register' && (
            <div className="access-field">
              <label htmlFor="account-password-again" data-testid="login-password-again-label">Повторите пароль</label>
              <PasswordInput
                id="account-password-again"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                testId="login-password-again"
                aria-invalid={mismatch}
                placeholder="Тот же пароль ещё раз"
              />
              {mismatch && <span className="access-error" data-testid="login-password-mismatch">Пароли не совпадают</span>}
            </div>
          )}

          <button type="submit" className="access-primary" disabled={busy || !canRegister} data-testid="login-submit">
            {busy ? 'Проверяем…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
          {err && <p className="access-alert" role="alert" data-testid="login-error">{err}</p>}
          {mode === 'login' && <p className="access-footnote" data-testid="login-admin-hint">Администратор может войти без логина.</p>}
        </div>
      </form>
      </div>
    </main>
  )
}
