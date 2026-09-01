import { NextResponse, type NextRequest } from 'next/server'
import { isModelId, type ModelId } from '@/lib/data'
import { cloudStatus, localStatus } from '@/lib/llm'
import { pullCommand } from '@/lib/llm/models'
import { log } from '@/lib/log'
import { requestId } from '@/lib/ai-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * NF-2 · состояние движков. Настройки и чат спрашивают этот маршрут, чтобы
 * писать правду: запущен ли Ollama, стоит ли выбранная модель, настроено ли
 * облако. Проверка идёт с сервера — браузер не стучится в localhost сам и не
 * знает адрес движка.
 *
 * GET /ai-api/engine?model=qwen-7b
 */
export async function GET(req: NextRequest) {
  const rid = req.headers.get('x-request-id') ?? requestId()
  const raw = req.nextUrl.searchParams.get('model')
  const model: ModelId = isModelId(raw) ? raw : 'qwen-7b'

  const local = await localStatus(model)
  const cloud = cloudStatus()

  log('info', 'engine.probe', {
    rid,
    route: '/ai-api/engine',
    status: 200,
    engine: local.ok ? 'ollama' : 'off',
    code: local.code ?? undefined,
  })

  return NextResponse.json({
    local: {
      ok: local.ok,
      base: local.base,
      model: local.model,
      models: local.models,
      code: local.code,
      hint: local.hint,
      /** Готовая команда для терминала, если модели нет. */
      pull: local.model ? pullCommand(local.model) : null,
    },
    cloud: { ok: cloud.ok, model: cloud.model },
  })
}
