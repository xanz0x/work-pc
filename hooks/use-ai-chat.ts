'use client'

import { useCallback, useRef, useState } from 'react'
import type { ToolRun, TraceStage } from '@/components/chat/types'

/**
 * Живой разговор с Claude Opus 5 через /ai-api/chat (SSE). Цикл агента:
 * поток текста → вызовы скиллов → выполнение на устройстве → продолжение.
 * Скилл save_password не выполняется без явного разрешения пользователя.
 */

export type ExecResult = {
  ok: boolean
  content: string
  summary: string
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
  error?: string
}

export type TurnBody = {
  sessionId: string
  title?: string
  text?: string
  dropUsers?: number
  regenerate?: boolean
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

export function useAiChat(
  exec: (name: string, args: Record<string, unknown>) => Promise<ExecResult>,
) {
  const [text, setText] = useState('')
  const [stages, setStages] = useState<TraceStage[]>([])
  const [tools, setTools] = useState<ToolRun[]>([])
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState<ToolRun | null>(null)

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
  })

  const pushStage = useCallback((label: string) => {
    const s = st.current
    s.stages = [...s.stages, { label, ms: Math.max(1, Math.round(performance.now() - s.t0)) }]
    setStages(s.stages)
  }, [])

  const syncTools = useCallback(() => setTools([...st.current.tools]), [])

  const loop = useCallback(
    async (body: Record<string, unknown>, signal: AbortSignal): Promise<void> => {
      const res = await fetch('/ai-api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok || !res.body) throw new Error(`сервер ответил ${res.status}`)

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let calls: Call[] = []
      let errMsg: string | null = null
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
          let ev: { t: string; x?: string; calls?: Call[]; message?: string }
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
            errMsg = ev.message ?? 'сбой потока'
          }
        }
      }

      if (errMsg) throw new Error(errMsg)
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
      await loop({ sessionId: body.sessionId, toolResults: results, ctx: body.ctx }, signal)
    },
    [pushStage, syncTools],
  )

  const start = useCallback(
    (body: TurnBody, onDone: (r: TurnResult) => void) => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      st.current = { text: '', tools: [], found: [], findRan: false, stages: [], t0: performance.now(), wrote: false }
      setText('')
      setStages([])
      setTools([])
      setPending(null)
      setActive(true)
      pushStage('запрос к Claude Opus 5')

      const finalize = (error?: string) => {
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
          error,
        })
      }

      loop(body as unknown as Record<string, unknown>, ctrl.signal)
        .then(() => finalize())
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) finalize()
          else finalize(e instanceof Error ? e.message : 'сбой запроса')
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

  return { text, stages, tools, active, pending, start, stop, allow, deny }
}
