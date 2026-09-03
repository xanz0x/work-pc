import { NextResponse, type NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { log, startRequest } from '@/lib/log'
import { clientIp, limitTelemetry } from '@/lib/rate-limit'
import {
  TELEMETRY_ACTIONS,
  TELEMETRY_DROPS,
  TELEMETRY_SCREENS,
} from '@/lib/telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = process.env.AI_DIR?.trim() || path.join(process.cwd(), 'ai')

/**
 * NF-9: приём агрегированной статистики. Никаких внешних сервисов — файл
 * ложится рядом с AI-слоем, на том же диске, что и всё остальное.
 *
 * Сервер принимает ТОЛЬКО известные счётчики: ключи, которых нет в словаре,
 * и любые значения, кроме конечных чисел, отбрасываются. Так обещание
 * «уходят только счётчики» проверяется на приёме, а не только на слово.
 */
function onlyKnownCounters(
  input: unknown,
  allowed: readonly string[],
): Record<string, number> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.includes(k)) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
    out[k] = Math.min(Math.round(v), 1_000_000)
  }
  return out
}

function iso(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export async function POST(req: NextRequest) {
  const r = startRequest('/ai-api/telemetry/usage', 'POST')
  const retryAfter = limitTelemetry(clientIp(req.headers))
  if (retryAfter) {
    r.done(429, { code: 'RATE_LIMITED' })
    const resp = NextResponse.json(
      { code: 'RATE_LIMITED', error: 'Слишком много отправок статистики.' },
      { status: 429 },
    )
    resp.headers.set('Retry-After', String(retryAfter))
    return resp
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    r.done(400, { code: 'BAD_REQUEST' })
    return NextResponse.json(
      { code: 'BAD_REQUEST', error: 'Тело запроса не JSON.' },
      { status: 400 },
    )
  }

  const rec = {
    v: 1 as const,
    app: 'workspacex' as const,
    from: iso(body.from),
    to: iso(body.to),
    screens: onlyKnownCounters(body.screens, TELEMETRY_SCREENS),
    actions: onlyKnownCounters(body.actions, TELEMETRY_ACTIONS),
    drops: onlyKnownCounters(body.drops, TELEMETRY_DROPS),
    receivedAt: new Date().toISOString(),
  }

  const dir = path.join(ROOT, 'telemetry')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, `usage-${Date.now().toString(36)}.json`),
    `${JSON.stringify(rec, null, 2)}\n`,
    'utf-8',
  )

  log('info', 'telemetry.usage', {
    count:
      Object.keys(rec.screens).length +
      Object.keys(rec.actions).length +
      Object.keys(rec.drops).length,
  })
  r.done(202)
  return NextResponse.json({ ok: true, stored: rec }, { status: 202 })
}
