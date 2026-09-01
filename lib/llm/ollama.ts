/* ============================================================
   LLM · АДАПТЕР OLLAMA (NF-2)
   Локальный движок: ни одного внешнего запроса. Разговор идёт на
   http://localhost:11434 (адрес переопределяется OLLAMA_URL), поток
   приходит построчным NDJSON, а не SSE.

   Ollama сам считает расход и время: скорость берём из `eval_count` и
   `eval_duration` (наносекунды) — по стенным часам её никто не выдумывает.
   ============================================================ */

import type {
  LlmCall,
  LlmDelta,
  LlmProvider,
  LlmRequest,
  ProviderStatus,
} from './types'
import { LlmFail } from './fail'
import { hasModel, pullCommand } from './models'

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

const PROBE_TIMEOUT_MS = 2500
const CHAT_TIMEOUT_MS = 180_000

type OllamaChunk = {
  message?: {
    content?: string
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[]
  }
  done?: boolean
  error?: string
  prompt_eval_count?: number
  eval_count?: number
  /** Наносекунды. */
  eval_duration?: number
}

/** Скорость генерации из ответа движка. null — движок не прислал время. */
export function tokensPerSec(evalCount?: number, evalDurationNs?: number): number | null {
  if (!evalCount || !evalDurationNs || evalDurationNs <= 0) return null
  return Math.round((evalCount / (evalDurationNs / 1e9)) * 10) / 10
}

/**
 * Разбор одной строки NDJSON в дельты. Чистая функция — на ней держатся
 * юнит-тесты: парсер обязан пережить и пустые строки, и битый JSON.
 */
export function parseOllamaLine(line: string): LlmDelta[] {
  const raw = line.trim()
  if (!raw) return []
  let j: OllamaChunk
  try {
    j = JSON.parse(raw) as OllamaChunk
  } catch {
    return []
  }
  const out: LlmDelta[] = []
  if (typeof j.message?.content === 'string' && j.message.content) {
    out.push({ k: 'text', text: j.message.content })
  }
  const calls = j.message?.tool_calls
  if (Array.isArray(calls) && calls.length > 0) {
    const ready: LlmCall[] = []
    for (const [i, c] of calls.entries()) {
      const name = c.function?.name
      if (!name) continue
      const args = c.function?.arguments
      ready.push({
        id: `call_${i}_${name}`,
        name,
        args: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      })
    }
    if (ready.length > 0) out.push({ k: 'calls', calls: ready })
  }
  if (j.done) {
    out.push({
      k: 'usage',
      promptTokens: j.prompt_eval_count ?? null,
      completionTokens: j.eval_count ?? null,
      tokensPerSec: tokensPerSec(j.eval_count, j.eval_duration),
    })
  }
  return out
}

/**
 * Живой ли движок и стоит ли на нём нужная модель. Отвечает быстро:
 * настройки и чат спрашивают это на каждом открытии.
 */
export async function probeOllama(model: string): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    ok: false,
    provider: 'ollama',
    base: OLLAMA_URL,
    model,
    models: [],
    code: null,
    hint: null,
  }
  let installed: string[] = []
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`tags ${r.status}`)
    const j = (await r.json()) as { models?: { name?: string }[] }
    installed = (j.models ?? []).map((m) => m.name ?? '').filter(Boolean)
  } catch {
    return {
      ...base,
      code: 'ENGINE_NOT_RUNNING',
      hint: `Движок не отвечает на ${OLLAMA_URL}. Установите Ollama и запустите «ollama serve», затем «${pullCommand(model)}».`,
    }
  }
  if (!hasModel(installed, model)) {
    return {
      ...base,
      models: installed,
      code: 'MODEL_NOT_PULLED',
      hint: `Движок запущен, но модели «${model}» на устройстве нет. Выполните «${pullCommand(model)}».`,
    }
  }
  return { ...base, ok: true, models: installed }
}

/** Провайдер локального движка. Модель — тег Ollama, уже проверенный probe. */
export function ollamaProvider(model: string): LlmProvider {
  return {
    id: 'ollama',
    label: model,
    async *stream(req: LlmRequest): AsyncGenerator<LlmDelta> {
      let res: Response
      try {
        res = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            model,
            stream: true,
            keep_alive: '5m',
            options: { temperature: 0.2 },
            messages: [{ role: 'system', content: req.system }, ...req.messages],
            ...(req.tools.length ? { tools: req.tools } : {}),
          }),
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(CHAT_TIMEOUT_MS)]),
        })
      } catch (e) {
        throw new LlmFail(
          'ENGINE_NOT_RUNNING',
          e instanceof Error ? e.message : 'движок недоступен',
        )
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        if (res.status === 404) {
          throw new LlmFail('MODEL_NOT_PULLED', `404 ${text.slice(0, 200)}`)
        }
        throw new LlmFail('UPSTREAM_ERROR', `${res.status} ${text.slice(0, 200)}`)
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          for (const d of parseOllamaLine(line)) yield d
        }
      }
      for (const d of parseOllamaLine(buf)) yield d
    },
  }
}
