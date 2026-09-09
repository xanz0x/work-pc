'use client'

/* Редактор тарифа: название, описание, цвет, срок ключа, лимит ИИ, функции. */

import { useState } from 'react'
import { PlanBadge } from './plan-badge'
import { adminFetch } from './admin-shared'
import { DEFAULT_FEATURES, FEATURES, PLAN_COLORS, planProblem, type Plan, type PlanColor, type PlanInput } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

type Props = { plan: Plan | null; onSaved: () => void; onClose: () => void }

const EMPTY: PlanInput = { name: '', tagline: '', color: 'blue', days: 30, features: { ...DEFAULT_FEATURES }, aiDailyLimit: 100 }

export function AdminPlanEditor({ plan, onSaved, onClose }: Props) {
  const { flash } = useToast()
  const [f, setF] = useState<PlanInput>(plan ? { name: plan.name, tagline: plan.tagline, color: plan.color, days: plan.days, features: { ...plan.features }, aiDailyLimit: plan.aiDailyLimit } : EMPTY)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const problem = planProblem(f)
    if (problem) return setErr(problem)
    setBusy(true)
    setErr(null)
    const r = plan
      ? await adminFetch<Plan>(`/admin/api/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify(f) })
      : await adminFetch<Plan>('/admin/api/plans', { method: 'POST', body: JSON.stringify(f) })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    flash(plan ? 'Тариф обновлён' : 'Тариф создан')
    onSaved()
  }

  const preview = { id: plan?.id ?? 'new', name: f.name.trim() || 'Название', color: f.color }

  return (
    <form className={`panel plan-editor plan-${f.color}`} onSubmit={save} data-testid="plan-editor">
      <div className="mask-head">
        <span className="label-mono">{plan ? `Тариф · ${plan.name}` : 'Новый тариф'}</span>
        <button type="button" className="mcp-x" onClick={onClose} data-testid="plan-editor-close">
          закрыть
        </button>
      </div>

      <div className="plan-editor-grid">
        <div className="adm-field">
          <label className="label-mono">Название</label>
          <input className="mcp-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={32} placeholder="Pro" autoFocus data-testid="plan-editor-name" />
        </div>
        <div className="adm-field">
          <label className="label-mono">Описание · видят пользователи при вводе ключа</label>
          <input className="mcp-input" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} maxLength={120} placeholder="Синхронизация между устройствами и внешние агенты" data-testid="plan-editor-tagline" />
        </div>
      </div>

      <div className="plan-editor-row">
        <div className="adm-field">
          <label className="label-mono">Срок ключа по умолчанию, дней</label>
          <input className="mcp-input" type="number" min={1} max={3650} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} data-testid="plan-editor-days" />
        </div>
        <div className="adm-field">
          <label className="label-mono">Лимит ИИ в сутки · 0 = без лимита</label>
          <input className="mcp-input" type="number" min={0} max={100000} value={f.aiDailyLimit} onChange={(e) => setF({ ...f, aiDailyLimit: Number(e.target.value) })} data-testid="plan-editor-limit" />
        </div>
      </div>

      <div className="adm-field">
        <label className="label-mono">Цвет</label>
        <div className="plan-swatches" role="radiogroup">
          {PLAN_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={f.color === c.id}
              title={c.label}
              className={`plan-swatch plan-${c.id}${f.color === c.id ? ' active' : ''}`}
              onClick={() => setF({ ...f, color: c.id as PlanColor })}
              data-testid={`plan-editor-color-${c.id}`}
            />
          ))}
          <span className="plan-preview">
            <PlanBadge plan={preview} lg />
          </span>
        </div>
      </div>

      <div className="adm-field">
        <label className="label-mono">Функции, которые получает пользователь на этом тарифе</label>
        <div className="adm-toggles">
          {FEATURES.map((ft) => (
            <label key={ft.id} className={`mcp-scope${f.features[ft.id] ? ' on' : ''}`} title={ft.note} data-testid={`plan-editor-feature-${ft.id}`}>
              <input type="checkbox" checked={f.features[ft.id]} onChange={() => setF({ ...f, features: { ...f.features, [ft.id]: !f.features[ft.id] } })} />
              <span className="mcp-scope-text">
                <b>{ft.label}</b>
              </span>
            </label>
          ))}
        </div>
      </div>

      {err && (
        <p className="mk-err" role="alert" data-testid="plan-editor-error">
          {err}
        </p>
      )}
      <div className="tm-actions">
        <button className="btn btn-primary" disabled={busy} data-testid="plan-editor-save">
          {plan ? 'Сохранить тариф' : 'Создать тариф'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  )
}
