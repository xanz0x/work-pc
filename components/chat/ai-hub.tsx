'use client'

import { useCallback, useEffect, useState } from 'react'
import { IconAlertTri, IconCheck, IconChipAi, IconClose, IconExternal, IconPlus, IconRefresh, IconTrash } from '../icons'
import { aiApi, type McpDto, type SkillDto } from '@/lib/ai-client'
import { useFlags } from '@/lib/flags'
import { useDialog } from '@/hooks/use-dialog'
import { useAccount } from '@/lib/account'
import { CHAT_TOOL_HELP, toolAccess } from '@/lib/chat-tools'

type Tab = 'skills' | 'mcp' | 'prompt'

/**
 * AI-центр: скиллы, MCP-серверы и системный промпт. Всё это — физические
 * файлы в папке /ai репозитория, панель редактирует их через /ai-api.
 */
export function AiHub({ onClose }: { onClose: () => void }) {
  const dialog = useDialog<HTMLElement>({ onClose, label: 'Навыки и инструкции ИИ' })
  const [tab, setTab] = useState<Tab>('skills')
  /* RM-3: скелет MCP — незаконченная часть продукта, её показывает флаг.
     Пока он выключен, вкладки просто нет: не показываем макет как функцию. */
  const mcpOn = useFlags().flags['mcp.skeleton']
  const shown: [Tab, string][] = [
    ['skills', 'Скиллы'],
    ...((mcpOn ? [['mcp', 'MCP-серверы']] : []) as [Tab, string][]),
    ['prompt', 'Промпт'],
  ]
  const current: Tab = tab === 'mcp' && !mcpOn ? 'skills' : tab

  return (
    <div className="aihub-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="aihub" {...dialog.dialogProps} data-testid="ai-hub-panel">
        <header className="aihub-head">
          <span className="aihub-mark" aria-hidden="true">
            <IconChipAi />
          </span>
          <div>
            <h2 className="aihub-title" data-testid="ai-hub-title">Навыки и инструкции</h2>
            <p className="aihub-sub" data-testid="ai-hub-description">Действия чата и правила ответов</p>
          </div>
          <span className="grow" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть AI-центр" data-testid="ai-hub-close">
            <IconClose aria-hidden="true" />
          </button>
        </header>

        <nav className="aihub-tabs" aria-label="Разделы AI-центра">
          {shown.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`aihub-tab${current === id ? ' is-on' : ''}`}
              onClick={() => setTab(id)}
              aria-pressed={current === id}
              data-testid={`ai-hub-tab-${id}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="aihub-body">
          {current === 'skills' ? <SkillsTab /> : null}
          {current === 'mcp' ? <McpTab /> : null}
          {current === 'prompt' ? <PromptTab /> : null}
        </div>
      </aside>
    </div>
  )
}

/* ---------- скиллы ---------- */

function SkillsTab() {
  const account = useAccount()
  const mcpOn = useFlags().flags['mcp.skeleton']
  const [skills, setSkills] = useState<SkillDto[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const reload = useCallback(() => {
    setErr('')
    aiApi
      .skills()
      .then(setSkills)
      .catch(() => setErr('Не удалось загрузить навыки. Повторите попытку.'))
  }, [])

  useEffect(reload, [reload])

  async function toggle(s: SkillDto) {
    if (busy) return
    setBusy(s.id)
    setErr('')
    try {
      const next = await aiApi.putSkill(s.id, { enabled: !s.enabled })
      setSkills((p) => p?.map((x) => (x.id === s.id ? next : x)) ?? null)
    } catch { setErr('Изменение не сохранено. Повторите попытку.') }
    finally { setBusy(null) }
  }

  if (!skills) return <div><p className="aihub-empty" data-testid="skills-loading">{err || 'Загрузка навыков…'}</p>{err && <button className="btn btn-ghost" onClick={reload} data-testid="skills-retry">Повторить</button>}</div>

  return (
    <div className="aihub-stack">
      <p className="aihub-note" data-testid="skills-description">
        Навыки вызывают функции приложения с учётом ваших прав. Изменения требуют подтверждения. Свои инструкции меняют ответы, но не добавляют доступ к функциям.
      </p>
      {err && <p className="aihub-err" role="alert" data-testid="skills-error">{err}</p>}
      <ul className="skill-list">
        {skills.filter((s) => mcpOn || s.tool !== 'notion_pull').map((s) => (
          <li key={s.id} className={`skill-card${s.enabled ? '' : ' is-off'}`} data-testid={`skill-card-${s.id}`}>
            <div className="skill-row">
              <button
                type="button"
                className={`skill-switch${s.enabled ? ' is-on' : ''}`}
                onClick={() => toggle(s)}
                disabled={Boolean(busy) || Boolean(s.tool && account.user && toolAccess(s.tool, account.user))}
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
              <span className="badge skill-kind" data-testid={`skill-status-${s.id}`}>
                {busy === s.id ? 'Сохранение…' : s.enabled ? 'Включён' : 'Выключен'}
              </span>
              {!s.builtin ? (
                <button
                  type="button"
                  className="icon-btn skill-del"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (!window.confirm(`Удалить инструкцию «${s.name}»? Это действие нельзя отменить.`)) return
                    setBusy(s.id)
                    try { const r = await aiApi.delSkill(s.id); if (!r.ok) throw new Error(); reload() }
                    catch { setErr('Не удалось удалить инструкцию.') }
                    finally { setBusy(null) }
                  }}
                  aria-label={`Удалить скилл «${s.name}»`}
                  data-testid={`skill-delete-${s.id}`}
                >
                  <IconTrash aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {s.description ? <p className="skill-desc" data-testid={`skill-description-${s.id}`}>{s.tool ? CHAT_TOOL_HELP[s.tool] || s.description : s.description}</p> : null}
            {s.tool && account.user && toolAccess(s.tool, account.user) ? <p className="skill-access-note" data-testid={`skill-access-${s.id}`}>{toolAccess(s.tool, account.user)}</p> : null}
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="skill-edit">
      <label className="label-mono" htmlFor={`ski-${skill.id}`}>
        инструкция для модели
      </label>
      <textarea
        id={`ski-${skill.id}`}
        value={text}
        rows={5}
        onChange={(e) => { setText(e.target.value); setSaved(false) }}
        maxLength={4000}
        data-testid={`skill-instructions-${skill.id}`}
      />
      <div className="skill-edit-foot">
        {err && <p className="aihub-err" role="alert" data-testid={`skill-save-error-${skill.id}`}>{err}</p>}
        <span className="mono aihub-path">ai/skills/{skill.id}.json</span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true); setErr('')
            try { await aiApi.putSkill(skill.id, { instructions: text }); setSaved(true); onSaved() }
            catch { setErr('Не удалось сохранить инструкцию.') }
            finally { setBusy(false) }
          }}
          data-testid={`skill-save-${skill.id}`}
        >
          {saved ? <IconCheck aria-hidden="true" /> : null}
          {busy ? 'Сохранение…' : saved ? 'Сохранено' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}

function SkillAdd({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} data-testid="skill-add-cancel">
          Отмена
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={async () => {
            if (busy) return
            setBusy(true)
            try {
              await aiApi.addSkill({ name, instructions })
              onDone()
            } catch {
              setErr('Нужны название и инструкция.')
            } finally { setBusy(false) }
          }}
          disabled={busy || !name.trim() || !instructions.trim()}
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
      <p className="mcp-mock" data-testid="mcp-mock-banner">
        <IconAlertTri aria-hidden="true" />
        Макет, не реальные данные: клиента MCP в сборке нет, соединение не устанавливается,
        а «документы» придумывает скелет.
      </p>
      <p className="aihub-note">
        MCP (Model Context Protocol) подключает внешние источники к модели. Конфиги лежат в{' '}
        <span className="mono">ai/mcp/</span> и настраиваются заранее — чтобы в день появления
        клиента ничего не пришлось искать.
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

  async function save(patch: Partial<Pick<McpDto, 'host' | 'port' | 'enabled'>>) {
    const next = await aiApi.putMcp(m.id, patch).catch(() => null)
    if (next) setM(next)
  }

  return (
    <section className={`mcp-card${m.enabled ? '' : ' is-off'}`} data-testid={`mcp-card-${m.id}`}>
      <header className="mcp-head">
        <span className={`mcp-dot${m.enabled ? (m.host ? ' is-ok' : ' is-warn') : ''}`} aria-hidden="true" />
        <h3 className="mcp-name">{m.name}</h3>
        <span className="badge badge-mock" data-testid={`mcp-badge-${m.id}`}>
          макет
        </span>
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
          <span className="label-mono">токен</span>
          <span className="mcp-token-state mono" data-testid={`mcp-token-${m.id}`}>
            {m.tokenSet
              ? 'задан в окружении сервера'
              : 'не задан · переменная MCP_NOTION_TOKEN на сервере'}
          </span>
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
                ? { ok: true, text: `Скелет вернул макет: «${r.doc.title}». Данные выдуманы.` }
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    aiApi
      .systemPrompt()
      .then((r) => setText(r.text))
      .catch(() => setErr('Не удалось загрузить инструкции. Закройте панель и откройте снова.'))
  }, [])

  if (text === null) return <p className="aihub-empty" data-testid="system-prompt-loading">{err || 'Загрузка инструкций…'}</p>
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
        onChange={(e) => { setText(e.target.value); setSaved(false) }}
        aria-label="Системный промпт"
        data-testid="system-prompt-area"
      />
      <div className="skill-edit-foot">
        {err && <p className="aihub-err" role="alert" data-testid="system-prompt-error">{err}</p>}
        <span className="mono aihub-path">ai/system.md</span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true); setErr('')
            try { await aiApi.saveSystemPrompt(text); setSaved(true) }
            catch { setErr('Не удалось сохранить инструкции.') }
            finally { setBusy(false) }
          }}
          data-testid="system-prompt-save"
        >
          {saved ? <IconCheck aria-hidden="true" /> : null}
          {busy ? 'Сохранение…' : saved ? 'Сохранено' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
