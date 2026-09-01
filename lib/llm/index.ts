/* ============================================================
   LLM · ВЫБОР ПРОВАЙДЕРА (NF-2)
   Настройка движка выбирает провайдера по-настоящему: «Локальный» идёт
   в Ollama на устройстве, «Гибридный» и «Внешняя модель» — в облачный
   прокси. Никаких тихих подмен: если локальный движок не готов, маршрут
   отвечает честной ошибкой, а не уходит в облако.
   ============================================================ */

import type { EngineId, ModelId } from '@/lib/data'
import { cloudProvider } from './cloud'
import { ollamaProvider, probeOllama } from './ollama'
import { ollamaTag } from './models'
import type { LlmProvider, ProviderStatus } from './types'

export const CLOUD_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-5-20250929'

export type Resolved =
  | { ok: true; provider: LlmProvider; status: ProviderStatus }
  | { ok: false; status: ProviderStatus }

/** Состояние локального движка для настроек и чата. */
export async function localStatus(model: ModelId): Promise<ProviderStatus> {
  return probeOllama(ollamaTag(model))
}

export function cloudStatus(): ProviderStatus {
  const proxy = process.env.AI_PROXY_URL
  const key = process.env.EMERGENT_LLM_KEY
  const ok = Boolean(proxy && key)
  return {
    ok,
    provider: 'cloud',
    base: null,
    model: ok ? CLOUD_MODEL : null,
    models: [],
    code: ok ? null : 'CLOUD_NOT_CONFIGURED',
    hint: ok ? null : 'Доступ к внешней модели не настроен на сервере.',
  }
}

/** Кто будет отвечать на этот ход. Проверка живости — до первого токена. */
export async function resolveProvider(engine: EngineId, model: ModelId): Promise<Resolved> {
  if (engine === 'local') {
    const status = await localStatus(model)
    if (!status.ok) return { ok: false, status }
    return { ok: true, provider: ollamaProvider(status.model!), status }
  }
  const status = cloudStatus()
  if (!status.ok) return { ok: false, status }
  return {
    ok: true,
    provider: cloudProvider(process.env.AI_PROXY_URL!, process.env.EMERGENT_LLM_KEY!, CLOUD_MODEL),
    status,
  }
}
