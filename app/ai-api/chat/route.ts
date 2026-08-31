import { NextResponse, type NextRequest } from 'next/server'
import {
  getSession,
  saveSession,
  listSkills,
  getMcp,
  getSystemPrompt,
  safeId,
  type LlmMsg,
  type LlmToolCall,
  type SessionFile,
} from '@/lib/ai-server'
import { requestId, type AiErrorCode } from '@/lib/ai-errors'
import { log } from '@/lib/log'
import { countLatency, countTokens, countTurn, trackError } from '@/lib/metrics'
import {
  MAX_TOOL_CHARS,
  MAX_USER_CHARS,
  fillPercent,
  trimLlm,
} from '@/lib/context-window'
import { clientIp, limitChat } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-5-20250929'

const UPSTREAM_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2

/** Схемы встроенных инструментов (OpenAI function calling, кросс-провайдерно). */
const TOOL_SCHEMAS: Record<string, { description: string; parameters: unknown }> = {
  find_file: {
    description:
      'Найти файлы в локальном сейфе пользователя по смыслу запроса. Выполняется на устройстве, возвращает метаданные найденных файлов.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'ключевые слова запроса' },
      },
      required: ['query'],
    },
  },
  save_password: {
    description:
      'Сохранить новый логин/пароль в зашифрованный сейф пользователя. Требует явного подтверждения пользователя в интерфейсе.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'название записи, напр. «GitHub»' },
        login: { type: 'string' },
        password: { type: 'string' },
        url: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['title', 'password'],
    },
  },
  notion_pull: {
    description:
      'Вытянуть документ из Notion через MCP-сервер. Возвращает заголовок, ссылку и фрагмент документа.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'что искать в Notion' },
      },
      required: ['query'],
    },
  },
}

type Ctx = {
  files?: { id: string; name: string; cat: string; tags: string[] }[]
  pinned?: string[]
  lock?: string
  scanned?: number
}

type Body = {
  sessionId: string
  title?: string
  text?: string
  toolResults?: { id: string; name: string; content: string }[]
  dropUsers?: number
  regenerate?: boolean
  /** Заявленный клиентом движок — сервер проверяет его сам. */
  engine?: string
  /** Разрешён ли вынос индекса сейфа наружу. */
  sendIndex?: boolean
  ctx?: Ctx
}

/** Ошибка с кодом каталога: наружу уходит код, детали — в лог сервера. */
class AiFail extends Error {
  code: AiErrorCode
  detail: string
  constructor(code: AiErrorCode, detail: string) {
    super(code)
    this.code = code
    this.detail = detail
  }
}

function fail(code: AiErrorCode, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, error: message, ...extra }, { status })
}

/** Пароль не должен лечь на диск в истории: в сохранённых аргументах — маска. */
function redactArgs(name: string, raw: string): string {
  if (name !== 'save_password') return raw
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (typeof o.password === 'string') o.password = '•••'
    return JSON.stringify(o)
  } catch {
    return raw
  }
}

async function buildSystem(
  ctx: Ctx | undefined,
  sendIndex: boolean,
): Promise<{ system: string; tools: unknown[] }> {
  const skills = await listSkills()
  const enabled = skills.filter((s) => s.enabled)
  const notion = await getMcp('notion')

  let sys = await getSystemPrompt()

  const withNotes = enabled.filter((s) => s.instructions.trim())
  if (withNotes.length) {
    sys += '\n\n## Скиллы и инструкции\n'
    sys += withNotes.map((s) => `### ${s.name}\n${s.instructions.trim()}`).join('\n\n')
  }

  sys += `\n\n## Контекст\nСейчас: ${new Date().toLocaleString('ru-RU')}\n`
  sys += `Файлов в сейфе: ${ctx?.scanned ?? ctx?.files?.length ?? 0}\n`
  sys += `Замок секретницы: ${ctx?.lock ?? 'неизвестно'}\n`
  sys += `MCP Notion: ${
    notion?.enabled
      ? `включён (${notion.host ? `${notion.host}:${notion.port}` : 'адрес не задан'}, режим скелета)`
      : 'выключен'
  }\n`

  if (sendIndex && ctx?.files?.length) {
    const rows = ctx.files
      .slice(0, 300)
      .map((f) => `${f.id} | ${f.name} | ${f.cat} | ${f.tags.join(', ')}`)
      .join('\n')
    sys += `\nИндекс файлов сейфа (id | имя | категория | теги):\n${rows}\n`
  } else {
    sys += '\nИндекс сейфа не передан: пользователь запретил вынос имён файлов наружу.\n'
  }
  if (ctx?.pinned?.length) {
    sys += `\nЗакреплённые пользователем файлы (важнее остальных): ${ctx.pinned.join(', ')}\n`
  }

  const tools = enabled
    .filter((s) => s.kind === 'tool' && s.tool && TOOL_SCHEMAS[s.tool])
    .map((s) => ({
      type: 'function',
      function: { name: s.tool as string, ...TOOL_SCHEMAS[s.tool as string] },
    }))

  return { system: sys, tools }
}

