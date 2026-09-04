'use client'

/* Карточка пользователя в админке: роль, функции, лимит ИИ, лицензия, пароль, сессии, удаление. */

import { useState } from 'react'
import { IconCopy } from './icons'
import { PlanBadge } from './plan-badge'
import { adminFetch, fmtDate, genPassword } from './admin-shared'
import { FEATURES, LICENSE_TERMS, accessState, type FeatureId, type Features, type PlanStats, type Role, type UserView } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

type Props = { user: UserView; plans: PlanStats[]; selfId: string; onChanged: () => void; onDeleted: () => void }

/** Полоска остатка лицензии: зелёная → жёлтая (≤7 дн.) → красная (истекла). */
function LicenseBar({ until }: { until: number | null }) {
  if (!until) return <span className="label-mono">Лицензии нет — пользователь ждёт ключ или продления.</span>
  const left = until - Date.now()
  const daysLeft = Math.ceil(left / 86_400_000)
  const tone = left <= 0 ? 'danger' : daysLeft <= 7 ? 'warn' : ''
  const pct = left <= 0 ? 0 : Math.min(100, Math.max(4, (daysLeft / 90) * 100))
  return (
    <div className="adm-field" data-testid="admin-card-license-bar">
      <div className={`adm-lic-bar ${tone}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="adm-lic-meta">
        <span>{left <= 0 ? 'истекла' : `осталось ${daysLeft} дн.`}</span>
        <span>до {fmtDate(until)}</span>
      </div>
    </div>
  )
}

export function AdminUserCard({ user: u, plans, selfId, onChanged, onDeleted }: Props) {
  const { flash } = useToast()
  const activePlans = plans.filter((p) => !p.archived || p.id === u.plan?.id)
  const [features, setFeatures] = useState<Features>(u.features)
  const [limit, setLimit] = useState(String(u.aiDailyLimit))
  const [name, setName] = useState(u.name)
  const [days, setDays] = useState(30)
  const [planId, setPlanId] = useState(u.plan?.id ?? activePlans[0]?.id ?? '')
  const [temp, setTemp] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const self = u.id === selfId

  const dirty = JSON.stringify(features) !== JSON.stringify(u.features) || Number(limit) !== u.aiDailyLimit || name !== u.name

  async function patch(body: Record<string, unknown>) {
    setErr(null)
    const r = await adminFetch<UserView>(`/admin/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!r.ok) return setErr(r.error)
    flash('Сохранено')
    onChanged()
  }

  async function action(body: Record<string, unknown>, okMsg: string) {
    setErr(null)
    const r = await adminFetch<unknown>(`/admin/api/users/${u.id}`, { method: 'POST', body: JSON.stringify(body) })
    if (!r.ok) return setErr(r.error)
    flash(okMsg)
    onChanged()
  }

  function twoStep(key: string, run: () => void) {
    if (confirm !== key) {
      setConfirm(key)
      setTimeout(() => setConfirm((c) => (c === key ? null : c)), 5000)
      return
    }
    setConfirm(null)
    run()
  }

  async function remove() {
    const r = await adminFetch<unknown>(`/admin/api/users/${u.id}`, { method: 'DELETE' })
    if (!r.ok) return setErr(r.error)
    flash('Пользователь и его данные на сервере удалены')
    onDeleted()
  }

  const acc = accessState(u)

  return (
    <div className="panel adm-card" data-testid="admin-user-card" data-user-id={u.id}>
      <div className="adm-card-head">
        <span className={`adm-avatar lg role-${u.role}`} aria-hidden="true">
          {(u.name || u.login).slice(0, 1).toUpperCase()}
        </span>
        <div className="adm-who">
          <b>{u.name}</b>
          <span className="label-mono">@{u.login}</span>
        </div>
        <span className={`adm-acc st-${acc}`}>
          <i className="adm-dot" aria-hidden="true" />
          {u.status === 'blocked' ? 'заблокирован' : acc === 'ok' ? 'доступ есть' : acc === 'license' ? 'без лицензии' : 'ждёт смены пароля'}
        </span>
      </div>

      <div className="adm-field">
        <label className="label-mono">Имя</label>
        <input className="mcp-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="admin-card-name" />
      </div>

      <div className="adm-field">
        <label className="label-mono">Роль</label>
        <div className="autolock-seg" role="radiogroup">
          {(['user', 'admin'] as Role[]).map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={u.role === r}
              className={u.role === r ? 'active' : ''}
              disabled={self}
              onClick={() => void patch({ role: r })}
              data-testid={`admin-card-role-${r}`}
            >
              {r === 'admin' ? 'Администратор' : 'Пользователь'}
            </button>
          ))}
        </div>
      </div>

      <div className="adm-field">
        <label className="label-mono">Функции</label>
        <div className="adm-toggles">
          {FEATURES.map((f) => (
            <label key={f.id} className={`mcp-scope${features[f.id] ? ' on' : ''}`} title={f.note} data-testid={`admin-feature-${f.id}`}>
              <input type="checkbox" checked={features[f.id]} onChange={() => setFeatures({ ...features, [f.id]: !features[f.id as FeatureId] })} />
              <span className="mcp-scope-text">
                <b>{f.label}</b>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="adm-field adm-inline">
        <label className="label-mono">Лимит ИИ в сутки (0 — без лимита)</label>
        <input className="mcp-input adm-num" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="admin-card-limit" />
        <span className="label-mono">сегодня {u.aiCallsToday} · всего {u.aiCallsTotal}</span>
      </div>

      <div className="tm-actions">
        <button className="btn btn-primary" disabled={!dirty} onClick={() => void patch({ features, aiDailyLimit: Number(limit), name })} data-testid="admin-card-save">
          Сохранить изменения
        </button>
      </div>

      <div className="adm-field adm-sep">
        <label className="label-mono">Тариф и лицензия</label>
        {u.role === 'admin' ? (
          <span className="label-mono">Администратору тариф и лицензия не нужны — доступ бессрочный.</span>
        ) : (
          <>
            <div className="adm-plan-row">
              <PlanBadge plan={u.plan} lg />
              <select className="mcp-input" value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="admin-card-plan">
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                disabled={!planId || planId === u.plan?.id}
                onClick={() => void action({ action: 'set-plan', planId }, 'Тариф изменён: функции и лимит обновлены')}
                data-testid="admin-card-set-plan"
              >
                Перевести
              </button>
            </div>
            <LicenseBar until={u.licenseUntil} />
            <div className="adm-inline wrap">
              <select className="mcp-input" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="admin-card-days">
                {LICENSE_TERMS.map((t) => (
                  <option key={t.days} value={t.days}>
                    +{t.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost" disabled={!u.plan} title={u.plan ? '' : 'Сначала выберите тариф'} onClick={() => void action({ action: 'grant-license', days }, 'Лицензия продлена')} data-testid="admin-card-grant">
                Продлить
              </button>
              {u.licenseUntil && (
                <button className="btn btn-ghost" onClick={() => void action({ action: 'revoke-license' }, 'Лицензия снята')} data-testid="admin-card-revoke-license">
                  Снять
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="adm-field adm-sep">
        <label className="label-mono">Безопасность · сессий {u.sessions} · последний вход {fmtDate(u.lastLoginAt)}</label>
        <div className="adm-inline wrap">
          <button
            className={`btn ${confirm === 'reset' ? 'btn-danger' : 'btn-ghost'}`}
            onClick={() =>
              twoStep('reset', () => {
                const p = genPassword()
                void action({ action: 'reset-password', password: p }, 'Пароль сброшен').then(() => setTemp(p))
              })
            }
            data-testid="admin-card-reset"
          >
            {confirm === 'reset' ? 'Точно сбросить?' : 'Сбросить пароль'}
          </button>
          <button className="btn btn-ghost" onClick={() => void action({ action: 'terminate-sessions' }, 'Сессии завершены')} data-testid="admin-card-terminate">
            Завершить сессии
          </button>
          {!self && (
            <button
              className={`btn ${confirm === 'block' ? 'btn-danger' : 'btn-ghost'}`}
              onClick={() => twoStep('block', () => void patch({ status: u.status === 'blocked' ? 'active' : 'blocked' }))}
              data-testid="admin-card-block"
            >
              {u.status === 'blocked' ? 'Разблокировать' : confirm === 'block' ? 'Точно заблокировать?' : 'Заблокировать'}
            </button>
          )}
          {!self && !u.legacyStore && (
            <button className={`btn ${confirm === 'delete' ? 'btn-danger' : 'btn-ghost'}`} onClick={() => twoStep('delete', () => void remove())} data-testid="admin-card-delete">
              {confirm === 'delete' ? 'Удалить вместе с данными?' : 'Удалить'}
            </button>
          )}
        </div>
        {temp && (
          <div className="mcp-issued" data-testid="admin-card-temp">
            <span className="label-mono">Временный пароль — покажется один раз</span>
            <code data-testid="admin-card-temp-value">{temp}</code>
            <button className="btn btn-ghost" onClick={() => void navigator.clipboard?.writeText(temp).then(() => flash('Скопировано'))}>
              <IconCopy width={12} height={12} aria-hidden="true" /> Копировать
            </button>
          </div>
        )}
      </div>

      {err && (
        <p className="mk-err" role="alert" data-testid="admin-card-error">
          {err}
        </p>
      )}
    </div>
  )
}
