'use client'

/* ============================================================
   ЭКРАН «АДМИНИСТРИРОВАНИЕ»
   Пользователи, лицензии, сводка. Только роль admin: сервер отвечает
   ADMIN_ONLY всем остальным, интерфейс сюда их не ведёт.
   ============================================================ */

import '@/app/styles/screen-admin.css'
import { useCallback, useEffect, useState } from 'react'
import { AdminUserCard } from './admin-user-card'
import { AdminLicenses } from './admin-licenses'
import { IconCopy, IconUser } from './icons'
import { adminFetch, fmtDate, genPassword } from './admin-shared'
import { useAccount } from '@/lib/account'
import { DEFAULT_AI_DAILY_LIMIT, LICENSE_TERMS, accessState, type Role, type UserView } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

type Overview = {
  users: number
  admins: number
  blocked: number
  licensed: number
  awaitingLicense: number
  sessions: number
  aiToday: number
  aiTotal: number
  licensesFree: number
}

const ACCESS_LABEL = { ok: 'работает', blocked: 'заблокирован', license: 'ждёт лицензию', password: 'сменит пароль' } as const

function CreateUser({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { flash } = useToast()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState(genPassword)
  const [role, setRole] = useState<Role>('user')
  const [days, setDays] = useState(30)
  const [err, setErr] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const r = await adminFetch<UserView>('/admin/api/users', {
      method: 'POST',
      body: JSON.stringify({ email, name, password, role, licenseDays: role === 'user' ? days : 0, aiDailyLimit: DEFAULT_AI_DAILY_LIMIT }),
    })
    if (!r.ok) return setErr(r.error)
    setIssued({ email: r.data.email, password })
    setEmail('')
    setName('')
    setPassword(genPassword())
    onDone()
  }

  return (
    <form className="adm-create panel" onSubmit={submit} data-testid="admin-create-form">
      <div className="mask-head">
        <span className="label-mono">Новый пользователь · временный пароль сменится при первом входе</span>
        <button type="button" className="mcp-x" onClick={onClose} data-testid="admin-create-close">
          закрыть
        </button>
      </div>
      <div className="adm-grid">
        <input className="mcp-input" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="admin-create-email" />
        <input className="mcp-input" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} data-testid="admin-create-name" />
        <input className="mcp-input" placeholder="Временный пароль" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="admin-create-password" />
        <select className="mcp-input" value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="admin-create-role">
          <option value="user">Пользователь</option>
          <option value="admin">Администратор</option>
        </select>
        {role === 'user' && (
          <select className="mcp-input" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="admin-create-days">
            <option value={0}>Без лицензии (ждёт ключ)</option>
            {LICENSE_TERMS.map((t) => (
              <option key={t.days} value={t.days}>
                Лицензия на {t.label}
              </option>
            ))}
          </select>
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
            {issued.email} · {issued.password}
          </code>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard?.writeText(`${issued.email}\n${issued.password}`).then(() => flash('Скопировано'))}
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
  const [users, setUsers] = useState<UserView[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const reload = useCallback(async () => {
    const [u, o] = await Promise.all([adminFetch<UserView[]>('/admin/api/users'), adminFetch<Overview>('/admin/api/overview')])
    if (u.ok) setUsers(u.data)
    if (o.ok) setOverview(o.data)
  }, [])

  useEffect(() => {
    if (isAdmin) void reload()
  }, [isAdmin, reload])

  if (!isAdmin) return <div className="screen-admin" data-testid="admin-forbidden">Только для администратора.</div>

  const shown = users.filter((u) => !q || `${u.email} ${u.name}`.toLowerCase().includes(q.toLowerCase()))
  const current = users.find((u) => u.id === selected) ?? null

  return (
    <div className="screen-admin" data-testid="screen-admin">
      <header className="act-head">
        <div>
          <h1 className="act-title">Администрирование</h1>
          <p className="act-sub">
            Учётные записи, лицензии и функции. Пользователь регистрируется сам, а работать начинает
            после ключа лицензии на срок, который вы задаёте.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen((o) => !o)} data-testid="admin-create-open">
          <IconUser width={12} height={12} aria-hidden="true" /> Создать пользователя
        </button>
      </header>

      {createOpen && <CreateUser onDone={() => void reload()} onClose={() => setCreateOpen(false)} />}

      {overview && (
        <div className="adm-stats" data-testid="admin-overview">
          {[
            ['Пользователей', overview.users],
            ['Админов', overview.admins],
            ['С лицензией', overview.licensed],
            ['Ждут ключ', overview.awaitingLicense],
            ['Заблокировано', overview.blocked],
            ['Живых сессий', overview.sessions],
            ['ИИ сегодня', overview.aiToday],
            ['ИИ всего', overview.aiTotal],
            ['Свободных ключей', overview.licensesFree],
          ].map(([k, v], i) => (
            <div key={k} className={`adm-stat panel tone-${['', '', 'ok', 'warn', 'danger', '', '', '', 'ok'][i]}`}>
              <b className="num">{v}</b>
              <span className="label-mono">{k}</span>
            </div>
          ))}
        </div>
      )}

      <div className="adm-body">
        <section className="adm-users panel">
          <div className="mask-head">
            <span className="label-mono">Пользователи · {users.length}</span>
            <input className="mcp-input adm-search" placeholder="Поиск по email и имени" value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-search" />
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
                  data-email={u.email}
                >
                  <span className={`adm-avatar role-${u.role}`} aria-hidden="true">
                    {(u.name || u.email).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="adm-who">
                    <b>
                      {u.name}
                      {u.id === me?.id && <i className="adm-you">вы</i>}
                    </b>
                    <span className="label-mono">{u.email}</span>
                  </span>
                  <span className={`adm-pill role-${u.role}`}>{u.role === 'admin' ? 'админ' : 'пользователь'}</span>
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
            <AdminUserCard key={current.id} user={current} selfId={me?.id ?? ''} onChanged={() => void reload()} onDeleted={() => { setSelected(null); void reload() }} />
          ) : (
            <div className="panel adm-hint" data-testid="admin-hint">
              <span className="adm-avatar lg" aria-hidden="true">
                ?
              </span>
              <b>Карточка пользователя</b>
              <span>Выберите строку слева: роль, функции, лимит ИИ, лицензия, пароль и сессии — всё здесь.</span>
            </div>
          )}
          <AdminLicenses onChanged={() => void reload()} />
        </aside>
      </div>
    </div>
  )
}
