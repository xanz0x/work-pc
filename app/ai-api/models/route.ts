import { NextResponse } from 'next/server'
import { OPENROUTER_BASE, listProviderModels, readProvider } from '@/lib/ai-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Совместимость: прежний маршрут списка моделей теперь отвечает списком
 * моделей подключённого провайдера. Единственный источник — сам провайдер
 * (`GET <base>/models`), захардкоженных списков в продукте нет.
 */
export async function GET() {
  const c = await readProvider()
  try {
    const models = await listProviderModels(c)
    return NextResponse.json({
      ok: true,
      base: c.baseUrl || OPENROUTER_BASE,
      models: models.map((m) => m.id),
      active: c.model || null,
      code: null,
      hint: null,
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      base: c.baseUrl || null,
      models: [],
      active: c.model || null,
      code: 'CLOUD_NOT_CONFIGURED',
      hint: e instanceof Error ? e.message : 'Список моделей недоступен.',
    })
  }
}
