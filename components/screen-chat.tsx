'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconChat,
  IconChevronDown,
  IconChipAi,
  IconClose,
  IconExternal,
  IconPlus,
  IconSearch,
  IconShield,
  IconSparkText,
  IconChevronLeft,
} from './icons'
import { Composer } from './chat/composer'
import { MessageAi, type LiveState } from './chat/message-ai'
import { MessageUser } from './chat/message-user'
import { SessionRail } from './chat/session-rail'
import { SourceDesk } from './chat/source-desk'
import { AiHub } from './chat/ai-hub'
import type { AiMsg, ChatMsg, Session, UserMsg } from './chat/types'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { useAiChat, type ExecResult, type TurnBody } from '@/hooks/use-ai-chat'
import { useVault } from '@/lib/vault-store'
import { useSecrets } from '@/lib/secrets-store'
import { useRedacted } from '@/lib/redact-context'
import { aiApi } from '@/lib/ai-client'
import { fileMeta, fileTags } from '@/lib/data'
import { CHAT_SUGGESTIONS } from '@/lib/chat-data'

const hhmm = () =>
  new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`

/**
 * Экран разговора с сейфом. Модель настоящая — Claude Opus 5 через шлюз
 * Emergent, скиллы выполняются на устройстве: поиск по файлам и запись в
 * секретницу не покидают браузер, наружу уходит только сам разговор и
 * метаданные файлов. Сессии зеркалятся файлами в ai/sessions репозитория.
 */
export function ScreenChat() {
  const v = useVault()
  const secrets = useSecrets()
  const { redactIds } = useRedacted()
  const sessions = v.sessions
  const [railOpen, setRailOpen] = usePersistedState('wf.chat.rail', true)
  const [streamFor, setStreamFor] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ msgId: string; n: number } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [fresh, setFresh] = useState(false)
  const [say, setSay] = useState('')
  const [finding, setFinding] = useState(false)
  const [needle, setNeedle] = useState('')
  const [hubOpen, setHubOpen] = useState(false)
  // Черновик до создания сессии: без него ввод в пустом состоянии терялся.
  const [freeDraft, setFreeDraft] = useState('')

  const scroller = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const restored = useRef<string | null>(null)
  const synced = useRef(false)

  /** Разовая синхронизация: сессии из файлов ai/sessions подтягиваются в рельс. */
  useEffect(() => {
    if (!v.hydrated || synced.current) return
    synced.current = true
    void (async () => {
      try {
        const metas = await aiApi.sessions()
        const known = new Set(v.sessions.map((s) => s.id))
        for (const m of metas) {
          if (known.has(m.id)) continue
          const full = await aiApi.session(m.id).catch(() => null)
          if (full && Array.isArray(full.msgs) && full.msgs.length) {
            v.addSession({
              id: full.id,
              title: full.title,
              createdAt: full.createdAt,
              pinned: full.pinned ?? [],
              msgs: full.msgs,
            })
          }
        }
      } catch {
        /* сервер недоступен — работаем с локальной копией */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.hydrated])

  const active = useMemo(
    () => sessions.find((s) => s.id === v.activeSessionId) ?? sessions[0] ?? null,
    [sessions, v.activeSessionId],
  )

  const patch = v.patchSession

  /* ---------- скиллы: выполнение на устройстве ---------- */

  const exec = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<ExecResult> => {
      if (name === 'find_file') {
        const q = String(args.query ?? '')
        const toks = q
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length > 1)
        const scored = v.views
          .map((f) => {
            const hay = `${f.name} ${f.cat} ${fileTags(f).join(' ')}`.toLowerCase()
            let score = 0
            for (const t of toks) if (hay.includes(t)) score += 1
            return { f, score }
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
        const max = scored[0]?.score || 1
        return {
          ok: true,
          summary: scored.length ? `найдено файлов: ${scored.length}` : 'совпадений в сейфе нет',
          files: scored.map(({ f, score }) => ({
            id: f.id,
            name: f.name,
            weight: Math.round(55 + 45 * (score / max)),
          })),
          content: JSON.stringify({
            found: scored.map(({ f }) => ({
              id: f.id,
              name: f.name,
              category: f.cat,
              tags: fileTags(f),
              info: fileMeta(f),
            })),
          }),
        }
      }

      if (name === 'save_password') {
        const title = String(args.title ?? 'Без названия').slice(0, 60)
        if (secrets.needsLock) {
          return {
            ok: false,
            summary: 'мастер-ключ не настроен',
            content: JSON.stringify({
              ok: false,
              error: 'Мастер-ключ не настроен: пусть пользователь включит замок в настройках безопасности.',
            }),
          }
        }
        const fields = [
          { name: 'Сайт', kind: 'url' as const, value: String(args.url ?? ''), secret: false },
          { name: 'Логин', kind: 'text' as const, value: String(args.login ?? ''), secret: false },
          { name: 'Пароль', kind: 'password' as const, value: String(args.password ?? ''), secret: true },
          { name: 'Заметки', kind: 'multiline' as const, value: String(args.notes ?? ''), secret: false },
        ].filter((f) => f.value)
        const problem = await secrets.createEntry('login', title, fields, { tags: ['ИИ'] })
        if (problem) {
          return {
            ok: false,
            summary: problem,
            content: JSON.stringify({ ok: false, error: `${problem}. Пусть пользователь откроет сейф и повторит.` }),
          }
        }
        v.notify({
          kind: 'ok',
          cat: 'privacy',
          icon: 'lockRound',
          title: 'ИИ сохранил пароль в сейф',
          body: `Запись «${title}» создана скиллом save_password с вашего разрешения.`,
        })
        return {
          ok: true,
          summary: `запись «${title}» зашифрована и сохранена`,
          content: JSON.stringify({ ok: true, title, note: 'Пароль сохранён. Не показывай его в ответе.' }),
        }
      }

      if (name === 'notion_pull') {
        const r = (await aiApi
          .mcpAction('notion', { action: 'pull', query: String(args.query ?? '') })
          .catch(() => null)) as { ok?: boolean; doc?: { title?: string }; error?: string } | null
        if (!r) {
          return {
            ok: false,
            summary: 'MCP не ответил',
            content: JSON.stringify({ ok: false, error: 'MCP-сервер не ответил.' }),
          }
        }
        if (!r.ok) {
          return { ok: false, summary: String(r.error ?? 'ошибка MCP'), content: JSON.stringify(r) }
        }
        return {
          ok: true,
          summary: `получен макет «${r.doc?.title ?? ''}» · скелет MCP`,
          content: JSON.stringify(r),
        }
      }

      return {
        ok: false,
        summary: 'неизвестный скилл',
        content: JSON.stringify({ ok: false, error: `Скилл ${name} не реализован на устройстве.` }),
      }
    },
    [v, secrets],
  )

  const ai = useAiChat(exec)

  /* ---------- запуск хода ---------- */

  const buildCtx = useCallback(
    (pinned: string[]): TurnBody['ctx'] => ({
      files: v.views.map((f) => ({ id: f.id, name: f.name, cat: f.cat, tags: fileTags(f) })),
      pinned: pinned.map((id) => v.viewById(id)?.name ?? id),
      lock: secrets.needsLock ? 'не настроен' : 'настроен (содержимое секретов ИИ недоступно)',
      scanned: v.stats.files,
    }),
    [v, secrets.needsLock],
  )

  const run = useCallback(
    (
      sessionId: string,
      opts: { text?: string; title?: string; dropUsers?: number; regenerate?: boolean },
    ) => {
      setStreamFor(sessionId)
      setSay('Модель думает.')
      const pinned = sessions.find((s) => s.id === sessionId)?.pinned ?? []
      ai.start({ sessionId, ...opts, ctx: buildCtx(pinned) }, (r) => {
        setStreamFor(null)
        const sources = r.stopped
          ? []
          : r.found.map((f, i) => {
              const view = v.viewById(f.id)
              return {
                n: i + 1,
                fileId: f.id,
                locator: view?.cat,
                quote: view ? fileMeta(view) : f.name,
                weight: f.weight,
              }
            })
        const msg: AiMsg = {
          id: uid('a'),
          role: 'ai',
          time: hhmm(),
          text:
            r.text ||
            (r.error
              ? 'Не удалось получить ответ модели.'
              : r.stopped
                ? ''
                : 'Модель вернула пустой ответ.'),
          sources,
          scanned: v.stats.files,
          picked: sources.length,
          grounded: !(r.findRan && sources.length === 0),
          stopped: r.stopped || undefined,
          error: r.error,
          ms: r.ms,
          stages: r.stages,
          tools: r.tools.length ? r.tools : undefined,
        }
        let snap: Session | null = null
        patch(sessionId, (s) => {
          snap = { ...s, msgs: [...s.msgs, msg] }
          return snap
        })
        const done = snap as Session | null
        if (done) {
          void aiApi.patchSession(done.id, {
            title: done.title,
            msgs: done.msgs,
            pinned: done.pinned,
            createdAt: done.createdAt,
          })
        }
        setSay(r.error ? 'Сбой запроса к модели.' : r.stopped ? 'Ответ остановлен.' : 'Ответ готов.')
      })
    },
    [ai, buildCtx, patch, sessions, v],
  )

  const send = useCallback(
    (text: string) => {
      const msg: UserMsg = { id: uid('u'), role: 'user', time: hhmm(), text }
      if (!active) {
        const s: Session = {
          id: uid('s'),
          title: text.slice(0, 42),
          createdAt: Date.now(),
          pinned: [],
          msgs: [msg],
        }
        v.addSession(s)
        v.setActiveSession(s.id)
        run(s.id, { text, title: s.title })
        return
      }
      patch(active.id, (s) => ({
        ...s,
        title: s.msgs.length === 0 ? text.slice(0, 42) : s.title,
        msgs: [...s.msgs, msg],
      }))
      run(active.id, { text, title: active.msgs.length === 0 ? text.slice(0, 42) : active.title })
    },
    [active, patch, run, v],
  )

  /** Переспросить: ответ заменяется новым, вопрос остаётся на месте. */
  const regenerate = useCallback(
    (msgId: string) => {
      if (!active || ai.active) return
      const i = active.msgs.findIndex((m) => m.id === msgId)
      if (i < 0) return
      patch(active.id, (s) => ({ ...s, msgs: s.msgs.slice(0, i) }))
      setPicked(null)
      run(active.id, { regenerate: true })
    },
    [active, ai.active, patch, run],
  )

  /** Правка запроса: ветка сохраняется, история модели откатывается к этому месту. */
  const editUser = useCallback(
    (msgId: string, text: string) => {
      if (!active || ai.active) return
      const i = active.msgs.findIndex((m) => m.id === msgId)
      if (i < 0) return
      const dropUsers = active.msgs.slice(i).filter((m) => m.role === 'user').length
      patch(active.id, (s) => {
        const j = s.msgs.findIndex((m) => m.id === msgId)
        if (j < 0) return s
        const prev = s.msgs[j] as UserMsg
        const variants = prev.variants?.length ? [...prev.variants] : [prev.text]
        const next: UserMsg = { ...prev, text, variants: [...variants, text] }
        return { ...s, msgs: [...s.msgs.slice(0, j), next] }
      })
      setPicked(null)
      run(active.id, { text, dropUsers })
    },
    [active, ai.active, patch, run],
  )

  const togglePin = useCallback(
    (fileId: string) => {
      if (!active) return
      const next = active.pinned.includes(fileId)
        ? active.pinned.filter((p) => p !== fileId)
        : [...active.pinned, fileId]
      patch(active.id, (s) => ({ ...s, pinned: next }))
      void aiApi.patchSession(active.id, { pinned: next, createdAt: active.createdAt })
    },
    [active, patch],
  )

  const newSession = useCallback(() => {
    const s: Session = {
      id: uid('s'),
      title: 'Новый диалог',
      createdAt: Date.now(),
      pinned: [],
      msgs: [],
    }
    v.addSession(s)
    v.setActiveSession(s.id)
    setPicked(null)
    void aiApi.createSession(s.id, s.title)
  }, [v])

  const renameSession = useCallback(
    (id: string, title: string) => {
      patch(id, (s) => ({ ...s, title }))
      void aiApi.patchSession(id, { title })
    },
    [patch],
  )

  const deleteSession = useCallback(
    (id: string) => {
      v.removeSession(id)
      void aiApi.deleteSession(id)
    },
    [v],
  )

  /** Экспорт переписки в Markdown: файл уходит на диск, а не в сеть. */
  const exportMd = useCallback(() => {
    if (!active) return
    const lines = [`# ${active.title}`, '']
    for (const m of active.msgs) {
      if (m.role === 'user') lines.push(`**Вопрос (${m.time}):** ${m.text}`, '')
      else {
        lines.push(`**Ответ (${m.time}):** ${m.text}`, '')
        for (const t of m.tools ?? []) {
          lines.push(`> скилл ${t.label}: ${t.summary ?? t.status}`)
        }
        for (const s of m.sources) {
          const name = v.fileById(s.fileId)?.name ?? s.fileId
          lines.push(
            redactIds.has(s.fileId)
              ? `> [${s.n}] ${name} — источник под ключом, детали скрыты`
              : `> [${s.n}] ${name} — ${s.locator ?? ''}: ${s.quote}`,
          )
        }
        lines.push('')
      }
    }
    const text = lines.join('\n')
    void navigator.clipboard?.writeText(text).catch(() => {})
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.title.replace(/[^\p{L}\p{N}]+/gu, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
    setSay('Разговор выгружен в Markdown и скопирован в буфер.')
    v.flash('Разговор выгружен в Markdown — файл сохранён на диск.')
  }, [active, v, redactIds])

  /* ---------- прокрутка ---------- */

  const jumpDown = useCallback(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setFresh(false)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (atBottom) el.scrollTop = el.scrollHeight
    else setFresh(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.msgs.length, ai.text, ai.stages.length, ai.tools.length])

  /** Возврат на экран или к другому разговору не теряет позицию чтения. */
  useEffect(() => {
    const el = scroller.current
    if (!el || !active || restored.current === active.id) return
    restored.current = active.id
    const top = v.scrolls[active.id]
    requestAnimationFrame(() => {
      el.scrollTop = typeof top === 'number' ? top : el.scrollHeight
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  useEffect(() => {
    const el = scroller.current
    const id = active?.id
    return () => {
      if (el && id) v.setScroll(id, el.scrollTop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  /** Ctrl/Cmd+F — поиск внутри разговора; Ctrl+K остаётся за палитрой сейфа. */
  const openFind = useCallback(() => {
    setFinding(true)
    setNeedle((cur) => cur || v.query.trim())
    requestAnimationFrame(() => findRef.current?.focus())
  }, [v.query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openFind()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFind])

  const msgs: ChatMsg[] = active?.msgs ?? []
  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase()
    if (!finding || !q) return msgs
    return msgs.filter((m) => m.text.toLowerCase().includes(q))
  }, [msgs, needle, finding])

  const lastQuery = useMemo(() => {
    const u = [...msgs].reverse().find((m) => m.role === 'user') as UserMsg | undefined
    return u?.text ?? null
  }, [msgs])

  const deskMsg = useMemo(
    () => (picked ? (msgs.find((m) => m.id === picked.msgId) as AiMsg | undefined) : undefined),
    [picked, msgs],
  )

  const streaming = ai.active && streamFor !== null && active?.id === streamFor

  const live: LiveState | null = streaming
    ? { text: ai.text, stages: ai.stages, shown: ai.stages.length, tracing: !ai.text }
    : null

  const liveMsg: AiMsg | null = streaming
    ? {
        id: 'live',
        role: 'ai',
        time: hhmm(),
        text: ai.text,
        sources: [],
        scanned: v.stats.files,
        picked: 0,
        grounded: true,
        ms: 0,
        stages: [],
        tools: ai.tools.length ? ai.tools : undefined,
      }
    : null

  /** Окно контекста: считаем по длине переписки, предупреждаем заранее. */
  const fill = Math.min(
    100,
    Math.round(
      (msgs.reduce((n, m) => n + m.text.length, 0) / 9000) * 100 +
        (active?.pinned.length ?? 0) * 4,
    ),
  )

  const draft = active ? (v.drafts[active.id] ?? '') : freeDraft
  const setDraft = useCallback(
    (next: string) => {
      if (active) v.setDraft(active.id, next)
      else setFreeDraft(next)
    },
    [active, v],
  )

  const openFile = useCallback((fileId: string) => v.openFile(fileId), [v])

  return (
    <div className={`chat${railOpen ? ' has-rail' : ''}${deskMsg ? ' has-desk' : ''}`}>
      {railOpen ? (
        <div className="chat-rail">
          <SessionRail
            sessions={sessions}
            activeId={active?.id ?? null}
            now={v.now || Date.now()}
            onSelect={(id) => {
              v.setActiveSession(id)
              setPicked(null)
            }}
            onNew={newSession}
            onDelete={deleteSession}
            onRename={renameSession}
            onCollapse={() => setRailOpen(false)}
          />
        </div>
      ) : null}

      <section className="chat-main" aria-label="Разговор с архивом">
        <header className="chat-top">
          {!railOpen ? (
            <button
              type="button"
              className="icon-btn chat-rail-open"
              onClick={() => setRailOpen(true)}
              aria-label="Показать список диалогов"
            >
              <IconChevronLeft aria-hidden="true" style={{ transform: 'rotate(180deg)' }} />
            </button>
          ) : null}
          <span className="chat-mark" aria-hidden="true">
            <IconChat />
          </span>
          <div className="chat-titles">
            <h1 className="chat-title ellipsis">{active?.title ?? 'Новый диалог'}</h1>
            <p className="chat-sub mono">
              Claude Opus 5 · контекст: {v.stats.files} файлов
              {active?.pinned.length ? ` · закреплено ${active.pinned.length}` : ''} · скиллы и MCP —
              в AI-центре
            </p>
          </div>
          <span className="grow" />
          {fill >= 80 ? <span className="badge badge-warn chat-fill">контекст {fill}%</span> : null}
          <button
            type="button"
            className="badge badge-warn chat-offline"
            onClick={() => setHubOpen(true)}
            title="Разговор идёт через облако Emergent — файлы остаются на устройстве"
            data-testid="chat-cloud-badge"
          >
            <IconShield aria-hidden="true" />
            облако · Opus 5
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setHubOpen(true)}
            data-testid="ai-hub-open"
          >
            <IconChipAi aria-hidden="true" />
            AI-центр
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => (finding ? setFinding(false) : openFind())}
            aria-pressed={finding}
            title="Поиск по разговору (Ctrl+F)"
          >
            <IconSearch aria-hidden="true" />
            Найти
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportMd}
            disabled={!msgs.length}
          >
            <IconExternal aria-hidden="true" />
            Экспорт
          </button>
          <button type="button" className="btn btn-tertiary btn-sm" onClick={newSession}>
            <IconPlus aria-hidden="true" />
            Новый
          </button>
        </header>

        {finding ? (
          <div className="chat-find">
            <IconSearch aria-hidden="true" width={14} height={14} />
            <input
              ref={findRef}
              type="search"
              value={needle}
              placeholder="Поиск внутри разговора"
              aria-label="Поиск внутри разговора"
              onChange={(e) => setNeedle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFinding(false)
                  setNeedle('')
                }
              }}
            />
            <span className="mono chat-find-count">
              {needle.trim() ? `${shown.length} из ${msgs.length}` : `${msgs.length} сообщений`}
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setFinding(false)
                setNeedle('')
              }}
              aria-label="Закрыть поиск"
            >
              <IconClose aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div
          className="chat-scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
            setAtBottom(bottom)
            if (bottom) setFresh(false)
          }}
        >
          <div className="chat-thread" aria-busy={streaming}>
            {msgs.length === 0 && !live ? (
              <div className="chat-empty">
                <span className="chat-empty-mark" aria-hidden="true">
                  <IconSparkText />
                </span>
                <h2 className="chat-empty-title">Спросите свой архив</h2>
                <p className="chat-empty-note">
                  Отвечает Claude Opus 5 со скиллами: находит файлы в сейфе, сохраняет пароли в
                  секретницу (с вашего разрешения) и вытягивает документы из Notion через MCP.
                </p>
                <ul className="chat-sugs">
                  {CHAT_SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button type="button" className="f-chip" onClick={() => send(s)}>
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="chat-empty-stat mono">
                  {v.stats.files} файлов проиндексировано · скиллы и MCP настраиваются в AI-центре
                </p>
              </div>
            ) : null}

            {msgs.length && !finding ? (
              <div className="chat-day">
                <span className="label-mono">сегодня</span>
              </div>
            ) : null}

            {shown.map((m) =>
              m.role === 'user' ? (
                <MessageUser key={m.id} msg={m} onEdit={editUser} />
              ) : (
                <MessageAi
                  key={m.id}
                  msg={m}
                  activeSource={picked}
                  onSource={(msgId, n) => setPicked({ msgId, n })}
                  onRegenerate={regenerate}
                  onPinSource={togglePin}
                  onOpenFile={openFile}
                />
              ),
            )}

            {finding && needle.trim() && shown.length === 0 ? (
              <p className="chat-nofind">В этом разговоре нет такого текста.</p>
            ) : null}

            {liveMsg && live ? (
              <MessageAi
                msg={liveMsg}
                live={live}
                activeSource={null}
                onSource={() => {}}
                onAllow={ai.allow}
                onDeny={ai.deny}
                onOpenFile={openFile}
              />
            ) : null}
          </div>

          {fresh && !atBottom ? (
            <button type="button" className="jump" onClick={jumpDown}>
              <IconChevronDown aria-hidden="true" />
              Новое ниже
            </button>
          ) : null}
        </div>

        <Composer
          onSend={send}
          onStop={ai.stop}
          busy={ai.active}
          pinned={active?.pinned ?? []}
          onTogglePin={togglePin}
          lastQuery={lastQuery}
          draft={draft}
          onDraft={setDraft}
        />
      </section>

      {deskMsg && picked ? (
        <SourceDesk
          sources={deskMsg.sources}
          activeN={picked.n}
          onPick={(n) => setPicked({ msgId: deskMsg.id, n })}
          onClose={() => setPicked(null)}
          onOpenMap={(fileId) => (fileId ? v.openOnMap(fileId) : v.go('map'))}
          onOpenFile={(fileId) => v.openFile(fileId)}
          onPin={togglePin}
          pinned={active?.pinned ?? []}
        />
      ) : null}

      {hubOpen ? <AiHub onClose={() => setHubOpen(false)} /> : null}

      {/* Вежливая область: скринридер узнаёт итог, а не каждый выданный токен. */}
      <p className="sr-only" role="status" aria-live="polite">
        {say}
      </p>
    </div>
  )
}
