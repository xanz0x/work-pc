'use client'

/* ============================================================
   NF-10 · РАЗДЕЛ НАСТРОЕК «MCP НАРУЖУ»
   Адрес сервера, ожидающие подтверждения опасных операций и токены с
   областями видимости. Секрет токена показывается один раз: на сервере
   остаётся только хеш, здесь — только имя, области и срок.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { IconAlertTri, IconCheck, IconClose, IconCopy, IconTerminal } from './icons'
import { McpTokens, useCopy } from './mcp-tokens'
import { refreshPending, useMcpBridgeState, useMcpExecutor, type BridgeJob } from '@/lib/mcp-bridge'
import type { PendingView } from '@/lib/permissions'
import { useSecrets } from '@/lib/secrets-store'
import { useToast } from '@/lib/vault-store'

const fmtAt = (at: number) =>
  new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function PendingRow({ p, onDone }: { p: PendingView; onDone: () => void }) {
  const execute = useMcpExecutor()
  const secrets = useSecrets()
  const { flash } = useToast()
  const [busy, setBusy] = useState(false)

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    try {
      let result: { ok: boolean; payload: unknown } | undefined
      if (decision === 'approve') {
        const r = await fetch(`/mcp/admin/pending?id=${encodeURIComponent(p.id)}`)
        if (!r.ok) {
          flash('Запрос уже решён или истёк')
          onDone()
          return
        }
        const job = (await r.json()) as BridgeJob
        result = await execute(job)
      }
      await fetch('/mcp/admin/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, decision, ok: result?.ok, payload: result?.payload }),
      })
      flash(
        decision === 'reject'
          ? 'Запрос агента отклонён'
          : result?.ok
            ? 'Одобрено: запись создана в сейфе'
            : `Одобрено, но не выполнено: ${String(result?.payload)}`,
      )
    } finally {
      setBusy(false)
      onDone()
    }
  }

  return (
    <div className="mcp-pending-row" data-testid="mcp-pending-row" data-approval-id={p.id}>
      <span className="mcp-pending-ico" aria-hidden="true">
        <IconAlertTri width={14} height={14} />
      </span>
      <div className="mcp-pending-text">
        <b>
          {p.tool} · токен «{p.tokenName}»
        </b>
        <span data-testid="mcp-pending-summary">{p.summary}</span>
        <span className="label-mono">запрошено в {fmtAt(p.createdAt)} · ждёт 10 мин</span>
        {!secrets.ready && (
          <span className="mcp-pending-hint" data-testid="mcp-pending-locked">
            Сейф закрыт: разблокируйте замок, чтобы одобрить
          </span>
        )}
      </div>
      <div className="mcp-pending-actions">
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void decide('reject')}
          data-testid="mcp-pending-reject"
        >
          <IconClose width={12} height={12} aria-hidden="true" /> Отклонить
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || !secrets.ready}
          onClick={() => void decide('approve')}
          data-testid="mcp-pending-approve"
        >
          <IconCheck width={12} height={12} aria-hidden="true" /> Одобрить и выполнить
        </button>
      </div>
    </div>
  )
}

export function McpSection() {
  const bridge = useMcpBridgeState()
  const copy = useCopy()
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin}/mcp`

  const snippet = JSON.stringify(
    {
      mcpServers: {
        workspacex: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization: Bearer ${WSX_TOKEN}'],
          env: { WSX_TOKEN: 'wsx_…' },
        },
      },
    },
    null,
    2,
  )

  return (
    <section className="sec panel" id="set-mcp" data-testid="settings-mcp">
      <div className="sec-head">
        <span className={`sec-icon${bridge.connected ? ' active' : ''}`}>
          <IconTerminal />
        </span>
        <div className="sec-head-text">
          <div className="setting-title">MCP наружу</div>
          <div className="setting-note">
            Внешние агенты (Claude, Cursor и другие) работают с сейфом по своему токену: только
            разрешённые операции, каждый вызов — в журнале безопасности
          </div>
        </div>
        <span
          className={`sec-meta label-mono${bridge.connected ? ' ok-text' : ''}`}
          data-testid="mcp-bridge-status"
        >
          {bridge.connected ? 'вкладка подключена' : 'мост не подключён'}
        </span>
      </div>

      <div className="mcp-url-row">
        <div className="mcp-url">
          <span className="label-mono">Адрес сервера · Streamable HTTP</span>
          <code data-testid="mcp-server-url">{url}</code>
        </div>
        <button className="btn btn-ghost" onClick={() => copy(url, 'Адрес')} data-testid="mcp-copy-url">
          <IconCopy width={12} height={12} aria-hidden="true" /> Копировать
        </button>
      </div>

      <p className="mcp-note">
        Данные сейфа живут в этом браузере, поэтому агент получает ответы только пока открыта
        вкладка WorkSpaceX. Значения секретов, тексты файлов и тела стикеров наружу не отдаются
        ни одним инструментом.
      </p>

      {bridge.pending.length > 0 && (
        <div className="mcp-pending" data-testid="mcp-pending-list">
          <div className="mask-head">
            <span className="label-mono">Ждут подтверждения · {bridge.pending.length}</span>
            <span className="mask-flag">опасные операции</span>
          </div>
          {bridge.pending.map((p) => (
            <PendingRow key={p.id} p={p} onDone={() => void refreshPending()} />
          ))}
        </div>
      )}

      <McpTokens />

      <details className="mcp-snippet">
        <summary data-testid="mcp-snippet-toggle">Подключить Claude Desktop / Cursor</summary>
        <pre className="tm-payload" data-testid="mcp-snippet">
          {snippet}
        </pre>
        <div className="tm-actions">
          <button className="btn btn-ghost" onClick={() => copy(snippet, 'Конфиг')} data-testid="mcp-copy-snippet">
            <IconCopy width={12} height={12} aria-hidden="true" /> Копировать конфиг
          </button>
          <span className="setting-note">
            Подставьте выданный токен в WSX_TOKEN. Файл: claude_desktop_config.json или .cursor/mcp.json
          </span>
        </div>
      </details>
    </section>
  )
}
