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
import { LogoWord } from '@/components/screen-lock-logo'
import { PasswordInput } from '@/components/password-input'
import { PlanBadge } from '@/components/plan-badge'
import { installStorageScope } from '@/lib/db/scope'
import { KEY_RE, accessState, normalizeKey, type AccessState, type FeatureId, type UserView } from '@/lib/users'

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
      /* Сохраняем код-приглашение до редиректа на вход — иначе «/?cloud=КОД»
         потеряется, и друг не подключится к облаку автоматически. */
      try {
        const c = new URL(window.location.href).searchParams.get('cloud')
        if (c) sessionStorage.setItem('wsx-cloud-code', c)
      } catch {
        /* приватный режим */
      }
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
    try {
      localStorage.removeItem('wf.nav.prefs.v1')
    } catch {
      /* приватный режим */
    }
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
      <span data-testid="account-splash-status">{text}</span>
      {action && (
        <button className="btn btn-ghost" onClick={action.onClick} data-testid="account-retry">
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
    <main className="access-scene" data-testid="access-wall" data-access={access}>
      <div className="access-stack">
      <div className="access-brand" data-testid="wall-brand"><LogoWord /></div>
      <div className="access-card access-account-card">
      <div className="access-body">
        <div className="access-who" data-testid="wall-user">@{user.login}</div>
        {access === 'blocked' && (
          <>
            <h1 data-testid="wall-blocked-title">Аккаунт заблокирован</h1>
            <p data-testid="wall-blocked-description">Администратор приостановил доступ. Локальные данные в этом браузере не тронуты.</p>
          </>
        )}
        {access === 'password' && <PasswordForm onDone={refresh} />}
        {access === 'license' && <LicenseForm onDone={refresh} user={user} />}
        <button className="access-link" onClick={() => void logout()} data-testid="wall-logout">
          Выйти
        </button>
      </div>
      </div>
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
    <form className="access-account-form" onSubmit={submit} data-testid="wall-password-form">
      <h1 data-testid="wall-password-title">Смените временный пароль</h1>
      <p data-testid="wall-password-description">Задайте свой пароль вместо выданного администратором.</p>
      <div className="access-field">
        <label htmlFor="wall-password-new" data-testid="wall-password-next-label">Новый пароль</label>
        <PasswordInput id="wall-password-new" placeholder="Не менее 8 символов" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" testId="wall-password-next" />
      </div>
      <div className="access-field">
        <label htmlFor="wall-password-repeat" data-testid="wall-password-again-label">Повторите пароль</label>
        <PasswordInput id="wall-password-repeat" placeholder="Тот же пароль ещё раз" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" testId="wall-password-again" />
      </div>
      {err && (
        <p className="mk-err" role="alert" data-testid="wall-error">
          {err}
        </p>
      )}
      <button className="access-primary" disabled={busy || next.length < 8} data-testid="wall-password-submit">
        {busy ? 'Сохраняем…' : 'Сохранить и войти'}
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
    <form className="access-account-form" onSubmit={submit} data-testid="wall-license-form">
      <h1 data-testid="wall-license-title">{expired ? 'Срок лицензии истёк' : 'Нужен ключ лицензии'}</h1>
      <div className="adm-inline">
        <PlanBadge plan={user.plan} lg />
        {expired && <span className="label-mono">закончилась {new Date(user.licenseUntil!).toLocaleDateString('ru-RU')}</span>}
      </div>
      <p data-testid="wall-license-description">
        {expired
          ? 'Введите новый ключ от администратора. Срок и тариф обновятся по этому ключу.'
          : 'Введите ключ лицензии, выданный администратором.'}
      </p>
      <input
        className="access-input num"
        aria-label="Ключ лицензии"
        placeholder="WSX-XXXX-XXXX-XXXX-XXXX"
        value={key}
        onChange={(e) => setKey(e.target.value.trim() ? normalizeKey(e.target.value) : '')}
        autoComplete="off"
        spellCheck={false}
        maxLength={23}
        data-testid="wall-license-key"
      />
      {err && (
        <p className="mk-err" role="alert" data-testid="wall-error">
          {err}
        </p>
      )}
      <button className="access-primary" disabled={busy || !KEY_RE.test(key)} data-testid="wall-license-submit">
        Активировать
      </button>
    </form>
  )
}
