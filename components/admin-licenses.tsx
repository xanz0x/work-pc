'use client'

/* Ключи лицензий: выдача под тариф (показываются один раз), таблица с фильтром, отзыв. */

import '@/app/styles/plans.css'
import { useCallback, useEffect, useState } from 'react'
import { IconCopy, IconKey } from './icons'
import { PlanBadge } from './plan-badge'
import { adminFetch, fmtDate } from './admin-shared'
import { LICENSE_TERMS, type LicenseView, type PlanStats } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

type Filter = 'free' | 'used' | 'revoked' | 'all'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'free', label: 'Свободные' },
  { id: 'used', label: 'Активированные' },
  { id: 'revoked', label: 'Отозванные' },
  { id: 'all', label: 'Все' },
]

export function AdminLicenses({ plans, onChanged }: { plans: PlanStats[]; onChanged: () => void }) {
  const { flash } = useToast()
  const active = plans.filter((p) => !p.archived)
  const [list, setList] = useState<LicenseView[]>([])
  const [planId, setPlanId] = useState('')
  const [days, setDays] = useState<number | 'plan'>('plan')
  const [count, setCount] = useState(1)
  const [note, setNote] = useState('')
  const [issued, setIssued] = useState<{ keys: string[]; plan: string; days: number } | null>(null)
  const [filter, setFilter] = useState<Filter>('free')
  const [busy, setBusy] = useState(false)

  const plan = active.find((p) => p.id === planId) ?? active[0] ?? null
  const effDays = days === 'plan' ? plan?.days ?? 30 : days

  const reload = useCallback(async () => {
    const r = await adminFetch<LicenseView[]>('/admin/api/licenses')
    if (r.ok) setList(r.data)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  async function issue() {
    if (!plan) return flash('Сначала создайте тариф')
    setBusy(true)
    const r = await adminFetch<{ keys: string[] }>('/admin/api/licenses', { method: 'POST', body: JSON.stringify({ planId: plan.id, days: effDays, note, count }) })
    setBusy(false)
    if (!r.ok) return flash(r.error)
    setIssued({ keys: r.data.keys, plan: plan.name, days: effDays })
    setNote('')
    await reload()
    onChanged()
  }

  async function revoke(id: string) {
    const r = await adminFetch<unknown>(`/admin/api/licenses?id=${id}`, { method: 'DELETE' })
    flash(r.ok ? 'Ключ отозван' : r.error)
    await reload()
    onChanged()
  }

  const state = (l: LicenseView): Exclude<Filter, 'all'> => (l.revokedAt ? 'revoked' : l.usedBy ? 'used' : 'free')
  const shown = list.filter((l) => filter === 'all' || state(l) === filter)
  const counts = { free: 0, used: 0, revoked: 0, all: list.length } as Record<Filter, number>
  for (const l of list) counts[state(l)] += 1

  return (
    <div className="keys-page" data-testid="admin-licenses">
      <section className={`panel keys-issue-panel${plan ? ` plan-${plan.color}` : ''}`}>
        <div className="adm-sec-title">
          <span>Выдать ключи</span>
          <small>ключ = тариф + срок · активируется при регистрации или продлении · показывается один раз</small>
        </div>
        <div className="keys-issue">
          <div className="adm-field">
            <label className="label-mono">Тариф</label>
            <select className="mcp-input" value={plan?.id ?? ''} onChange={(e) => setPlanId(e.target.value)} data-testid="admin-license-plan">
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.days} дн.
                </option>
              ))}
              {active.length === 0 && <option value="">нет активных тарифов</option>}
            </select>
          </div>
          <div className="adm-field">
            <label className="label-mono">Срок</label>
            <select className="mcp-input" value={days} onChange={(e) => setDays(e.target.value === 'plan' ? 'plan' : Number(e.target.value))} data-testid="admin-license-days">
              <option value="plan">Как в тарифе ({plan?.days ?? '—'} дн.)</option>
              {LICENSE_TERMS.map((t) => (
                <option key={t.days} value={t.days}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field">
            <label className="label-mono">Заметка · кому</label>
            <input className="mcp-input" placeholder="Например: Иван, отдел продаж" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} data-testid="admin-license-note" />
          </div>
          <div className="adm-field">
            <label className="label-mono">Штук</label>
            <input className="mcp-input" type="number" min={1} max={25} value={count} onChange={(e) => setCount(Math.max(1, Math.min(25, Number(e.target.value) || 1)))} data-testid="admin-license-count" />
          </div>
          <button className="btn btn-primary" disabled={busy || !plan} onClick={() => void issue()} data-testid="admin-license-issue">
            <IconKey width={12} height={12} aria-hidden="true" /> Выдать
          </button>
        </div>
        {plan && (
          <div className="keys-preview">
            <PlanBadge plan={plan} />
            <span>
              {effDays} дн. · ИИ {plan.aiDailyLimit || '∞'} / сутки · {Object.values(plan.features).filter(Boolean).length} из {Object.keys(plan.features).length} функций
            </span>
          </div>
        )}
        {issued && (
          <div className="keys-issued" data-testid="admin-license-issued">
            <div className="mask-head">
              <span className="label-mono">
                {issued.keys.length === 1 ? 'Ключ' : `${issued.keys.length} ключей`} · {issued.plan} · {issued.days} дн. · показываются один раз — передайте пользователю
              </span>
              <button className="mcp-x" onClick={() => setIssued(null)} data-testid="admin-license-hide">
                скрыть
              </button>
            </div>
            <div className="keys-issued-list">
              {issued.keys.map((k) => (
                <code key={k} data-testid="admin-license-key">
                  {k}
                </code>
              ))}
            </div>
            <div className="adm-actions">
              <button className="btn btn-ghost" onClick={() => void navigator.clipboard?.writeText(issued.keys.join('\n')).then(() => flash(issued.keys.length === 1 ? 'Ключ скопирован' : 'Ключи скопированы'))} data-testid="admin-license-copy">
                <IconCopy width={12} height={12} aria-hidden="true" /> Копировать {issued.keys.length > 1 ? 'все' : ''}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel adm-users">
        <div className="mask-head">
          <span className="label-mono">Ключи · {list.length}</span>
          <div className="adm-tabs" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)} data-testid={`admin-license-filter-${f.id}`}>
                {f.label} <span className="adm-count">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="adm-table keys-table" role="table" data-testid="admin-license-list">
          {shown.length > 0 && (
            <div className="adm-thead key-row" role="row">
              <span>ключ</span>
              <span>тариф</span>
              <span>срок</span>
              <span>заметка · история</span>
              <span>статус</span>
              <span />
            </div>
          )}
          {shown.length === 0 && <p className="adm-empty">{filter === 'free' ? 'Свободных ключей нет — выдайте первый.' : 'Пусто.'}</p>}
          {shown.map((l) => {
            const st = state(l)
            return (
              <div key={l.id} className={`key-row ${st}`} role="row" data-testid="admin-license-row" data-state={st}>
                <code>{l.mask}</code>
                <span>
                  <PlanBadge plan={{ id: l.planId, name: l.planName, color: l.planColor }} />
                </span>
                <span className="adm-cell-v">{l.days} дн.</span>
                <span className="adm-cell-v key-note">
                  {l.note || <i className="dim">без заметки</i>} · выдан {fmtDate(l.createdAt)}
                  {l.usedBy ? ` · активировал @${l.usedByLogin ?? '—'} ${fmtDate(l.usedAt)}` : ''}
                  {l.revokedAt ? ` · отозван ${fmtDate(l.revokedAt)}` : ''}
                </span>
                <span className={`key-state ${st}`}>{st === 'free' ? 'свободен' : st === 'used' ? 'активирован' : 'отозван'}</span>
                <span className="key-act">
                  {st === 'free' && (
                    <button className="btn btn-ghost" onClick={() => void revoke(l.id)} data-testid="admin-license-revoke">
                      Отозвать
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
