import { NextResponse } from 'next/server'
import { providerStatus } from '@/lib/llm'
import { log } from '@/lib/log'
import { requestId } from '@/lib/ai-errors'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Состояние подключённой модели. Настройки и чат спрашивают этот маршрут,
 * чтобы писать правду: какой способ подключения выбран, какая модель пойдёт
 * в запрос и что сделать, если подключения нет.
 *
 * GET /ai-api/engine
 */
export async function GET(req: NextRequest) {
  const rid = req.headers.get('x-request-id') ?? requestId()
  const st = await providerStatus()

  log('info', 'engine.probe', {
    rid,
    route: '/ai-api/engine',
    status: 200,
    engine: st.ok ? st.kind : 'off',
    code: st.code ?? undefined,
  })

  return NextResponse.json({
    provider: {
      ok: st.ok,
      kind: st.kind,
      kindLabel: st.kindLabel,
      base: st.base,
      model: st.model,
      visionModel: st.visionModel,
      code: st.code,
      hint: st.hint,
    },
  })
}
