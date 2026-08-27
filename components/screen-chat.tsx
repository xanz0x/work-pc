'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconChat,
  IconChevronDown,
  IconClose,
  IconExternal,
  IconLock,
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
import type { AiMsg, ChatMsg, Session, TraceStage, UserMsg } from './chat/types'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { useFakeStream } from '@/hooks/use-fake-stream'
import { useVault } from '@/lib/vault-store'
import { useRedacted } from '@/lib/redact-context'
import { CHAT_SUGGESTIONS, answerFor, buildStages, isBroad, seedSession } from '@/lib/chat-data'

const hhmm = () =>
  new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`

/**
 * Экран разговора с сейфом. Главная мысль: каждое утверждение модели можно
 * проверить, не покидая переписку, — сноска, засечка на хребте и стол
 * источника справа образуют одну цепочку.
 *
 * История разговоров, черновики и позиции прокрутки лежат в едином сейфе:
 * рельс диалогов, счётчик в навигации и поиск по истории видят одни и те же
 * записи, а сноска на источник ведёт в библиотеку или на карту через ту же
 * навигацию, что и остальные экраны.
 */
export function ScreenChat() {
  const v = useVault()
  const { redactIds } = useRedacted()
  const sessions = v.sessions
  const [railOpen, setRailOpen] = usePersistedState('wf.chat.rail', true)
  const [answerCursor, setAnswerCursor] = useState(0)
  const [streamFor, setStreamFor] = useState<string | null>(null)
  const [liveStages, setLiveStages] = useState<TraceStage[]>([])
  const [liveLockedSrcs, setLiveLockedSrcs] = useState(0)
  const [picked, setPicked] = useState<{ msgId: string; n: number } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [fresh, setFresh] = useState(false)
  const [say, setSay] = useState('')
  const [finding, setFinding] = useState(false)
  const [needle, setNeedle] = useState('')

  const scroller = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const restored = useRef<string | null>(null)

  /** Первый запуск: демо-разговор ложится в рельс как сохранённая сессия. */
  useEffect(() => {
    if (!v.hydrated || v.sessions.length > 0 || v.stats.files === 0) return
    const seed = seedSession(Date.now(), v.stats.files)
    v.addSession(seed)
    v.setActiveSession(seed.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.hydrated])

  const active = useMemo(
    () => sessions.find((s) => s.id === v.activeSessionId) ?? sessions[0] ?? null,
    [sessions, v.activeSessionId],
  )

  const patch = v.patchSession

  /* ---------- поток генерации ---------- */

  const stream = useFakeStream(({ answer, text, stopped, ms, stages }) => {
    const sid = streamFor
    setStreamFor(null)
    if (!sid) return
    const msg: AiMsg = {
      id: uid('a'),
      role: 'ai',
      time: hhmm(),
      text,
      sources: stopped ? [] : answer.sources,
      scanned: answer.scanned,
      picked: answer.picked,
      grounded: stopped ? true : answer.grounded,
      stopped,
      ms,
      stages,
    }
    patch(sid, (s) => ({ ...s, msgs: [...s.msgs, msg] }))
    setSay(stopped ? 'Ответ остановлен.' : `Ответ готов, источников: ${msg.sources.length}.`)
  })

  /**
   * Запуск ответа. Модель считает по тому же сейфу, что показывают остальные
   * экраны: сколько файлов просканировано и на что можно ссылаться —
   * это живое состояние, а не заготовленное число.
   */
  const run = useCallback(
    (sessionId: string, query: string) => {
      const answer = answerFor(query, answerCursor, {
        scanned: v.stats.files,
        has: (fileId) => Boolean(v.fileById(fileId)),
      })
      if (!isBroad(query)) setAnswerCursor((c) => c + 1)
      const stages = buildStages(answer.scanned, answer.picked, answer.sources.length)
      /* п.10.3: цитат из-под ключа модели не видно — вместо них в трассировке
         красакт-строки, и сам факт остаётся в ленте сейфа. */
      const lockedCount = answer.sources.filter((s) => redactIds.has(s.fileId)).length
      setLiveLockedSrcs(lockedCount)
      if (lockedCount > 0) {
        v.notify({
          kind: 'info',
          cat: 'privacy',
          icon: 'lockRound',
          title: 'ИИ не имеет доступа к объектам под файловым ключом',
          body:
            lockedCount === 1
              ? 'Один источник скрыт красактом: цитата не читается, пока файл не открыт ключом.'
              : `${lockedCount} источников скрыты красактом: цитаты не читаются, пока файлы не открыты ключом.`,
        })
      }
      setStreamFor(sessionId)
      setLiveStages(stages)
      setSay('Модель читает архив.')
      stream.start(answer, stages)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- v.notify стабилен, как остальные действия store
    [answerCursor, stream, v, redactIds],
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
        run(s.id, text)
        return
      }
      patch(active.id, (s) => ({
        ...s,
        title: s.msgs.length === 0 ? text.slice(0, 42) : s.title,
        msgs: [...s.msgs, msg],
      }))
      run(active.id, text)
    },
    [active, patch, run, v],
  )

  /** Переспросить: ответ заменяется новым, вопрос остаётся на месте. */
  const regenerate = useCallback(
    (msgId: string) => {
      if (!active || stream.active) return
      const i = active.msgs.findIndex((m) => m.id === msgId)
      if (i < 0) return
      const before = active.msgs.slice(0, i)
      const query = [...before].reverse().find((m) => m.role === 'user')?.text ?? ''
      patch(active.id, (s) => ({ ...s, msgs: s.msgs.slice(0, i) }))
      setPicked(null)
      run(active.id, query)
    },
    [active, patch, run, stream.active],
  )

  /** Правка запроса: добавляем ветку и пересчитываем всё после неё. */
  const editUser = useCallback(
    (msgId: string, text: string) => {
      if (!active || stream.active) return
      patch(active.id, (s) => {
        const i = s.msgs.findIndex((m) => m.id === msgId)
        if (i < 0) return s
        const prev = s.msgs[i] as UserMsg
        const variants = prev.variants?.length ? [...prev.variants] : [prev.text]
        const next: UserMsg = { ...prev, text, variants: [...variants, text] }
        return { ...s, msgs: [...s.msgs.slice(0, i), next] }
      })
      setPicked(null)
      run(active.id, text)
    },
    [active, patch, run, stream.active],
  )

  const togglePin = useCallback(
    (fileId: string) => {
      if (!active) return
      patch(active.id, (s) => ({
        ...s,
        pinned: s.pinned.includes(fileId)
          ? s.pinned.filter((p) => p !== fileId)
          : [...s.pinned, fileId],
      }))
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
  }, [v])

  const renameSession = useCallback(
    (id: string, title: string) => patch(id, (s) => ({ ...s, title })),
    [patch],
  )

  /** Экспорт переписки в Markdown: файл уходит на диск, а не в сеть. */
  const exportMd = useCallback(() => {
    if (!active) return
    const lines = [`# ${active.title}`, '']
    for (const m of active.msgs) {
      if (m.role === 'user') lines.push(`**Вопрос (${m.time}):** ${m.text}`, '')
      else {
        lines.push(`**Ответ (${m.time}):** ${m.text}`, '')
        for (const s of m.sources) {
          const name = v.fileById(s.fileId)?.name ?? s.fileId
          /* п.10.3: экспорт не должен выносить содержимое файла под ключом. */
          lines.push(
            redactIds.has(s.fileId)
              ? `> [${s.n}] ${name} — источник под ключом, цитата скрыта`
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
  }, [active?.msgs.length, stream.text, stream.stagesShown])

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

  /**
   * Ctrl/Cmd+F — поиск внутри разговора. Ctrl+K остаётся за палитрой сейфа,
   * поэтому две похожие вещи больше не спорят за одно сочет��ние. Если в шапке
   * уже набран запрос, он подставляется в поле поиска по переписке.
   */
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

  const live: LiveState | null = stream.active
    ? {
        text: stream.text,
        stages: liveStages,
        shown: stream.stagesShown,
        tracing: stream.phase === 'trace',
        lockedSources: liveLockedSrcs,
      }
    : null

  const liveMsg: AiMsg | null = live
    ? {
        id: 'live',
        role: 'ai',
        time: hhmm(),
        text: stream.text,
        sources: [],
        scanned: v.stats.files,
        picked: 0,
        grounded: true,
        ms: 0,
        stages: [],
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

  const draft = (active && v.drafts[active.id]) ?? ''
  const setDraft = useCallback(
    (next: string) => {
      if (active) v.setDraft(active.id, next)
    },
    [active, v],
  )

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
            onDelete={v.removeSession}
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
              {v.stats.model} · контекст: {v.stats.files} файлов
              {active?.pinned.length ? ` · закреплено ${active.pinned.length}` : ''} · индекс{' '}
              {v.stats.indexedAgo}
            </p>
          </div>
          <span className="grow" />
          {fill >= 80 ? <span className="badge badge-warn chat-fill">контекст {fill}%</span> : null}
          <button
            type="button"
            className={`badge chat-offline ${v.stats.offline ? 'badge-ok' : 'badge-warn'}`}
            onClick={() => v.openSetting('engine')}
            title="Открыть настройки движка"
          >
            {v.stats.offline ? (
              <IconLock aria-hidden="true" />
            ) : (
              <IconShield aria-hidden="true" />
            )}
            {v.stats.offline ? 'офлайн' : 'есть исходящие'}
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
          <div className="chat-thread" aria-busy={stream.active}>
            {msgs.length === 0 && !live ? (
              <div className="chat-empty">
                <span className="chat-empty-mark" aria-hidden="true">
                  <IconSparkText />
                </span>
                <h2 className="chat-empty-title">Спросите свой архив</h2>
                <p className="chat-empty-note">
                  Поиск идёт по смыслу, а не по названию файла. Каждый ответ приходит со ссылкой на
                  страницу источника — ответ без источника помечается отдельно.
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
                  {v.stats.files} файлов проиндексировано · последнее обновление{' '}
                  {v.stats.indexedAgo}
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
                />
              ),
            )}

            {finding && needle.trim() && shown.length === 0 ? (
              <p className="chat-nofind">В этом разговоре нет такого текста.</p>
            ) : null}

            {liveMsg && live ? (
              <MessageAi msg={liveMsg} live={live} activeSource={null} onSource={() => {}} />
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
          onStop={stream.stop}
          busy={stream.active}
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

      {/* Вежливая область: скринридер узнаёт итог, а не каждый выданный токен. */}
      <p className="sr-only" role="status" aria-live="polite">
        {say}
      </p>
    </div>
  )
}
