import { NextResponse, type NextRequest } from 'next/server'
import { log, startRequest } from '@/lib/log'
import { metricsSnapshot, trackError } from '@/lib/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Локальный трекинг ошибок (AR-5, шаг 3). Никаких внешних сервисов:
 * клиент присылает место и машинную причину, сервер кладёт запись рядом
 * с серверными ошибками. Содержимое запросов и имена файлов не принимаем:
 * поле reason обрезается, всё остальное игнорируется.
 */
export async function POST(req: NextRequest) {
  const r = startRequest('/ai-api/telemetry', 'POST')
  let body: { kind?: string; where?: string; message?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    r.done(400, { code: 'BAD_REQUEST' })
    return NextResponse.json({ code: 'BAD_REQUEST', error: 'Тело запроса не JSON.' }, { status: 400 })
  }
  const where = String(body.where ?? 'unknown').slice(0, 60)
  const kind = String(body.kind ?? 'client-error').slice(0, 40)
  trackError({
    rid: r.rid,
    where,
    code: kind,
    reason: String(body.message ?? '').slice(0, 200),
  })
  r.done(202)
  return NextResponse.json({ ok: true, requestId: r.rid }, { status: 202 })
}

/** Четыре метрики: ходы, ошибки, латентность, расход токенов. */
export async function GET() {
  const r = startRequest('/ai-api/telemetry', 'GET')
  const snap = metricsSnapshot()
  log('debug', 'metrics.read', { count: snap.turns })
  r.done(200)
  return NextResponse.json(snap)
}
