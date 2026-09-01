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
import { resolveProvider } from '@/lib/llm'
import { LlmFail } from '@/lib/llm/fail'
import type { LlmCall, LlmTool } from '@/lib/llm/types'
import { isModelId, type ModelId } from '@/lib/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  /** Модель профиля: для локального движка из неё берётся тег Ollama. */
  model?: string
  /** Разрешён ли вынос индекса сейфа наружу. */
  sendIndex?: boolean
  ctx?: Ctx
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
  const model: ModelId = isModelId(body.model) ? body.model : 'qwen-7b'

  /* NF-2: провайдера выбирает настройка движка, и его живость проверяется
     до первого токена. Локальный режим никогда не подменяется облаком:
     если Ollama не запущена или модели нет — честный код и инструкция. */
  const resolved = await resolveProvider(engine, model)
  if (!resolved.ok) {
    const st = resolved.status
    const local = st.provider === 'ollama'
    log(local ? 'warn' : 'error', local ? 'chat.local-off' : 'chat.cloud-off', {
      rid,
      route: '/ai-api/chat',
      status: local ? 409 : 503,
      code: st.code ?? undefined,
    })
    return fail(
      st.code ?? 'ENGINE_NOT_CONFIGURED',
      local
        ? (st.hint ?? 'Локальный движок не подключён.')
        : 'Облачный движок не настроен.',
      local ? 409 : 503,
      local ? { engine: 'local', base: st.base, model: st.model, models: st.models } : undefined,
    )
  }
  const provider = resolved.provider

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

        countTurn()

        /* Поток дельт от провайдера: текст, готовые вызовы скиллов и расход.
           Маршрут не знает, кто отвечает — Ollama на устройстве или облако. */
        let text = ''
        let usage: { prompt: number | null; completion: number | null; tps: number | null } | null =
          null
        let calls: { id: string; name: string; args: Record<string, unknown> }[] = []
        let rawCalls: LlmCall[] = []

        for await (const d of provider.stream({
          system: sys,
          messages: win.msgs,
          tools: tools as LlmTool[],
          signal: req.signal,
        })) {
          if (d.k === 'text') {
            text += d.text
            push({ t: 'd', x: d.text })
          } else if (d.k === 'calls') {
            rawCalls = d.calls
            calls = d.calls.map((c) => {
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(c.args || '{}') as Record<string, unknown>
              } catch {
                /* модель отдала битый JSON — скилл получит пустые аргументы */
              }
              return { id: c.id, name: c.name, args }
            })
          } else {
            usage = {
              prompt: d.promptTokens,
              completion: d.completionTokens,
              tps: d.tokensPerSec,
            }
          }
        }

        /* RM-2: подпись движка и скорость — из настоящего ответа адаптера. */
        push({
          t: 'stats',
          provider: provider.id,
          model: provider.label,
          tps: usage?.tps ?? null,
          promptTokens: usage?.prompt ?? null,
          completionTokens: usage?.completion ?? null,
        })

        const toolCalls: LlmToolCall[] | undefined = rawCalls.length
          ? rawCalls.map((c) => ({
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
        countTokens(usage?.prompt ?? null, usage?.completion ?? null)
        const ms = Date.now() - t0
        countLatency(ms)
        log('info', 'chat.done', {
          rid,
          route: '/ai-api/chat',
          status: 200,
          ms,
          count: calls.length,
          chars: win.used,
          engine: provider.id,
          tokens: (usage?.prompt ?? 0) + (usage?.completion ?? 0) || undefined,
        })
      } catch (e) {
        const f =
          e instanceof LlmFail ? e : new LlmFail('UNKNOWN', e instanceof Error ? e.message : 'сбой потока')
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
