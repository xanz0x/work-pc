'use client'

import { useCallback, useRef, useState } from 'react'
import type { ToolRun, TraceStage } from '@/components/chat/types'
import { isAiErrorCode, type AiErrorCode } from '@/lib/ai-errors'
import { logJournal } from '@/lib/journal'

/**
 * Живой разговор с моделью через /ai-api/chat (SSE) — локальной (Ollama)
 * или облачной: клиент не знает, кто отвечает, это решает сервер. Цикл агента:
 * поток текста → вызовы скиллов → выполнение на устройстве → продолжение.
 * Скилл save_password не выполняется без явного разрешения пользователя.
 * Наружу отдаётся код ошибки из каталога, а не текст провайдера.
 */

export type ExecResult = {
  ok: boolean
  content: string
  summary: string
  /** RM-3: ответ макетный — карточка скилла обязана сказать это вслух. */
  mock?: boolean
  files?: { id: string; name: string; weight: number }[]
}

export type TurnResult = {
  text: string
  tools: ToolRun[]
  found: { id: string; name: string; weight: number }[]
  findRan: boolean
  ms: number
  stages: TraceStage[]
  stopped: boolean
  errorCode?: AiErrorCode
  /** NF-2: кто ответил и с какой скоростью — цифры от самого движка. */
  provider?: 'ollama' | 'cloud'
  engineModel?: string
  tokensPerSec?: number | null
}

export type TurnBody = {
  sessionId: string
  title?: string
  text?: string
  dropUsers?: number
  regenerate?: boolean
  /** Заявленный движок: сервер проверяет его сам и локальный никуда не шлёт. */
  engine: 'local' | 'hybrid' | 'cloud'
  /** Разрешён ли вынос индекса сейфа наружу. */
  sendIndex: boolean
  /** Подпись источника хода — она же попадает в трассировку. */
  modelLabel: string
  /** Модель профиля: для локального движка из неё берётся тег Ollama. */
  model: string
  ctx: {
    files: { id: string; name: string; cat: string; tags: string[] }[]
    pinned: string[]
    lock: string
    scanned: number
  }
}

const LABELS: Record<string, string> = {
  find_file: 'Поиск файла в сейфе',
  save_password: 'Сохранение пароля в сейф',
  notion_pull: 'Документ из Notion · MCP',
}

type Call = { id: string; name: string; args: Record<string, unknown> }

class TurnError extends Error {
  code: AiErrorCode
  constructor(code: AiErrorCode) {
    super(code)
    this.code = code
  }
}

