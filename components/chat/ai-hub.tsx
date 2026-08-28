'use client'

import { useCallback, useEffect, useState } from 'react'
import { IconCheck, IconChipAi, IconClose, IconExternal, IconPlus, IconRefresh, IconTrash } from '../icons'
import { aiApi, type McpDto, type SkillDto } from '@/lib/ai-client'

type Tab = 'skills' | 'mcp' | 'prompt'

/**
 * AI-центр: скиллы, MCP-серверы и системный промпт. Всё это — физические
 * файлы в папке /ai репозитория, панель редактирует их через /ai-api.
 */
export function AiHub({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('skills')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="aihub-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="aihub" role="dialog" aria-label="AI-центр" data-testid="ai-hub-panel">
        <header className="aihub-head">
          <span className="aihub-mark" aria-hidden="true">
            <IconChipAi />
          </span>
          <div>
            <h2 className="aihub-title">AI-центр</h2>
            <p className="aihub-sub mono">файлы в папке ai/ · Claude Opus 5</p>
          </div>
          <span className="grow" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть AI-центр" data-testid="ai-hub-close">
            <IconClose aria-hidden="true" />
          </button>
        </header>

        <nav className="aihub-tabs" aria-label="Разделы AI-центра">
          {(
            [
              ['skills', 'Скиллы'],
              ['mcp', 'MCP-серверы'],
              ['prompt', 'Промпт'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`aihub-tab${tab === id ? ' is-on' : ''}`}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              data-testid={`ai-hub-tab-${id}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="aihub-body">
          {tab === 'skills' ? <SkillsTab /> : null}
          {tab === 'mcp' ? <McpTab /> : null}
          {tab === 'prompt' ? <PromptTab /> : null}
        </div>
      </aside>
    </div>
  )
}

/* ---------- скиллы ---------- */

function SkillsTab() {
  const [skills, setSkills] = useState<SkillDto[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const reload = useCallback(() => {
    aiApi
      .skills()
      .then(setSkills)
      .catch(() => setErr('Не удалось прочитать папку ai/skills.'))
  }, [])

  useEffect(reload, [reload])

  async function toggle(s: SkillDto) {
    const next = await aiApi.putSkill(s.id, { enabled: !s.enabled }).catch(() => null)
    if (next) setSkills((p) => p?.map((x) => (x.id === s.id ? next : x)) ?? null)
  }

  if (err) return <p className="aihub-empty">{err}</p>
  if (!skills) return <p className="aihub-empty">Читаю ai/skills…</p>

  return (
    <div className="aihub-stack">
      <p className="aihub-note">
        Встроенные скиллы-инструменты выполняются на устройстве. Свои скиллы — это инструкции,
        которые модель получает с каждым запросом. Всё хранится файлами в <span className="mono">ai/skills/</span>.
      </p>
      <ul className="skill-list">
        {skills.map((s) => (
          <li key={s.id} className={`skill-card${s.enabled ? '' : ' is-off'}`} data-testid={`skill-card-${s.id}`}>
            <div className="skill-row">
              <button
                type="button"
                className={`skill-switch${s.enabled ? ' is-on' : ''}`}
                onClick={() => toggle(s)}
                role="switch"
                aria-checked={s.enabled}
                aria-label={`Скилл «${s.name}»`}
                data-testid={`skill-toggle-${s.id}`}
              >
                <span aria-hidden="true" />
              </button>
              <button
                type="button"
                className="skill-name"
                onClick={() => setOpenId((v) => (v === s.id ? null : s.id))}
                aria-expanded={openId === s.id}
                data-testid={`skill-open-${s.id}`}
              >
                {s.name}
              </button>
              <span className={`badge skill-kind ${s.kind === 'tool' ? 'badge-ok' : ''}`}>
                {s.kind === 'tool' ? 'инструмент' : 'инструкция'}
              </span>
              {!s.builtin ? (
                <button
                  type="button"
                  className="icon-btn skill-del"
                  onClick={async () => {
                    await aiApi.delSkill(s.id)
                    reload()
                  }}
                  aria-label={`Удалить скилл «${s.name}»`}
                  data-testid={`skill-delete-${s.id}`}
                >
                  <IconTrash aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {s.description ? <p className="skill-desc">{s.description}</p> : null}
            {openId === s.id ? <SkillEditor skill={s} onSaved={reload} /> : null}
          </li>
        ))}
      </ul>

      {adding ? (
        <SkillAdd
          onDone={() => {
            setAdding(false)
            reload()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setAdding(true)} data-testid="skill-add-open">
          <IconPlus aria-hidden="true" />
          Добавить свой скилл
        </button>
      )}
    </div>
  )
}

function SkillEditor({ skill, onSaved }: { skill: SkillDto; onSaved: () => void }) {
  const [text, setText] = useState(skill.instructions)
  const [saved, setSaved] = useState(false)
  return (
    <div className="skill-edit">
      <label className="label-mono" htmlFor={`ski-${skill.id}`}>
        инструкция для модели
      </label>
      <textarea
        id={`ski-${skill.id}`}
        value={text}
        rows={5}
        onChange={(e) => setText(e.target.value)}
        data-testid={`skill-instructions-${skill.id}`}
      />
      <div className="skill-edit-foot">
        <span className="mono aihub-path">ai/skills/{skill.id}.json</span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={async () => {
            await aiApi.putSkill(skill.id, { instructions: text }).catch(() => null)
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
            onSaved()
          }}
          data-testid={`skill-save-${skill.id}`}
        >
          {saved ? <IconCheck aria-hidden="true" /> : null}
          {saved ? 'Сохранено' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}

function SkillAdd({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [err, setErr] = useState('')
  return (
    <div className="skill-edit skill-add" data-testid="skill-add-form">
      <label className="label-mono" htmlFor="ska-name">
        название
      </label>
      <input
        id="ska-name"
        value={name}
        placeholder="Например: Отвечать списками"
        onChange={(e) => setName(e.target.value)}
        data-testid="skill-add-name"
      />
      <label className="label-mono" htmlFor="ska-ins">
        инструкция
      </label>
      <textarea
        id="ska-ins"
        rows={4}
        value={instructions}
        placeholder="Что модель должна делать и когда…"
        onChange={(e) => setInstructions(e.target.value)}
        data-testid="skill-add-instructions"
      />
      {err ? <p className="aihub-err">{err}</p> : null}
      <div className="skill-edit-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Отмена
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={async () => {
            try {
              await aiApi.addSkill({ name, instructions })
              onDone()
            } catch {
              setErr('Нужны название и инструкция.')
            }
          }}
          data-testid="skill-add-save"
        >
          <IconPlus aria-hidden="true" />
          Создать скилл
        </button>
      </div>
    </div>
  )
}

/* ---------- MCP ---------- */

function McpTab() {
  const [servers, setServers] = useState<McpDto[] | null>(null)

  useEffect(() => {
    aiApi.mcp().then(setServers).catch(() => setServers([]))
  }, [])

  if (!servers) return <p className="aihub-empty">Читаю ai/mcp…</p>
  return (
    <div className="aihub-stack">
      <p className="aihub-note">
        MCP (Model Context Protocol) подключает внешние источники к модели. Конфиги лежат в{' '}
        <span className="mono">ai/mcp/</span>. Notion пока работает как скелет: до реального токена
        ответы имитируются.
      </p>
      {servers.map((m) => (
        <McpCard key={m.id} server={m} />
      ))}
    </div>
  )
}

function McpCard({ server }: { server: McpDto }) {
  const [m, setM] = useState(server)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(patch: Partial<Pick<McpDto, 'host' | 'port' | 'token' | 'enabled'>>) {
    const next = await aiApi.putMcp(m.id, patch).catch(() => null)
    if (next) setM(next)
  }

  return (
    <section className={`mcp-card${m.enabled ? '' : ' is-off'}`} data-testid={`mcp-card-${m.id}`}>
      <header className="mcp-head">
        <span className={`mcp-dot${m.enabled ? (m.host ? ' is-ok' : ' is-warn') : ''}`} aria-hidden="true" />
        <h3 className="mcp-name">{m.name}</h3>
        <span className="badge">скелет</span>
        <span className="grow" />
        <button
          type="button"
          className={`skill-switch${m.enabled ? ' is-on' : ''}`}
          onClick={() => save({ enabled: !m.enabled })}
          role="switch"
          aria-checked={m.enabled}
          aria-label={`MCP-сервер ${m.name}`}
          data-testid={`mcp-toggle-${m.id}`}
        >
          <span aria-hidden="true" />
        </button>
      </header>

      <div className="mcp-grid">
        <label className="mcp-field">
          <span className="label-mono">адрес (IP или хост)</span>
          <input
            value={m.host}
            placeholder="192.168.1.10 или mcp.notion.local"
            onChange={(e) => setM({ ...m, host: e.target.value })}
            onBlur={() => save({ host: m.host })}
            data-testid={`mcp-host-${m.id}`}
          />
        </label>
        <label className="mcp-field mcp-port">
          <span className="label-mono">порт</span>
          <input
            value={m.port}
            inputMode="numeric"
            onChange={(e) => setM({ ...m, port: Number(e.target.value.replace(/\D/g, '')) || 0 })}
            onBlur={() => save({ port: m.port })}
            data-testid={`mcp-port-${m.id}`}
          />
        </label>
        <label className="mcp-field">
          <span className="label-mono">токен (появится позже)</span>
          <input
            type="password"
            value={m.token}
            placeholder="ntn_… — пока не требуется"
            onChange={(e) => setM({ ...m, token: e.target.value })}
            onBlur={() => save({ token: m.token })}
            data-testid={`mcp-token-${m.id}`}
          />
        </label>
      </div>

      <div className="mcp-actions">
        <button
          type="button"
          className="btn btn-tertiary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = (await aiApi.mcpAction(m.id, { action: 'test' }).catch(() => null)) as
              | { ok?: boolean; message?: string }
              | null
            setMsg(r ? { ok: Boolean(r.ok), text: String(r.message ?? '') } : { ok: false, text: 'Сервер не ответил.' })
            setBusy(false)
          }}
          data-testid={`mcp-test-${m.id}`}
        >
          <IconRefresh aria-hidden="true" />
          Проверить соединение
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = (await aiApi.mcpAction(m.id, { action: 'pull', query: 'тестовый документ' }).catch(() => null)) as
              | { ok?: boolean; doc?: { title?: string; url?: string }; error?: string }
              | null
            setMsg(
              r?.ok && r.doc
                ? { ok: true, text: `Получен макет: «${r.doc.title}»` }
                : { ok: false, text: String(r?.error ?? 'Сервер не ответил.') },
            )
            setBusy(false)
          }}
          data-testid={`mcp-pull-${m.id}`}
        >
          <IconExternal aria-hidden="true" />
          Тестовый документ
        </button>
      </div>

      {msg ? (
        <p className={`mcp-msg${msg.ok ? ' is-ok' : ' is-err'}`} data-testid={`mcp-msg-${m.id}`}>
          {msg.text}
        </p>
      ) : null}
      <p className="mono aihub-path">ai/mcp/{m.id}.json</p>
    </section>
  )
}

/* ---------- системный промпт ---------- */

function PromptTab() {
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    aiApi
      .systemPrompt()
      .then((r) => setText(r.text))
      .catch(() => setText(''))
  }, [])

  if (text === null) return <p className="aihub-empty">Читаю ai/system.md…</p>
  return (
    <div className="aihub-stack">
      <p className="aihub-note">
        Базовый системный промпт модели. К нему автоматически добавляются включённые скиллы и живой
        контекст сейфа.
      </p>
      <textarea
        className="prompt-area"
        value={text}
        rows={16}
        onChange={(e) => setText(e.target.value)}
        aria-label="Системный промпт"
        data-testid="system-prompt-area"
      />
      <div className="skill-edit-foot">
        <span className="mono aihub-path">ai/system.md</span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={async () => {
            await aiApi.saveSystemPrompt(text).catch(() => null)
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
          }}
          data-testid="system-prompt-save"
        >
          {saved ? <IconCheck aria-hidden="true" /> : null}
          {saved ? 'Сохранено' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
