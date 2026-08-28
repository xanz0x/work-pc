import type { NextRequest } from 'next/server'
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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = 'claude-opus-5'

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
  ctx?: Ctx
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

async function buildSystem(ctx: Ctx | undefined): Promise<{ system: string; tools: unknown[] }> {
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

  if (ctx?.files?.length) {
    const rows = ctx.files
      .slice(0, 300)
      .map((f) => `${f.id} | ${f.name} | ${f.cat} | ${f.tags.join(', ')}`)
      .join('\n')
    sys += `\nИндекс файлов сейфа (id | имя | категория | теги):\n${rows}\n`
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
  const body = (await req.json()) as Body
  const id = safeId(body.sessionId)

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

  if (body.text) s.llm.push({ role: 'user', content: body.text.slice(0, 4000) })
  if (body.toolResults?.length) {
    for (const r of body.toolResults) {
      s.llm.push({ role: 'tool', tool_call_id: r.id, content: r.content.slice(0, 8000) })
    }
  }

  const { system, tools } = await buildSystem(body.ctx)
  const proxy = process.env.AI_PROXY_URL
  const key = process.env.EMERGENT_LLM_KEY
  const session = s

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
      try {
        if (!proxy || !key) throw new Error('AI_PROXY_URL / EMERGENT_LLM_KEY не заданы в .env')
        const upstream = await fetch(`${proxy}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            stream: true,
            max_tokens: 2048,
            messages: [{ role: 'system', content: system }, ...session.llm],
            ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          }),
          signal: req.signal,
        })
        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => '')
          throw new Error(`модель ответила ${upstream.status}: ${errText.slice(0, 200)}`)
        }

        const reader = upstream.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let text = ''
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
      } catch (e) {
        try {
          push({ t: 'err', message: e instanceof Error ? e.message : 'сбой потока' })
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
    },
  })
}