export function useAiChat(
  exec: (name: string, args: Record<string, unknown>) => Promise<ExecResult>,
) {
  const [text, setText] = useState('')
  const [stages, setStages] = useState<TraceStage[]>([])
  const [tools, setTools] = useState<ToolRun[]>([])
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState<ToolRun | null>(null)
  /** Реальное заполнение окна контекста: цифру считает сервер (LG-1). */
  const [usage, setUsage] = useState<{ used: number; limit: number; fill: number } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const decision = useRef<((ok: boolean) => void) | null>(null)
  const execRef = useRef(exec)
  execRef.current = exec

  const st = useRef({
    text: '',
    tools: [] as ToolRun[],
    found: [] as { id: string; name: string; weight: number }[],
    findRan: false,
    stages: [] as TraceStage[],
    t0: 0,
    wrote: false,
    provider: undefined as 'ollama' | 'cloud' | undefined,
    engineModel: undefined as string | undefined,
    tokensPerSec: null as number | null,
  })

  const pushStage = useCallback((label: string) => {
    const s = st.current
    s.stages = [...s.stages, { label, ms: Math.max(1, Math.round(performance.now() - s.t0)) }]
    setStages(s.stages)
  }, [])

  const syncTools = useCallback(() => setTools([...st.current.tools]), [])

  const loop = useCallback(
    async (body: Record<string, unknown>, signal: AbortSignal): Promise<void> => {
      let res: Response
      try {
        res = await fetch('/ai-api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
      } catch (e) {
        if (signal.aborted) return
        throw new TurnError('NETWORK')
      }
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { code?: string } | null
        if (isAiErrorCode(j?.code)) throw new TurnError(j.code)
        throw new TurnError(res.status === 401 ? 'AUTH_REQUIRED' : 'UNKNOWN')
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let calls: Call[] = []
      let errCode: AiErrorCode | null = null
      const s = st.current

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const chunks = buf.split('\n\n')
        buf = chunks.pop() ?? ''
        for (const ch of chunks) {
          const line = ch.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          let ev: {
            t: string
            x?: string
            calls?: Call[]
            code?: string
            used?: number
            limit?: number
            fill?: number
            provider?: string
            model?: string
            tps?: number | null
          }
          try {
            ev = JSON.parse(line.slice(5))
          } catch {
            continue
          }
          if (ev.t === 'd' && typeof ev.x === 'string') {
            if (!s.wrote) {
              s.wrote = true
              pushStage('модель пишет')
            }
            s.text += ev.x
            setText(s.text)
          } else if (ev.t === 'tool' && Array.isArray(ev.calls)) {
            calls = ev.calls
          } else if (ev.t === 'err') {
            errCode = isAiErrorCode(ev.code) ? ev.code : 'UNKNOWN'
          } else if (ev.t === 'ctx' && typeof ev.fill === 'number') {
            setUsage({ used: ev.used ?? 0, limit: ev.limit ?? 0, fill: ev.fill })
          } else if (ev.t === 'stats') {
            /* NF-2: подпись движка и скорость приходят из ответа адаптера. */
            if (ev.provider === 'ollama' || ev.provider === 'cloud') s.provider = ev.provider
            if (typeof ev.model === 'string') s.engineModel = ev.model
            s.tokensPerSec = typeof ev.tps === 'number' ? ev.tps : null
          }
        }
      }

      if (errCode) throw new TurnError(errCode)
      if (!calls.length || signal.aborted) return

      const results: { id: string; name: string; content: string }[] = []
      for (const c of calls) {
        const run: ToolRun = {
          id: c.id,
          name: c.name,
          label: LABELS[c.name] ?? c.name,
          args: c.args,
          status: c.name === 'save_password' ? 'wait' : 'run',
        }
        s.tools = [...s.tools, run]
        syncTools()
        pushStage(`скилл · ${run.label}`)

        if (c.name === 'save_password') {
          setPending(run)
          const ok = await new Promise<boolean>((resolve) => {
            decision.current = resolve
          })
          decision.current = null
          setPending(null)
          if (signal.aborted) return
          if (!ok) {
            run.status = 'deny'
            run.summary = 'Отклонено пользователем'
            run.args = { ...run.args, password: '•••' }
            syncTools()
            results.push({
              id: c.id,
              name: c.name,
              content: JSON.stringify({ ok: false, error: 'Пользователь отклонил сохранение пароля.' }),
            })
            continue
          }
          run.status = 'run'
          syncTools()
        }

        let r: ExecResult
        try {
          r = await execRef.current(c.name, c.args)
        } catch (e) {
          r = {
            ok: false,
            content: JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'сбой скилла' }),
            summary: 'сбой скилла',
          }
        }
        run.status = r.ok ? 'ok' : 'err'
        run.summary = r.summary
        run.mock = r.mock === true
        if (c.name === 'save_password') run.args = { ...run.args, password: '•••' }
        if (r.files?.length) {
          run.files = r.files.map((f) => ({ id: f.id, name: f.name }))
          const seen = new Set(s.found.map((f) => f.id))
          s.found = [...s.found, ...r.files.filter((f) => !seen.has(f.id))]
        }
        if (c.name === 'find_file') s.findRan = true
        syncTools()
        results.push({ id: c.id, name: c.name, content: r.content })
      }

      if (signal.aborted) return
      await loop(
        {
          sessionId: body.sessionId,
          toolResults: results,
          ctx: body.ctx,
          engine: body.engine,
          model: body.model,
          sendIndex: body.sendIndex,
        },
        signal,
      )
    },
    [pushStage, syncTools],
  )

  const start = useCallback(
    (body: TurnBody, onDone: (r: TurnResult) => void) => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      st.current = {
        text: '',
        tools: [],
        found: [],
        findRan: false,
        stages: [],
        t0: performance.now(),
        wrote: false,
        provider: undefined,
        engineModel: undefined,
        tokensPerSec: null,
      }
      setText('')
      setStages([])
      setTools([])
      setPending(null)
      setActive(true)
      pushStage(`запрос · ${body.modelLabel}`)

      /* LG-3: каждый ход, уходящий наружу, попадает в журнал безопасности.
         Локальный движок не логируется — из устройства ничего не выходит. */
      if (body.engine !== 'local') {
        void logJournal(
          'cloud-request',
          'Исходящий запрос к внешней модели',
          `Режим «${body.engine === 'cloud' ? 'внешняя модель' : 'гибридный'}», модель ${body.modelLabel}. Индекс сейфа ${body.sendIndex ? `передан (${body.ctx.files.length} файлов в контексте)` : 'не передавался'}.`,
        )
      }

      const finalize = (errorCode?: AiErrorCode) => {
        const s = st.current
        abortRef.current = null
        setActive(false)
        setPending(null)
        onDone({
          text: s.text,
          tools: s.tools,
          found: s.found,
          findRan: s.findRan,
          ms: Math.max(1, Math.round(performance.now() - s.t0)),
          stages: s.stages,
          stopped: ctrl.signal.aborted,
          errorCode,
          provider: s.provider,
          engineModel: s.engineModel,
          tokensPerSec: s.tokensPerSec,
        })
      }

      loop(body as unknown as Record<string, unknown>, ctrl.signal)
        .then(() => finalize())
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) finalize()
          else finalize(e instanceof TurnError ? e.code : 'UNKNOWN')
        })
    },
    [loop, pushStage],
  )

  const stop = useCallback(() => {
    decision.current?.(false)
    abortRef.current?.abort()
  }, [])

  const allow = useCallback(() => decision.current?.(true), [])
  const deny = useCallback(() => decision.current?.(false), [])

  return { text, stages, tools, active, pending, usage, start, stop, allow, deny }
}
