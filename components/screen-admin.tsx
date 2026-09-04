'use client'

/* ============================================================
   ЭКРАН «АДМИНИСТРИРОВАНИЕ»
   Три вкладки: пользователи (карточка справа), тарифы, ключи лицензий.
   Только роль admin: сервер отвечает ADMIN_ONLY всем остальным.
   ============================================================ */

import '@/app/styles/screen-admin.css'
import '@/app/styles/plans.css'
import { useCallback, useEffect, useState } from 'react'
import { AdminUserCard } from './admin-user-card'
import { AdminLicenses } from './admin-licenses'
import { AdminPlans } from './admin-plans'
import { PlanBadge } from './plan-badge'
import { IconCopy, IconUser } from './icons'
import { adminFetch, fmtDate, genPassword } from './admin-shared'
import { useAccount } from '@/lib/account'
import { LICENSE_TERMS, accessState, type PlanStats, type Role, type UserView } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

type Overview = {
  users: number
  admins: number
  blocked: number
  licensed: number
  expired: number
  expiringSoon: number
  sessions: number
  aiToday: number
  aiTotal: number
  licensesFree: number
  plans: number
}

type Tab = 'users' | 'plans' | 'keys'

const ACCESS_LABEL = { ok: 'работает', blocked: 'заблокирован', license: 'нет лицензии', password: 'сменит пароль' } as const

