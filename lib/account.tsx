'use client'

/* ============================================================
   АККАУНТ · провайдер и ворота
   До первого рендера приложения нужно знать, кто вошёл: от этого зависит
   локальная база, набор функций и доступ. AccountGate спрашивает сессию,
   ставит область хранилища и показывает либо приложение, либо одну из
   преград: вход, смену временного пароля, ключ лицензии, блокировку.
   ============================================================ */

import '@/app/styles/screen-admin.css'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { IconLogoMark } from '@/components/icons'
import { installStorageScope } from '@/lib/db/scope'
import { accessState, type AccessState, type FeatureId, type UserView } from '@/lib/users'

type Account = {
  user: UserView | null
  access: AccessState | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
  has: (f: FeatureId) => boolean
  isAdmin: boolean
}

const Ctx = createContext<Account | null>(null)

export function useAccount(): Account {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAccount вызван вне AccountGate')
  return v
}

/** Флаг функции для интерфейса: вне провайдера (тесты, сторибук) — всё включено. */
export function useFeature(f: FeatureId): boolean {
  const v = useContext(Ctx)
  return v ? v.has(f) : true
}

/** Рендерит детей, только если функция включена администратором. */
export function FeatureOn({ id, children }: { id: FeatureId; children: ReactNode }) {
  return useFeature(id) ? <>{children}</> : null
}

type SessionResp = { authed: boolean; configured: boolean; user: UserView | null; access: AccessState | null }

async function fetchSession(): Promise<SessionResp | null> {
  try {
    const r = await fetch('/ai-api/auth/session', { cache: 'no-store' })
    return r.ok ? ((await r.json()) as SessionResp) : null
  } catch {
    return null
  }
}

export function AccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [user, setUser] = useState<UserView | null>(null)

  const refresh = useCallback(async () => {
    const s = await fetchSession()
    if (!s) {
      setState('offline')
      return
    }
    if (!s.authed || !s.user) {
      window.location.replace('/login')
      return
    }
    installStorageScope({ id: s.user.id, legacyStore: s.user.legacyStore })
    setUser(s.user)
    setState('ready')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await fetch('/ai-api/auth/session', { method: 'DELETE' }).catch(() => null)
    window.location.replace('/login')
  }, [])

  if (state === 'loading') return <Splash text="Проверяем сессию…" />
  if (state === 'offline') return <Splash text="Сервер не отвечает" action={{ label: 'Повторить', onClick: () => void refresh() }} />
  if (!user) return null

  const access = accessState(user)
  const value: Account = {
    user,
    access,
    refresh,
    logout,
    has: (f) => user.features[f],
    isAdmin: user.role === 'admin',
  }

  return (
    <Ctx.Provider value={value}>
      {access === 'ok' ? children : <AccessWall access={access} user={user} refresh={refresh} logout={logout} />}
    </Ctx.Provider>
  )
}

function Splash({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="acc-splash" data-testid="account-splash">
      <span>{text}</span>
      {action && (
        <button className="btn btn-ghost" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}

/* ---------- преграды ---------- */

function AccessWall({
  access,
  user,
  refresh,
  logout,
}: {
  access: AccessState
  user: UserView
  refresh: () => Promise<void>
  logout: () => Promise<void>
}) {
  return (
    <main className="acc-wall" data-testid="access-wall" data-access={access}>
      <div className="acc-card panel">
        <span className="login-mark" aria-hidden="true">
          <IconLogoMark />
        </span>
        <div className="label-mono acc-who">{user.email}</div>
        {access === 'blocked' && (
          <>
            <h1>Учётная запись заблокирована</h1>
            <p>Администратор приостановил доступ. Локальные данные в этом браузере не тронуты.</p>
          </>
        )}
        {access === 'password' && <PasswordForm onDone={refresh} />}
        {access === 'license' && <LicenseForm onDone={refresh} user={user} />}
        <button className="btn btn-ghost acc-logout" onClick={() => void logout()} data-testid="wall-logout">
          Выйти
        </button>
      </div>
    </main>
  )
}

function PasswordForm({ onDone }: { onDone: () => Promise<void> }) {
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== again) return setErr('Пароли не совпадают')
    setBusy(true)
    setErr(null)
    const r = await fetch('/ai-api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next }),
    })
    setBusy(false)
    if (!r.ok) return setErr(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Не удалось сменить пароль')
    await onDone()
  }
  return (
    <form onSubmit={submit} data-testid="wall-password-form">
      <h1>Смените временный пароль</h1>
      <p>Пароль выдал администратор — задайте свой, не короче 8 знаков.</p>
      <input className="mcp-input" type="password" placeholder="Новый пароль" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" data-testid="wall-password-next" />
      <input className="mcp-input" type="password" placeholder="Ещё раз" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" data-testid="wall-password-again" />
      {err && (
        <p className="mk-err" role="alert" data-testid="wall-error">
          {err}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy || next.length < 8} data-testid="wall-password-submit">
        Сохранить и войти
      </button>
    </form>
  )
}

function LicenseForm({ onDone, user }: { onDone: () => Promise<void>; user: UserView }) {
  const [key, setKey] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const expired = user.licenseUntil !== null
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await fetch('/ai-api/auth/license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    setBusy(false)
    if (!r.ok) return setErr(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Ключ не принят')
    await onDone()
  }
  return (
    <form onSubmit={submit} data-testid="wall-license-form">
      <h1>{expired ? 'Срок лицензии истёк' : 'Нужен ключ лицензии'}</h1>
      <p>
        Учётная запись создана. Чтобы работать, введите ключ вида WSX-XXXX-XXXX-XXXX-XXXX — его выдаёт
        администратор на определённый срок.
      </p>
      <input
        className="mcp-input acc-key"
        placeholder="WSX-XXXX-XXXX-XXXX-XXXX"
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase())}
        autoComplete="off"
        spellCheck={false}
        data-testid="wall-license-key"
      />
      {err && (
        <p className="mk-err" role="alert" data-testid="wall-error">
          {err}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy || key.length < 23} data-testid="wall-license-submit">
        Активировать
      </button>
    </form>
  )
}
