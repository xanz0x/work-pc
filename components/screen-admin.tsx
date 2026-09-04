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
import { AdminCreateUser } from './admin-create-user'
import { PlanBadge } from './plan-badge'
import { IconUser } from './icons'
import { adminFetch, fmtDate, fmtLeft } from './admin-shared'
import { useAccount } from '@/lib/account'
import { accessState, type PlanStats, type UserView } from '@/lib/users'

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
        ['Сессий', overview.sessions, ''],
        ['ИИ сегодня', overview.aiToday, ''],
        ['Свободных ключей', overview.licensesFree, 'ok'],
        ['Тарифов', overview.plans, ''],
      ]
    : []

  const TABS: [Tab, string, number][] = [
    ['users', 'Пользователи', users.length],
    ['plans', 'Тарифы', plans.filter((p) => !p.archived).length],
    ['keys', 'Ключи', overview?.licensesFree ?? 0],
  ]

  return (
    <div className="screen-admin" data-testid="screen-admin">
      <div className="adm-shell">
        <header className="adm-head">
          <div>
            <h1 className="act-title">Администрирование</h1>
            <p className="act-sub">
              Вы настраиваете тарифы и выдаёте ключи. Пользователь регистрируется только по ключу — и сразу получает функции,
              лимит и срок того тарифа, под который ключ выдан.
            </p>
          </div>
          <div className="adm-tabs" role="tablist" data-testid="admin-tabs">
            {TABS.map(([id, label, n]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} data-testid={`admin-tab-${id}`}>
                {label} <span className="adm-count">{n}</span>
              </button>
            ))}
          </div>
        </header>

        {overview && (
          <div className="panel adm-strip" data-testid="admin-overview">
            {stats.map(([k, v, tone]) => (
              <div key={k} className={`adm-stat tone-${tone}`}>
                <b className="num">{v}</b>
                <span className="label-mono">{k}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'plans' && <AdminPlans plans={plans} onChanged={() => void reload()} />}
        {tab === 'keys' && <AdminLicenses plans={plans} onChanged={() => void reload()} />}

        {tab === 'users' && (
          <div className="adm-body">
            <section className="adm-users panel">
              <div className="mask-head">
                <span className="label-mono">Пользователи · {users.length}</span>
                <div className="adm-tools">
                  <input className="mcp-input adm-search" placeholder="Поиск: логин, имя, тариф" value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-search" />
                  <button className={`btn ${createOpen ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCreateOpen((o) => !o)} data-testid="admin-create-open">
                    <IconUser width={12} height={12} aria-hidden="true" /> Создать вручную
                  </button>
                </div>
              </div>
              {createOpen && <AdminCreateUser plans={plans} onDone={() => void reload()} onClose={() => setCreateOpen(false)} />}
              <div className="adm-table" role="table" data-testid="admin-user-list">
                <div className="adm-thead" role="row">
                  <span />
                  <span>пользователь</span>
                  <span>тариф</span>
                  <span>статус</span>
                  <span>лицензия</span>
                  <span>ИИ сегодня</span>
                  <span>последний вход</span>
                </div>
                {shown.map((u) => {
                  const acc = accessState(u)
                  const left = fmtLeft(u.licenseUntil)
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
                      <span>{u.role === 'admin' ? <span className="adm-pill role-admin">админ</span> : <PlanBadge plan={u.plan} />}</span>
                      <span className={`adm-acc st-${acc}`} data-testid="admin-user-access">
                        <i className="adm-dot" aria-hidden="true" />
                        {ACCESS_LABEL[acc]}
                      </span>
                      <span className={`adm-cell-v ${u.role === 'admin' ? 'dim' : left.tone}`}>{u.role === 'admin' ? 'бессрочно' : left.text}</span>
                      <span className="adm-cell-v">
                        {u.aiCallsToday} / {u.aiDailyLimit || '∞'}
                      </span>
                      <span className="adm-cell-v dim">{fmtDate(u.lastLoginAt)}</span>
                    </button>
                  )
                })}
                {shown.length === 0 && <p className="adm-empty">Никого не найдено.</p>}
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
        )}
      </div>
    </div>
  )
}
