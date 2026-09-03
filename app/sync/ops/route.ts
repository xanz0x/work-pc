import { NextResponse, type NextRequest } from 'next/server'
import { MAX_OPS_PER_PUSH, authFromHeaders, isSealed, pullOps, pushOps } from '@/lib/sync-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Журнал шифртекстов: GET — забрать после seq (long-poll до 20 с), POST — добавить. */

const deny = () => NextResponse.json({ code: 'SYNC_AUTH', error: 'Устройство не опознано или отозвано.' }, { status: 403 })

export const GET = withRoute('/sync/ops', async (req: NextRequest) => {
  const auth = await authFromHeaders(req.headers)
  if (!auth) return deny()
  const since = Math.max(0, Number(req.nextUrl.searchParams.get('since')) || 0)
  const wait = Math.min(20_000, Math.max(0, Number(req.nextUrl.searchParams.get('wait')) || 0))
  return NextResponse.json(await pullOps(auth, since, wait))
})

export const POST = withRoute('/sync/ops', async (req: NextRequest) => {
  const auth = await authFromHeaders(req.headers)
  if (!auth) return deny()
  const b = (await req.json().catch(() => ({}))) as { ops?: unknown }
  const ops = Array.isArray(b.ops) ? b.ops : null
  if (!ops || ops.length === 0 || ops.length > MAX_OPS_PER_PUSH || !ops.every(isSealed)) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Ожидается 1–500 шифртекстов.' }, { status: 400 })
  }
  return NextResponse.json(await pushOps(auth, ops))
})
