import { NextResponse, type NextRequest } from 'next/server'
import { bridgePoll, bridgeResult } from '@/lib/mcp-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Мост к открытой вкладке: она забирает задания и записи аудита (GET, до 20 с
   ожидания) и возвращает результаты (POST). Закрыто сессией в proxy.ts. */

export const GET = withRoute('/mcp/admin/bridge', async (req: NextRequest) => {
  const wait = Math.min(20_000, Math.max(0, Number(req.nextUrl.searchParams.get('wait')) || 0))
  return NextResponse.json(await bridgePoll(wait))
})

export const POST = withRoute('/mcp/admin/bridge', async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    results?: { id?: unknown; ok?: unknown; payload?: unknown }[]
  }
  let accepted = 0
  for (const r of Array.isArray(body.results) ? body.results : []) {
    if (typeof r.id === 'string' && bridgeResult(r.id, r.ok === true, r.payload)) accepted += 1
  }
  return NextResponse.json({ accepted })
})
