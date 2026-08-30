'use client'

import { useState } from 'react'
import { IconLockRound } from '@/components/icons'

/**
 * Вход паролем приложения. Пароль сверяется на сервере, наружу уходит только
 * подписанная httpOnly-cookie: в localStorage и в бандле его нет.
 */
export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/ai-api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
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
          <IconLockRound />
        </span>
        <h1 className="login-title">WorkfloW</h1>
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
          disabled={busy || !password}
          data-testid="login-submit"
        >
          {busy ? 'Проверяю…' : 'Войти'}
        </button>
        <p className="login-foot mono">сессия живёт 12 часов · cookie httpOnly</p>
      </form>
    </main>
  )
}
