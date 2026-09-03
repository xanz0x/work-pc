'use client'

/* NF-10 · токены MCP: выдача с областями и сроком, список, отзыв. */

import { useCallback, useEffect, useState } from 'react'
import { IconCopy, IconKey } from './icons'
import {
  SCOPES,
  TOKEN_TTL_OPTIONS,
  tokenStatus,
  type Scope,
  type TokenView,
} from '@/lib/permissions'
import { useToast } from '@/lib/vault-store'

export function useCopy(): (text: string, label: string) => void {
  const { flash } = useToast()
  return useCallback(
    (text: string, label: string) => {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => flash(`${label} скопирован`))
        .catch(() => flash('Буфер недоступен — скопируйте вручную'))
    },
    [flash],
  )
}

const fmtDate = (at: number) =>
  new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const STATUS_LABEL = { active: 'активен', expired: 'истёк', revoked: 'отозван' } as const

export function McpTokens() {
  const { flash } = useToast()
  const copy = useCopy()
  const [tokens, setTokens] = useState<TokenView[] | null>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Scope[]>(['search', 'read'])
  const [ttl, setTtl] = useState(24)
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await fetch('/mcp/admin/tokens').catch(() => null)
    if (r?.ok) setTokens((await r.json()) as TokenView[])
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  function toggleScope(id: Scope) {
    setScopes((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]))
  }

  async function issue() {
    setBusy(true)
    try {
      const r = await fetch('/mcp/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scopes, ttlHours: ttl }),
      })
      if (!r.ok) {
        flash('Токен не выдан: проверьте области и срок')
        return
      }
      const data = (await r.json()) as { token: string; view: TokenView }
      setIssued({ token: data.token, name: data.view.name })
      setName('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (confirmRevoke !== id) {
      setConfirmRevoke(id)
      setTimeout(() => setConfirmRevoke((c) => (c === id ? null : c)), 5000)
      return
    }
    setConfirmRevoke(null)
    const r = await fetch(`/mcp/admin/tokens?id=${id}`, { method: 'DELETE' })
    flash(r.ok ? 'Токен отозван: агент больше не пройдёт' : 'Токен не найден')
    await reload()
  }

  return (
    <div className="mcp-tokens">
      <div className="mask-head">
        <span className="label-mono">Выдать токен</span>
        <span className="mask-flag">области + срок</span>
      </div>

      <div className="mcp-issue" data-testid="mcp-issue-form">
        <input
          className="mcp-input"
          placeholder="Имя токена, например «Claude на ноутбуке»"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          data-testid="mcp-token-name"
        />
        <div className="mcp-scopes" role="group" aria-label="Области видимости">
          {SCOPES.map((s) => (
            <label
              key={s.id}
              className={`mcp-scope${scopes.includes(s.id) ? ' on' : ''}${s.dangerous ? ' danger' : ''}`}
              data-testid={`mcp-scope-${s.id.replace(':', '-')}`}
            >
              <input
                type="checkbox"
                checked={scopes.includes(s.id)}
                onChange={() => toggleScope(s.id)}
              />
              <span className="mcp-scope-text">
                <b>{s.label}</b>
                <span>{s.note}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mcp-issue-foot">
          <div className="autolock-seg" role="radiogroup" aria-label="Срок действия">
            {TOKEN_TTL_OPTIONS.map((o) => (
              <button
                key={o.hours}
                role="radio"
                aria-checked={ttl === o.hours}
                className={ttl === o.hours ? 'active' : ''}
                onClick={() => setTtl(o.hours)}
                data-testid={`mcp-ttl-${o.hours}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary"
            disabled={busy || scopes.length === 0}
            onClick={() => void issue()}
            data-testid="mcp-token-issue"
          >
            <IconKey width={12} height={12} aria-hidden="true" /> Выдать токен
          </button>
        </div>
      </div>

      {issued && (
        <div className="mcp-issued" role="status" data-testid="mcp-issued">
          <div className="mask-head">
            <span className="label-mono">Токен «{issued.name}» — показывается один раз</span>
            <button className="mcp-x" onClick={() => setIssued(null)} aria-label="Скрыть" data-testid="mcp-issued-hide">
              скрыть
            </button>
          </div>
          <code data-testid="mcp-issued-token">{issued.token}</code>
          <div className="tm-actions">
            <button className="btn btn-ghost" onClick={() => copy(issued.token, 'Токен')} data-testid="mcp-issued-copy">
              <IconCopy width={12} height={12} aria-hidden="true" /> Копировать токен
            </button>
            <span className="setting-note">На сервере остаётся только хеш: восстановить значение нельзя</span>
          </div>
        </div>
      )}

      <div className="mask-head">
        <span className="label-mono">Выданные токены</span>
        <span className="mask-flag" data-testid="mcp-token-count">
          {tokens === null ? '…' : `${tokens.length}`}
        </span>
      </div>
      <div className="mcp-token-list" data-testid="mcp-token-list">
        {tokens?.length === 0 && <p className="jr-empty">Токенов пока нет — агенту нечем пройти.</p>}
        {tokens?.map((t) => {
          const st = tokenStatus(t)
          return (
            <div key={t.id} className={`mcp-token st-${st}`} data-testid="mcp-token-row" data-token-id={t.id}>
              <div className="mcp-token-text">
                <b>
                  {t.name} <span className="label-mono">· {t.id}</span>
                </b>
                <span className="mcp-token-scopes">
                  {t.scopes.map((s) => (
                    <i key={s} className={`mcp-chip${s === 'secrets:write' ? ' danger' : ''}`}>
                      {s}
                    </i>
                  ))}
                </span>
                <span className="label-mono">
                  до {fmtDate(t.expiresAt)} · вызовов {t.calls}
                  {t.lastUsedAt ? ` · последний ${fmtDate(t.lastUsedAt)}` : ' · не использовался'}
                </span>
              </div>
              <span className={`mcp-status label-mono st-${st}`} data-testid="mcp-token-status">
                {STATUS_LABEL[st]}
              </span>
              {st === 'active' && (
                <button
                  className={`btn ${confirmRevoke === t.id ? 'btn-danger' : 'btn-ghost'}`}
                  onClick={() => void revoke(t.id)}
                  data-testid="mcp-token-revoke"
                >
                  {confirmRevoke === t.id ? 'Точно отозвать?' : 'Отозвать'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