function CreateUser({ plans, onDone, onClose }: { plans: PlanStats[]; onDone: () => void; onClose: () => void }) {
  const { flash } = useToast()
  const active = plans.filter((p) => !p.archived)
  const [login, setLogin] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState(genPassword)
  const [role, setRole] = useState<Role>('user')
  const [planId, setPlanId] = useState(active[0]?.id ?? '')
  const [days, setDays] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const r = await adminFetch<UserView>('/admin/api/users', {
      method: 'POST',
      body: JSON.stringify({ login, name, password, role, planId: role === 'user' ? planId : null, licenseDays: days || undefined }),
    })
    if (!r.ok) return setErr(r.error)
    setIssued({ login: r.data.login, password })
    setLogin('')
    setName('')
    setPassword(genPassword())
    onDone()
  }

  const plan = active.find((p) => p.id === planId)

  return (
    <form className="adm-create panel" onSubmit={submit} data-testid="admin-create-form">
      <div className="mask-head">
        <span className="label-mono">Новый пользователь вручную · временный пароль сменится при первом входе</span>
        <button type="button" className="mcp-x" onClick={onClose} data-testid="admin-create-close">
          закрыть
        </button>
      </div>
      <div className="adm-grid">
        <input className="mcp-input" placeholder="логин" value={login} onChange={(e) => setLogin(e.target.value.toLowerCase())} maxLength={32} autoCapitalize="none" data-testid="admin-create-login" />
        <input className="mcp-input" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} data-testid="admin-create-name" />
        <input className="mcp-input" placeholder="Временный пароль" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="admin-create-password" />
        <select className="mcp-input" value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="admin-create-role">
          <option value="user">Пользователь</option>
          <option value="admin">Администратор</option>
        </select>
        {role === 'user' ? (
          <select className="mcp-input" value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="admin-create-plan">
            <option value="">Без тарифа (ждёт ключ)</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
        {role === 'user' && planId ? (
          <select className="mcp-input" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="admin-create-days">
            <option value={0}>Срок как в тарифе ({plan?.days} дн.)</option>
            {LICENSE_TERMS.map((t) => (
              <option key={t.days} value={t.days}>
                {t.label}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
        <button className="btn btn-primary" data-testid="admin-create-submit">
          Создать
        </button>
      </div>
      {err && (
        <p className="mk-err" role="alert" data-testid="admin-create-error">
          {err}
        </p>
      )}
      {issued && (
        <div className="mcp-issued" data-testid="admin-created">
          <span className="label-mono">Передайте пользователю — пароль больше не покажется</span>
          <code data-testid="admin-created-creds">
            {issued.login} · {issued.password}
          </code>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard?.writeText(`${issued.login}\n${issued.password}`).then(() => flash('Скопировано'))}
            data-testid="admin-created-copy"
          >
            <IconCopy width={12} height={12} aria-hidden="true" /> Копировать
          </button>
        </div>
      )}
    </form>
  )
}

export function ScreenAdmin() {
  const { isAdmin, user: me } = useAccount()
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<UserView[]>([])
  const [plans, setPlans] = useState<PlanStats[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const reload = useCallback(async () => {
    const [u, o, p] = await Promise.all([
      adminFetch<UserView[]>('/admin/api/users'),
      adminFetch<Overview>('/admin/api/overview'),
      adminFetch<PlanStats[]>('/admin/api/plans'),
    ])
    if (u.ok) setUsers(u.data)
    if (o.ok) setOverview(o.data)
    if (p.ok) setPlans(p.data)
  }, [])

  useEffect(() => {
    if (isAdmin) void reload()
  }, [isAdmin, reload])

  if (!isAdmin) return <div className="screen-admin" data-testid="admin-forbidden">Только для администратора.</div>

  const shown = users.filter((u) => !q || `${u.login} ${u.name} ${u.plan?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const current = users.find((u) => u.id === selected) ?? null

  const stats: [string, number, string][] = overview
    ? [
        ['Пользователей', overview.users, ''],
        ['С лицензией', overview.licensed, 'ok'],
        ['Истекает ≤ 7 дн.', overview.expiringSoon, overview.expiringSoon ? 'warn' : ''],
        ['Без лицензии', overview.expired, overview.expired ? 'warn' : ''],
        ['Заблокировано', overview.blocked, overview.blocked ? 'danger' : ''],
        ['Живых сессий', overview.sessions, ''],
        ['ИИ сегодня', overview.aiToday, ''],
        ['Свободных ключей', overview.licensesFree, 'ok'],
        ['Тарифов', overview.plans, ''],
      ]
    : []

  return (
    <div className="screen-admin" data-testid="screen-admin">
      <header className="act-head">
        <div>
          <h1 className="act-title">Администрирование</h1>
          <p className="act-sub">
            Вы настраиваете тарифы и выдаёте ключи. Пользователь регистрируется только по ключу — и сразу получает
            функции, лимит и срок того тарифа, под который ключ выдан.
          </p>
        </div>
        <div className="adm-tabs" role="tablist" data-testid="admin-tabs">
          <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')} data-testid="admin-tab-users">
            Пользователи <span className="adm-count">{users.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'plans'} className={tab === 'plans' ? 'active' : ''} onClick={() => setTab('plans')} data-testid="admin-tab-plans">
            Тарифы <span className="adm-count">{plans.filter((p) => !p.archived).length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'keys'} className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')} data-testid="admin-tab-keys">
            Ключи <span className="adm-count">{overview?.licensesFree ?? 0}</span>
          </button>
        </div>
      </header>

      {overview && (
        <div className="adm-stats" data-testid="admin-overview">
          {stats.map(([k, v, tone]) => (
            <div key={k} className={`adm-stat panel tone-${tone}`}>
              <b className="num">{v}</b>
              <span className="label-mono">{k}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'plans' && <AdminPlans plans={plans} onChanged={() => void reload()} />}
      {tab === 'keys' && <AdminLicenses plans={plans} onChanged={() => void reload()} />}

      {tab === 'users' && (
        <>
          <div className="adm-inline" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setCreateOpen((o) => !o)} data-testid="admin-create-open">
              <IconUser width={12} height={12} aria-hidden="true" /> Создать вручную
            </button>
          </div>
          {createOpen && <CreateUser plans={plans} onDone={() => void reload()} onClose={() => setCreateOpen(false)} />}
          <div className="adm-body">
            <section className="adm-users panel">
              <div className="mask-head">
                <span className="label-mono">Пользователи · {users.length}</span>
                <input className="mcp-input adm-search" placeholder="Поиск: логин, имя, тариф" value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-search" />
              </div>
              <div className="adm-table" role="table" data-testid="admin-user-list">
                {shown.map((u) => {
                  const acc = accessState(u)
                  return (
                    <button
                      key={u.id}
                      role="row"
                      className={`adm-row${selected === u.id ? ' active' : ''}`}
                      onClick={() => setSelected(u.id)}
                      data-testid="admin-user-row"
                      data-login={u.login}
                    >
                      <span className={`adm-avatar role-${u.role}`} aria-hidden="true">
                        {(u.name || u.login).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="adm-who">
                        <b>
                          {u.name}
                          {u.id === me?.id && <i className="adm-you">вы</i>}
                        </b>
                        <span className="label-mono">@{u.login}</span>
                      </span>
                      {u.role === 'admin' ? <span className="adm-pill role-admin">админ</span> : <PlanBadge plan={u.plan} />}
                      <span className={`adm-acc st-${acc}`} data-testid="admin-user-access">
                        <i className="adm-dot" aria-hidden="true" />
                        {ACCESS_LABEL[acc]}
                      </span>
                      <span className="adm-cell">
                        <span className="adm-cell-k">лицензия</span>
                        <span className="adm-cell-v">{u.role === 'admin' ? 'бессрочно' : fmtDate(u.licenseUntil)}</span>
                      </span>
                      <span className="adm-cell">
                        <span className="adm-cell-k">ИИ сегодня</span>
                        <span className="adm-cell-v">
                          {u.aiCallsToday} / {u.aiDailyLimit || '∞'}
                        </span>
                      </span>
                      <span className="adm-cell">
                        <span className="adm-cell-k">вход</span>
                        <span className="adm-cell-v">{fmtDate(u.lastLoginAt)}</span>
                      </span>
                    </button>
                  )
                })}
                {shown.length === 0 && <p className="jr-empty">Никого не найдено.</p>}
              </div>
            </section>
            <aside className="adm-side">
              {current ? (
                <AdminUserCard
                  key={current.id}
                  user={current}
                  plans={plans}
                  selfId={me?.id ?? ''}
                  onChanged={() => void reload()}
                  onDeleted={() => {
                    setSelected(null)
                    void reload()
                  }}
                />
              ) : (
                <div className="panel adm-hint" data-testid="admin-hint">
                  <span className="adm-avatar lg" aria-hidden="true">
                    ?
                  </span>
                  <b>Карточка пользователя</b>
                  <span>Выберите строку слева: тариф, срок лицензии, функции, лимит ИИ, пароль и сессии — всё здесь.</span>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
