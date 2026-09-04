'use client'

/* Тарифы: карточки с функциями, сроком, лимитом и статистикой; создание, правка, архив, удаление. */

import '@/app/styles/plans.css'
import { useState } from 'react'
import { AdminPlanEditor } from './admin-plan-editor'
import { adminFetch } from './admin-shared'
import { IconPlus } from './icons'
import { FEATURES, type Plan, type PlanStats } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

type Props = { plans: PlanStats[]; onChanged: () => void }

export function AdminPlans({ plans, onChanged }: Props) {
  const { flash } = useToast()
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  async function toggleArchive(p: PlanStats) {
    const r = await adminFetch<Plan>(`/admin/api/plans/${p.id}`, { method: 'PATCH', body: JSON.stringify({ archived: !p.archived }) })
    flash(r.ok ? (p.archived ? 'Тариф возвращён из архива' : 'Тариф в архиве: новые ключи под него не выдаются') : r.error)
    onChanged()
  }

  async function remove(p: PlanStats) {
    if (confirm !== p.id) {
      setConfirm(p.id)
      setTimeout(() => setConfirm((c) => (c === p.id ? null : c)), 5000)
      return
    }
    setConfirm(null)
    const r = await adminFetch<unknown>(`/admin/api/plans/${p.id}`, { method: 'DELETE' })
    flash(r.ok ? 'Тариф удалён' : r.error)
    onChanged()
  }

  const shown = plans.filter((p) => showArchived || !p.archived)
  const archivedCount = plans.filter((p) => p.archived).length

  return (
    <section className="plans-page" data-testid="admin-plans">
      <div className="plans-head">
        <div className="adm-sec-title">
          <span>
            Тарифы · {plans.length - archivedCount} активных{archivedCount ? ` · ${archivedCount} в архиве` : ''}
          </span>
        </div>
        <div className="adm-tools">
          {archivedCount > 0 && (
            <label className="label-mono adm-check">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-testid="admin-plans-show-archived" /> показать архив
            </label>
          )}
          <button className={`btn ${editing === 'new' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEditing(editing === 'new' ? null : 'new')} data-testid="plan-new">
            <IconPlus width={12} height={12} aria-hidden="true" /> Новый тариф
          </button>
        </div>
      </div>

      {editing && (
        <AdminPlanEditor
          key={editing === 'new' ? 'new' : editing.id}
          plan={editing === 'new' ? null : editing}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="plans-grid">
        {shown.map((p, i) => (
          <article key={p.id} className={`panel plan-card plan-${p.color}${p.archived ? ' archived' : ''}`} style={{ animationDelay: `${i * 40}ms` }} data-testid="plan-card" data-plan={p.name}>
            <div className="plan-head">
              <div className="plan-name">
                <b>{p.name}</b>
                <span>{p.tagline || 'без описания'}</span>
              </div>
              {p.archived && <span className="adm-pill">архив</span>}
            </div>
            <div className="plan-nums">
              <div className="plan-num">
                <b>{p.days}</b>
                <span>дней</span>
              </div>
              <div className="plan-num">
                <b>{p.aiDailyLimit || '∞'}</b>
                <span>ИИ / сутки</span>
              </div>
              <div className="plan-num">
                <b>{p.users}</b>
                <span>польз.</span>
              </div>
            </div>
            <div className="plan-feats">
              {FEATURES.map((f) => (
                <span key={f.id} className={`plan-feat ${p.features[f.id] ? 'on' : 'off'}`} title={f.note}>
                  {f.label}
                </span>
              ))}
            </div>
            <div className="plan-foot">
              <div className="plan-actions">
                <button className="btn btn-ghost" onClick={() => setEditing(p)} data-testid="plan-edit">
                  Настроить
                </button>
                <button className="btn btn-ghost" onClick={() => void toggleArchive(p)} data-testid="plan-archive">
                  {p.archived ? 'Вернуть' : 'В архив'}
                </button>
                {p.users === 0 && p.freeKeys === 0 && (
                  <button className={`btn ${confirm === p.id ? 'btn-danger' : 'btn-ghost'}`} onClick={() => void remove(p)} data-testid="plan-delete">
                    {confirm === p.id ? 'Точно удалить?' : 'Удалить'}
                  </button>
                )}
              </div>
              <span className="label-mono">ключей: {p.freeKeys}</span>
            </div>
          </article>
        ))}
        {shown.length === 0 && <p className="adm-empty">Тарифов нет — создайте первый.</p>}
      </div>
    </section>
  )
}
