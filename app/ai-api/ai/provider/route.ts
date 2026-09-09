import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { ProviderError, providerView, readProvider, writeProvider } from '@/lib/ai-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(e: unknown): NextResponse {
  if (e instanceof ProviderError) {
    const status = e.code === 'FORBIDDEN' ? 403 : e.code === 'INVALID_ARGS' ? 400 : e.code === 'NOT_CONFIGURED' ? 409 : 502
    return NextResponse.json({ code: e.code, error: e.message }, { status })
  }
  return NextResponse.json({ code: 'PROVIDER', error: 'Не удалось выполнить запрос к провайдеру.' }, { status: 500 })
}

/** Текущее подключение модели (без токена). */
export const GET = withRoute('/ai-api/ai/provider', async () => {
  try {
    return NextResponse.json(providerView(await readProvider()))
  } catch (e) {
    return fail(e)
  }
})

/** { kind, baseUrl, apiKey?, model, visionModel? } — сохранить подключение. */
export const PUT = withRoute('/ai-api/ai/provider', async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    return NextResponse.json(providerView(await writeProvider(body)))
  } catch (e) {
    return fail(e)
  }
})
