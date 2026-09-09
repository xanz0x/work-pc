/* ============================================================
   LLM · КОНТРАКТ ПРОВАЙДЕРА
   Один интерфейс для всех OpenAI-совместимых источников: свой
   сервер и OpenRouter. Маршрут чата не знает, кто отвечает: он
   получает поток дельт и раздаёт их клиенту как SSE.
   ============================================================ */

import type { AiErrorCode } from '@/lib/ai-errors'

/** Сообщение в формате OpenAI-совместимой истории — так уже лежит на диске. */
export type LlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

/** Схема инструмента (function calling) — одинаковая у всех провайдеров. */
export type LlmTool = {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

/** Готовый вызов инструмента: аргументы уже собраны целиком. */
export type LlmCall = { id: string; name: string; args: string }

export type LlmDelta =
  /** Кусок текста ответа. */
  | { k: 'text'; text: string }
  /** Модель попросила инструменты — приходит один раз, в конце хода. */
  | { k: 'calls'; calls: LlmCall[] }
  /**
   * Расход и скорость. Ноль выдуманных цифр: поле остаётся null, если
   * провайдер его не прислал.
   */
  | {
      k: 'usage'
      promptTokens: number | null
      completionTokens: number | null
      tokensPerSec: number | null
    }

export type LlmRequest = {
  system: string
  messages: LlmMessage[]
  tools: LlmTool[]
  signal: AbortSignal
}

/** Почему провайдер не может ответить — с инструкцией, что сделать человеку. */
export type ProviderStatus = {
  ok: boolean
  /** Способ подключения: свой сервер или OpenRouter. */
  kind: 'custom' | 'openrouter'
  kindLabel: string
  /** База API — показывается в настройках. */
  base: string | null
  /** Имя модели, которое реально пойдёт в запрос. */
  model: string | null
  /** Модель для картинок (может совпадать с основной). */
  visionModel: string | null
  code: AiErrorCode | null
  /** Человеческая инструкция: что именно сделать. */
  hint: string | null
}

export type LlmProvider = {
  id: 'custom' | 'openrouter'
  /** Подпись модели для интерфейса. */
  label: string
  stream: (req: LlmRequest) => AsyncGenerator<LlmDelta>
}
