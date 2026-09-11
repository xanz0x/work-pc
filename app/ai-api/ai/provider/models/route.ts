import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { OPENROUTER_BASE, ProviderError, listProviderModels, readProvider } from '@/lib/ai-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Список моделей провайдера. Без параметров — по сохранённой конфигурации;
 * с `?kind=&baseUrl=&apiKey=` — проверка ещё не сохранённых реквизитов,
 * чтобы человек выбрал модель до нажатия «Сохранить».
 */
export const GET = withRoute('/ai-api/ai/provider/models', async (req: NextRequest) => {
  try {
    const saved = await readProvider()
    const q = req.nextUrl.searchParams
    const kind = q.get('kind') === 'custom' ? 'custom' : q.get('kind') === 'openrouter' ? 'openrouter' : saved.kind
    const baseUrl = (q.get('baseUrl') ?? '').trim() || (kind === 'openrouter' ? OPENROUTER_BASE : saved.baseUrl)
    const apiKey = (q.get('apiKey') ?? '').trim() || (kind === saved.kind ? saved.apiKey : '')
    const models = await listProviderModels({ ...saved, kind, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey })
    return NextResponse.json({ models })
  } catch (e) {
    if (e instanceof ProviderError) {
      const status = e.code === 'NOT_CONFIGURED' ? 409 : e.code === 'INVALID_ARGS' ? 400 : 502
      return NextResponse.json({ code: e.code, error: e.message, models: [] }, { status })
    }
    return NextResponse.json({ code: 'PROVIDER', error: 'Список моделей недоступен.', models: [] }, { status: 502 })
  }
})
