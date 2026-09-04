'use client'

/* Ключи лицензий: выдать (показывается один раз), список масок, отзыв. */

import { useCallback, useEffect, useState } from 'react'
import { IconCopy, IconKey } from './icons'
import { adminFetch, fmtDate } from './admin-shared'
import { LICENSE_TERMS, type LicenseView } from '@/lib/users'
import { useToast } from '@/lib/vault-store'

export function AdminLicenses({ onChanged }: { onChanged: () => void }) {
  const { flash } = useToast()
  const [list, setList] = useState<LicenseView[]>([])
  const [days, setDays] = useState(30)
  const [note, setNote] = useState('')
  const [issued, setIssued] = useState<string | null>(null)
  const [showUsed, setShowUsed] = useState(false)

  const reload = useCallback(async () => {
    const r = await adminFetch<LicenseView[]>('/admin/api/licenses')
    if (r.ok) setList(r.data)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  async function issue() {
    const r = await adminFetch<{ key: string }>('/admin/api/licenses', { method: 'POST', body: JSON.stringify({ days, note }) })
    if (!r.ok) return flash(r.error)
    setIssued(r.data.key)
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

  const shown = list.filter((l) => showUsed || (!l.usedBy && !l.revokedAt))

  return (
    <div className="panel adm-card" data-testid="admin-licenses">
      <div className="mask-head">
        <span className="label-mono">Ключи лицензий</span>
        <label className="label-mono adm-check">
          <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} /> показать использованные
        </label>
      </div>
      <div className="adm-inline">
        <select className="mcp-input" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="admin-license-days">
          {LICENSE_TERMS.map((t) => (
            <option key={t.days} value={t.days}>
              {t.label}
            </option>
          ))}
        </select>
        <input className="mcp-input" placeholder="Заметка (кому)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="admin-license-note" />
        <button className="btn btn-primary" onClick={() => void issue()} data-testid="admin-license-issue">
          <IconKey width={12} height={12} aria-hidden="true" /> Выдать ключ
        </button>
      </div>
      {issued && (
        <div className="mcp-issued" data-testid="admin-license-issued">
          <span className="label-mono">Ключ показывается один раз — передайте пользователю</span>
          <code data-testid="admin-license-key">{issued}</code>
          <div className="tm-actions">
            <button className="btn btn-ghost" onClick={() => void navigator.clipboard?.writeText(issued).then(() => flash('Ключ скопирован'))} data-testid="admin-license-copy">
              <IconCopy width={12} height={12} aria-hidden="true" /> Копировать
            </button>
            <button className="mcp-x" onClick={() => setIssued(null)}>
              скрыть
            </button>
          </div>
        </div>
      )}
      <div className="mcp-token-list" data-testid="admin-license-list">
        {shown.length === 0 && <p className="jr-empty">Свободных ключей нет.</p>}
        {shown.map((l) => (
          <div key={l.id} className={`mcp-token${l.usedBy || l.revokedAt ? ' st-revoked' : ''}`} data-testid="admin-license-row">
            <div className="mcp-token-text">
              <b>
                {l.mask} <span className="mcp-chip">{l.days} дн.</span>
              </b>
              <span className="label-mono">
                {l.note || 'без заметки'} · выдан {fmtDate(l.createdAt)}
                {l.usedBy ? ` · активирован ${fmtDate(l.usedAt)}` : ''}
                {l.revokedAt ? ` · отозван ${fmtDate(l.revokedAt)}` : ''}
              </span>
            </div>
            {!l.usedBy && !l.revokedAt && (
              <button className="btn btn-ghost" onClick={() => void revoke(l.id)} data-testid="admin-license-revoke">
                Отозвать
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
