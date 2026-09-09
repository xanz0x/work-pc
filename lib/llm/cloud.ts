/* ============================================================
   LLM · АДАПТЕР ОБЛАКА (NF-2)
   Тот же код, что работал в маршруте чата с волны 1, только вынесенный
   за интерфейс провайдера: OpenAI-совместимый SSE, таймаут, два повтора
   на 429/5xx. Поведение не изменилось — изменилось место.
   ============================================================ */

import { LlmFail } from './fail'
import type { LlmCall, LlmDelta, LlmProvider, LlmRequest } from './types'

const UPSTREAM_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2

type SseJson = {
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

/** Аккумулятор фрагментов вызова инструмента: облако отдаёт их по кускам. */
export type CallAcc = { id: string; name: string; args: string }[]

/**
 * Разбор одного SSE-события. Чистая функция: дельты текста наружу,
 * фрагменты инструментов дописываются в аккумулятор.
 */
export function parseCloudEvent(
  payload: string,
  acc: CallAcc,
): { deltas: LlmDelta[]; usage: { prompt: number | null; completion: number | null } | null } {
  const raw = payload.trim()
  if (!raw || raw === '[DONE]') return { deltas: [], usage: null }
  let j: SseJson
  try {
    j = JSON.parse(raw) as SseJson
  } catch {
    return { deltas: [], usage: null }
  }
  const deltas: LlmDelta[] = []
  const usage = j.usage
    ? { prompt: j.usage.prompt_tokens ?? null, completion: j.usage.completion_tokens ?? null }
    : null
  const d = j.choices?.[0]?.delta
  if (d) {
    if (typeof d.content === 'string' && d.content) deltas.push({ k: 'text', text: d.content })
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
  return { deltas, usage }
}

/** Запрос к провайдеру с таймаутом и повтором на 429/5xx (не больше двух). */
async function callUpstream(
  proxy: string,
  key: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let last: LlmFail | null = null
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
      if (signal.aborted) throw new LlmFail('UPSTREAM_ERROR', 'клиент отменил запрос')
      last = new LlmFail('UPSTREAM_ERROR', e instanceof Error ? e.message : 'сетевой сбой')
      continue
    }
    if (res.ok && res.body) return res

    const text = await res.text().catch(() => '')
    if (res.status === 429) last = new LlmFail('UPSTREAM_BUSY', `429 ${text.slice(0, 400)}`)
    else if (res.status >= 500)
      last = new LlmFail('UPSTREAM_ERROR', `${res.status} ${text.slice(0, 400)}`)
    else if (/context|token|too long|maximum/i.test(text))
      throw new LlmFail('CONTEXT_TOO_LONG', `${res.status} ${text.slice(0, 400)}`)
    else throw new LlmFail('UPSTREAM_ERROR', `${res.status} ${text.slice(0, 400)}`)

    if (res.status !== 429 && res.status < 500) break
  }
  throw last ?? new LlmFail('UPSTREAM_ERROR', 'провайдер недоступен')
}

export function cloudProvider(proxy: string, key: string, model: string): LlmProvider {
  return {
    id: 'cloud',
    label: model,
    async *stream(req: LlmRequest): AsyncGenerator<LlmDelta> {
      const res = await callUpstream(
        proxy,
        key,
        {
          model,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: 2048,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          ...(req.tools.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
        },
        req.signal,
      )

      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      const acc: CallAcc = []
      let usage: { prompt: number | null; completion: number | null } | null = null

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const l = line.trim()
          if (!l.startsWith('data:')) continue
          const out = parseCloudEvent(l.slice(5), acc)
          if (out.usage) usage = out.usage
          for (const d of out.deltas) yield d
        }
      }

      const calls: LlmCall[] = acc
        .filter((c) => c && c.name)
        .map((c) => ({ id: c.id, name: c.name, args: c.args || '{}' }))
      if (calls.length > 0) yield { k: 'calls', calls }

      /* Скорость облака не измеряем: у провайдера нет честного времени
         генерации, а стенные часы включают сеть. */
      yield {
        k: 'usage',
        promptTokens: usage?.prompt ?? null,
        completionTokens: usage?.completion ?? null,
        tokensPerSec: null,
      }
    },
  }
}
