/* ============================================================
   LLM · ВЫБОР ПРОВАЙДЕРА
   Локального движка в продукте больше нет. Отвечает та модель,
   которую владелец подключил в «Настройки → Подключение модели»:
   свой OpenAI-совместимый сервер или OpenRouter. Оба говорят на
   одном протоколе, поэтому адаптер один (./cloud).
   ============================================================ */

import { providerReady, readProvider, type AiProviderConfig } from '@/lib/ai-provider'
import { cloudProvider } from './cloud'
import type { LlmProvider, ProviderStatus } from './types'

export type Resolved =
  | { ok: true; provider: LlmProvider; status: ProviderStatus }
  | { ok: false; status: ProviderStatus }

const KIND_LABEL: Record<AiProviderConfig['kind'], string> = {
  custom: 'свой сервер',
  openrouter: 'OpenRouter',
}

export function statusOf(c: AiProviderConfig): ProviderStatus {
  const ok = providerReady(c)
  return {
    ok,
    kind: c.kind,
    kindLabel: KIND_LABEL[c.kind],
    base: c.baseUrl || null,
    model: ok ? c.model : null,
    visionModel: c.visionModel || c.model || null,
    code: ok ? null : 'CLOUD_NOT_CONFIGURED',
    hint: ok
      ? null
      : c.kind === 'openrouter'
        ? 'Добавьте ключ OpenRouter и выберите модель в «Настройки → Подключение модели».'
        : 'Укажите адрес сервера, токен и имя модели в «Настройки → Подключение модели».',
  }
}

/** Состояние подключения модели для настроек и чата. */
export async function providerStatus(): Promise<ProviderStatus> {
  return statusOf(await readProvider())
}

/** Кто будет отвечать на этот ход. Проверка конфигурации — до первого токена. */
export async function resolveProvider(): Promise<Resolved> {
  const c = await readProvider()
  const status = statusOf(c)
  if (!status.ok) return { ok: false, status }
  return {
    ok: true,
    provider: cloudProvider(c.baseUrl, c.apiKey, c.model, c.kind),
    status,
  }
}
