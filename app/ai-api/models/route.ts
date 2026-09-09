import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_MODEL, isModelId, type ModelId } from '@/lib/data'
import { localStatus } from '@/lib/llm'
import { log } from '@/lib/log'
import { requestId } from '@/lib/ai-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * NF-9 · список моделей для настроек. Честный источник один: теги из
 * `GET <OLLAMA_URL>/api/tags` — то, что реально установлено в Ollama на
 * устройстве. Проверка идёт с сервера (браузер не стучится в localhost сам),
 * как и у /ai-api/engine. Захардкоженный список MODELS здесь не участвует.
 *
 * GET /ai-api/models?model=qwen-7b
 *  → { ok, base, models: string[], active: string | null, code, hint }
 *    models — установленные теги; active — тег выбранной модели, если она
 *    стоит; пустой движок или ошибка → models: [].
 */
export async function GET(req: NextRequest) {
  const rid = req.headers.get('x-request-id') ?? requestId()
  const raw = req.nextUrl.searchParams.get('model')
  const model: ModelId = isModelId(raw) ? raw : DEFAULT_MODEL

  const local = await localStatus(model)

  log('info', 'engine.models', {
    rid,
    route: '/ai-api/models',
    status: 200,
    engine: local.ok ? 'ollama' : 'off',
    code: local.code ?? undefined,
    count: local.models.length,
  })

  return NextResponse.json({
    ok: local.ok,
    base: local.base,
    /** Только реально установленные теги Ollama (из /api/tags). */
    models: local.models,
    /** Тег выбранной модели, если он действительно установлен. */
    active: local.ok ? local.model : null,
    code: local.code,
    hint: local.hint,
  })
}
