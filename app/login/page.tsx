'use client'

import { useRef, useState } from 'react'
import { IconLogoMark } from '@/components/icons'
import { LogoWord } from '@/components/screen-lock-logo'

/**
 * Вход и регистрация. Email + пароль; пустой email — вход первого
 * администратора одним паролем (совместимость). Наружу уходит только
 * подписанная httpOnly-cookie: в localStorage и в бандле пароля нет.
 * Новый аккаунт создаётся сразу, но работать начнёт после ключа лицензии.
 */
export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* Значение берём из DOM: менеджер паролей и автозаполнение успевают
     заполнить поле до гидратации, и тогда React-state пуст, а поле — нет. */
  const passRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const pass = passRef.current?.value ?? password
    const mail = (emailRef.current?.value ?? email).trim()
    if (pass.length === 0) return setErr('Введите пароль.')
    if (mode === 'register' && !mail) return setErr('Введите email.')
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(mode === 'login' ? '/ai-api/auth/login' : '/ai-api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email: mail || undefined, password: pass } : { email: mail, password: pass, name }),
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

  return (
    <main className="login-page">
      <form className="login-card panel" onSubmit={submit} data-testid="login-form">
        <span className="login-mark" aria-hidden="true">
          <IconLogoMark />
        </span>
        <h1 className="login-title" data-testid="login-logo">
          <LogoWord className="login-logo" />
        </h1>
        <p className="login-note">
          {mode === 'login'
            ? 'Личный сейф под учётной записью: данные, диалоги и ключи каждого пользователя отделены.'
            : 'Аккаунт создаётся сразу. Чтобы начать работу, понадобится ключ лицензии от администратора.'}
        </p>
        <div className="autolock-seg login-mode" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} data-testid="login-tab-login">
            Вход
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')} data-testid="login-tab-register">
            Регистрация
          </button>
        </div>
        <label className="login-field">
          <span className="label-mono">{mode === 'login' ? 'email · пусто = администратор' : 'email'}</span>
          <input
            className="input input-mono"
            type="email"
            autoComplete="username"
            ref={emailRef}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
          />
        </label>
        {mode === 'register' && (
          <label className="login-field">
            <span className="label-mono">имя</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-testid="login-name" />
          </label>
        )}
        <label className="login-field">
          <span className="label-mono">пароль</span>
          <input
            className="input input-mono"
            type="password"
            autoFocus
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            ref={passRef}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="login-password"
          />
        </label>
        {err ? (
          <p className="login-err" role="alert" data-testid="login-error">
            {err}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary login-submit" disabled={busy} data-testid="login-submit">
          {busy ? 'Проверяю…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
        <p className="login-foot mono">сессия живёт 12 часов · cookie httpOnly</p>
      </form>
    </main>
  )
}
