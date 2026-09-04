'use client'

/* Создание пользователя вручную: логин, имя, временный пароль, роль, тариф и срок. */

import { useState } from 'react'
import { IconCopy } from './icons'
import { adminFetch, genPassword } from './admin-shared'
import { LICENSE_TERMS, type PlanStats, type Role, type UserView } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

type Props = { plans: PlanStats[]; onDone: () => void; onClose: () => void }

export function AdminCreateUser({ plans, onDone, onClose }: Props) {
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
        <div className="adm-field">
          <label className="label-mono">Логин</label>
          <input className="mcp-input" placeholder="ivan.petrov" value={login} onChange={(e) => setLogin(e.target.value.toLowerCase())} maxLength={32} autoCapitalize="none" data-testid="admin-create-login" />
        </div>
        <div className="adm-field">
          <label className="label-mono">Имя</label>
          <input className="mcp-input" placeholder="Иван Петров" value={name} onChange={(e) => setName(e.target.value)} data-testid="admin-create-name" />
        </div>
        <div className="adm-field">
          <label className="label-mono">Временный пароль</label>
          <input className="mcp-input" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="admin-create-password" />
        </div>
        <div className="adm-field">
          <label className="label-mono">Роль</label>
          <select className="mcp-input" value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="admin-create-role">
            <option value="user">Пользователь</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
        <div className="adm-field">
          <label className="label-mono">Тариф</label>
          <select className="mcp-input" value={role === 'user' ? planId : ''} disabled={role !== 'user'} onChange={(e) => setPlanId(e.target.value)} data-testid="admin-create-plan">
            <option value="">{role === 'user' ? 'Без тарифа (ждёт ключ)' : 'Админу не нужен'}</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label className="label-mono">Срок лицензии</label>
          <select className="mcp-input" value={days} disabled={role !== 'user' || !planId} onChange={(e) => setDays(Number(e.target.value))} data-testid="admin-create-days">
            <option value={0}>{plan ? `Как в тарифе (${plan.days} дн.)` : '—'}</option>
            {LICENSE_TERMS.map((t) => (
              <option key={t.days} value={t.days}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="adm-actions">
        <button className="btn btn-primary" data-testid="admin-create-submit">
          Создать пользователя
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
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
