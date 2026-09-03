'use client'

import { useRef, useState } from 'react'
import { IconLogoMark } from '@/components/icons'
import { LogoWord } from '@/components/screen-lock-logo'

/**
 * Вход паролем приложения. Пароль сверяется на сервере, наружу уходит только
 * подписанная httpOnly-cookie: в localStorage и в бандле его нет.
 */
export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* Значение берём из DOM: менеджер паролей и автозаполнение успевают
     заполнить поле до гидратации, и тогда React-state пуст, а поле — нет. */
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const value = inputRef.current?.value ?? password
    if (value.length === 0) {
      setErr('Введите пароль приложения.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/ai-api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }),
      })
      if (r.ok) {
        window.location.replace('/')
        return
      }
      const j = (await r.json().catch(() => null)) as { error?: string } | null
      setErr(j?.error ?? 'Войти не удалось.')
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
          ИИ-слой закрыт паролем приложения: без входа диалоги, промпт и ключ модели недоступны.
        </p>
        <label className="login-field">
          <span className="label-mono">пароль приложения</span>
          <input
            className="input input-mono"
            type="password"
            autoFocus
            autoComplete="current-password"
            ref={inputRef}
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
        <button
          type="submit"
          className="btn btn-primary login-submit"
          disabled={busy}
          data-testid="login-submit"
        >
          {busy ? 'Проверяю…' : 'Войти'}
        </button>
        <p className="login-foot mono">сессия живёт 12 часов · cookie httpOnly</p>
      </form>
    </main>
  )
}
