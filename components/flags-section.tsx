'use client'

/* ============================================================
   NF-8 · РАЗДЕЛ НАСТРОЕК «ФЛАГИ И АВТОНОМНЫЙ РЕЖИМ»
   Флаги живут в localStorage (`wf.flags.v1`) и переживают перезагрузку.
   Автономный режим — не обещание, а обёртка: lib/net.ts запрещает
   fetch, XHR, WebSocket, EventSource и sendBeacon за пределы устройства
   и ведёт список запретов. Список показываем как есть: если запретов не
   было, здесь ноль, а не «всё под контролем».
   ============================================================ */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconShield, IconTerminal, IconWifi } from './icons'
import { FLAG_META, setFlag, setOffline, useFlags } from '@/lib/flags'
import { blockedAttempts, clearBlocked, subscribeNet, type BlockedAttempt } from '@/lib/net'

type McpRow = { id: string; name: string; transport: string; enabled: boolean; tools: string[] }
type McpState = McpRow[] | 'no-session' | 'error' | null

const EMPTY: BlockedAttempt[] = []

function useBlocked(): BlockedAttempt[] {
  return useSyncExternalStore(subscribeNet, blockedAttempts, () => EMPTY)
}

export function FlagsSection() {
  const flags = useFlags()
  const blocked = useBlocked()
  const [mcp, setMcp] = useState<McpState>(null)

  /* Каркас MCP: читаем локальную папку ai/ через свой маршрут. */
  useEffect(() => {
    if (!flags.flags['mcp.skeleton']) return
    let alive = true
    void fetch('/ai-api/mcp')
      .then(async (r): Promise<McpRow[] | 'no-session' | 'error'> => {
        if (r.status === 401) return 'no-session'
        if (!r.ok) return 'error'
        const rows = (await r.json()) as unknown
        return Array.isArray(rows) ? (rows as McpRow[]) : []
      })
      .then((rows) => {
        if (alive) setMcp(rows)
      })
      .catch(() => {
        if (alive) setMcp('error')
      })
    return () => {
      alive = false
    }
  }, [flags.flags])

  return (
    <section className="sec panel" id="set-flags" data-testid="settings-flags">
      <div className="sec-head">
        <span className="sec-icon">
          <IconWifi />
        </span>
        <div className="sec-head-text">
          <div className="setting-title">Автономный режим и флаги</div>
          <div className="setting-note">
            Запрет исходящих запросов на уровне обёртки и переключатели незрелых функций
          </div>
        </div>
        <span className="sec-meta label-mono" data-testid="flags-meta">
          {flags.offline ? 'автономно' : 'сеть разрешена'}
        </span>
      </div>

      <div className="rows-list">
        <div className="setting-row" data-testid="offline-row">
          <div className="setting-row-text">
            <div className="setting-title">Автономный режим</div>
            <div className="setting-note">
              Обёртка над fetch, XHR, WebSocket, EventSource и sendBeacon отклоняет любой запрос за
              пределы устройства: чужой origin, маршрут иконок сайтов и ход во внешнюю модель.
              Локальные экраны, локальный движок и журнал работают как обычно.
            </div>
          </div>
          <button
            className={`toggle${flags.offline ? ' on' : ''}`}
            role="switch"
            aria-checked={flags.offline}
            aria-label="Автономный режим"
            onClick={() => setOffline(!flags.offline)}
            data-testid="toggle-offline"
          />
        </div>

        {FLAG_META.map((f) => (
          <div className="setting-row" key={f.id}>
            <div className="setting-row-text">
              <div className="setting-title">{f.label}</div>
              <div className="setting-note">{f.note}</div>
            </div>
            <button
              className={`toggle${flags.flags[f.id] ? ' on' : ''}`}
              role="switch"
              aria-checked={flags.flags[f.id]}
              aria-label={f.label}
              onClick={() => setFlag(f.id, !flags.flags[f.id])}
              data-testid={`toggle-flag-${f.id}`}
            />
          </div>
        ))}
      </div>

      <div className="field-block">
        <div className="mask-head">
          <span className="label-mono">Запрещённые исходящие</span>
          <span className="mask-flag">
            <IconShield width={11} height={11} aria-hidden="true" focusable="false" />
            <span className="mask-flag-text num" data-testid="flags-blocked-count">
              {blocked.length} за сессию
            </span>
          </span>
        </div>
        {blocked.length === 0 ? (
          <div className="stat-line">
            Запретов не было: либо автономный режим выключен, либо наружу никто не пытался.
          </div>
        ) : (
          <>
            <div className="net-log" data-testid="flags-blocked-log">
              {blocked.map((b) => (
                <div className="net-log-row" key={`${b.at}-${b.target}`}>
                  <span className="mono">{new Date(b.at).toLocaleTimeString('ru-RU')}</span>
                  <span className="mono ellipsis">{b.target}</span>
                  <span className="label-mono net-via">{b.via}</span>
                  <span className={`badge ${b.kind === 'external' ? 'badge-warn' : 'badge-info'}`}>
                    {b.kind === 'external' ? 'чужой origin' : 'ход наружу'}
                  </span>
                </div>
              ))}
            </div>
            <div className="bk-actions">
              <button className="btn btn-ghost btn-sm" onClick={clearBlocked} data-testid="flags-clear-log">
                Очистить список
              </button>
            </div>
          </>
        )}
      </div>

      {flags.flags['mcp.skeleton'] && (
        <div className="field-block" data-testid="flags-mcp">
          <div className="mask-head">
            <span className="label-mono">Каркас MCP</span>
            <span className="mask-flag">
              <IconTerminal width={11} height={11} aria-hidden="true" focusable="false" />
              <span className="mask-flag-text">только чтение</span>
            </span>
          </div>
          {mcp === null ? (
            <div className="stat-line">Читаем локальную папку ai/…</div>
          ) : mcp === 'no-session' ? (
            <div className="stat-line">
              Список закрыт: нужен вход в приложение — маршрут /ai-api/mcp отвечает 401, пока сессии
              нет.
            </div>
          ) : mcp === 'error' ? (
            <div className="stat-line">
              Список не прочитан: маршрут /ai-api/mcp не ответил. Цифр не показываем — источника нет.
            </div>
          ) : mcp.length === 0 ? (
            <div className="stat-line">MCP-серверов в папке ai/ нет.</div>
          ) : (
            <div className="net-log">
              {mcp.map((s) => (
                <div className="net-log-row" key={s.id}>
                  <span className="mono">{s.name || s.id}</span>
                  <span className="label-mono">{s.transport}</span>
                  <span className="label-mono num">{s.tools?.length ?? 0} инструментов</span>
                  <span className={`badge ${s.enabled ? 'badge-ok' : 'badge-info'}`}>
                    {s.enabled ? 'включён' : 'выключен'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