/** Запрос к провайдеру с таймаутом и повтором на 429/5xx (не больше двух). */
async function callUpstream(
  proxy: string,
  key: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let last: AiFail | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)))
    let res: Response
    try {
      res = await fetch(`${proxy}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      })
    } catch (e) {
      if (signal.aborted) throw new AiFail('UPSTREAM_ERROR', 'клиент отменил запрос')
      last = new AiFail('UPSTREAM_ERROR', e instanceof Error ? e.message : 'сетевой сбой')
      continue
    }
    if (res.ok && res.body) return res

    const text = await res.text().catch(() => '')
    if (res.status === 429) last = new AiFail('UPSTREAM_BUSY', `429 ${text.slice(0, 400)}`)
    else if (res.status >= 500) last = new AiFail('UPSTREAM_ERROR', `${res.status} ${text.slice(0, 400)}`)
    else if (/context|token|too long|maximum/i.test(text))
      throw new AiFail('CONTEXT_TOO_LONG', `${res.status} ${text.slice(0, 400)}`)
    else throw new AiFail('UPSTREAM_ERROR', `${res.status} ${text.slice(0, 400)}`)

    if (res.status !== 429 && res.status < 500) break
  }
  throw last ?? new AiFail('UPSTREAM_ERROR', 'провайдер недоступен')
}

export async function POST(req: NextRequest) {
  /* request-id рождается в proxy.ts и связывает лог, метрики и ответ (AR-5). */
  const rid = req.headers.get('x-request-id') ?? requestId()
  const t0 = Date.now()
  const ip = clientIp(req.headers)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    log('warn', 'chat.bad-json', { rid, route: '/ai-api/chat', status: 400 })
    return fail('BAD_REQUEST', 'Тело запроса не является корректным JSON.', 400, { requestId: rid })
  }

  /* §3.4: бюджет не тратится на тела, отвергнутые разбором — проверки
     валидации больше не ловят 429 вместо 400. Всё, что разобралось,
     считается ходом, включая отказ гейта движка. */
  const limit = limitChat(ip)
  if (!limit.ok) {
    log('warn', 'chat.limited', { rid, route: '/ai-api/chat', status: 429, code: limit.scope })
    const resp = fail(
      'RATE_LIMITED',
      limit.scope === 'minute'
        ? 'Слишком много запросов за минуту. Подождите и повторите.'
        : 'Исчерпан суточный бюджет запросов к модели.',
      429,
      { retryAfter: limit.retryAfter },
    )
    resp.headers.set('Retry-After', String(Math.max(1, Math.ceil(limit.retryAfter))))
    return resp
  }

  /* Форма тела проверяется после гейтов движка: локальный движок отвечает
     409 независимо от полей (инвариант волны 1). */
  const engine = body.engine === 'hybrid' || body.engine === 'cloud' ? body.engine : 'local'

  /* Заявленный локальный режим проверяется здесь: ни одного внешнего запроса. */
  if (engine === 'local') {
    return fail('ENGINE_NOT_CONFIGURED', 'Локальный движок не подключён.', 409)
  }

  const proxy = process.env.AI_PROXY_URL
  const key = process.env.EMERGENT_LLM_KEY
  if (!proxy || !key) {
    log('error', 'chat.cloud-off', { rid, route: '/ai-api/chat', status: 503 })
    return fail('CLOUD_NOT_CONFIGURED', 'Облачный движок не настроен.', 503)
  }

  if (typeof body.sessionId !== 'string' || !body.sessionId) {
    log('warn', 'chat.bad-body', { rid, route: '/ai-api/chat', status: 400 })
    return fail('BAD_REQUEST', 'Не указан идентификатор диалога.', 400, { requestId: rid })
  }

  let id: string
  try {
    id = safeId(body.sessionId)
  } catch {
    log('warn', 'chat.bad-session-id', { rid, route: '/ai-api/chat', status: 400 })
    return fail('BAD_REQUEST', 'Недопустимый идентификатор диалога.', 400, { requestId: rid })
  }
  let s: SessionFile | null = await getSession(id)
  if (!s) {
    s = {
      id,
      title: (body.title ?? body.text ?? 'Новый диалог').slice(0, 60),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: [],
      msgs: [],
      llm: [],
    }
  }

  if (body.dropUsers && body.dropUsers > 0) {
    let left = body.dropUsers
    while (s.llm.length && left > 0) {
      const last = s.llm.pop()
      if (last?.role === 'user') left -= 1
    }
  }
  if (body.regenerate) {
    while (s.llm.length && s.llm[s.llm.length - 1].role !== 'user') s.llm.pop()
  }

  if (body.text) s.llm.push({ role: 'user', content: body.text.slice(0, MAX_USER_CHARS) })
  if (body.toolResults?.length) {
    for (const r of body.toolResults) {
      s.llm.push({ role: 'tool', tool_call_id: r.id, content: r.content.slice(0, MAX_TOOL_CHARS) })
    }
  }

  const sendIndex = body.sendIndex !== false
  const { system, tools } = await buildSystem(body.ctx, sendIndex)
  const session = s

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
      try {
        /* LG-1: наружу уходят последние ходы, вытесненное — одним резюме.
           История на диске остаётся полной: это данные пользователя. */
        const win = trimLlm(session.llm)
        const sys = win.summary ? `${system}\n\n## Ранее в диалоге\n${win.summary}` : system
        push({
          t: 'ctx',
          used: win.used,
          limit: win.limit,
          fill: fillPercent(win.used, win.limit),
          dropped: win.dropped,
        })

        const upstream = await callUpstream(
          proxy,
          key,
          {
            model: MODEL,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: 2048,
            messages: [{ role: 'system', content: sys }, ...win.msgs],
            ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          },
          req.signal,
        )
        countTurn()

        const reader = upstream.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let text = ''
        /* Токены пишем только если провайдер их прислал: выдуманных цифр нет. */
        let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null
        const acc: { id: string; name: string; args: string }[] = []

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            const l = line.trim()
            if (!l.startsWith('data:')) continue
            const payload = l.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            let j: {
              usage?: { prompt_tokens?: number; completion_tokens?: number }
              choices?: {
                delta?: {
                  content?: string
                  tool_calls?: {
                    index?: number
                    id?: string
                    function?: { name?: string; arguments?: string }
                  }[]
                }
              }[]
            }
            try {
              j = JSON.parse(payload)
            } catch {
              continue
            }
            if (j.usage) usage = j.usage
            const d = j.choices?.[0]?.delta
            if (!d) continue
            if (typeof d.content === 'string' && d.content) {
              text += d.content
              push({ t: 'd', x: d.content })
            }
            if (Array.isArray(d.tool_calls)) {
              for (const tc of d.tool_calls) {
                const i = tc.index ?? 0
                if (!acc[i]) acc[i] = { id: tc.id ?? `call_${i}`, name: '', args: '' }
                if (tc.id) acc[i].id = tc.id
                if (tc.function?.name) acc[i].name = tc.function.name
                if (tc.function?.arguments) acc[i].args += tc.function.arguments
              }
            }
          }
        }

        const calls = acc
          .filter((c) => c && c.name)
          .map((c) => {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(c.args || '{}') as Record<string, unknown>
            } catch {
              /* модель отдала битый JSON — скилл получит пустые аргументы */
            }
            return { id: c.id, name: c.name, args }
          })

        const toolCalls: LlmToolCall[] | undefined = calls.length
          ? acc
              .filter((c) => c && c.name)
              .map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: redactArgs(c.name, c.args || '{}') },
              }))
          : undefined

        const assistant: LlmMsg = { role: 'assistant', content: text || null }
        if (toolCalls) assistant.tool_calls = toolCalls
        session.llm.push(assistant)
        session.updatedAt = Date.now()
        await saveSession(session)

        if (calls.length) push({ t: 'tool', calls })
        push({ t: 'end' })
        countTokens(usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null)
        const ms = Date.now() - t0
        countLatency(ms)
        log('info', 'chat.done', {
          rid,
          route: '/ai-api/chat',
          status: 200,
          ms,
          count: calls.length,
          chars: win.used,
          tokens: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0) || undefined,
        })
      } catch (e) {
        const f =
          e instanceof AiFail ? e : new AiFail('UNKNOWN', e instanceof Error ? e.message : 'сбой потока')
        countLatency(Date.now() - t0)
        trackError({ rid, where: '/ai-api/chat', code: f.code, reason: f.detail })
        try {
          push({ t: 'err', code: f.code, requestId: rid })
        } catch {
          /* поток уже закрыт клиентом */
        }
      } finally {
        try {
          controller.close()
        } catch {
          /* уже закрыт */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': rid,
    },
  })
}
