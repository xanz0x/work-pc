import { NextResponse, type NextRequest } from 'next/server'
import { decideApproval, listPending, pendingJob } from '@/lib/mcp-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Подтверждения опасных операций. GET — список ожидающих; GET ?id= — задание
   для выполнения во вкладке; POST — решение владельца. Закрыто сессией. */

export const GET = withRoute('/mcp/admin/pending', async (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const job = pendingJob(id)
    if (!job) return NextResponse.json({ code: 'NOT_FOUND', error: 'Запрос не ждёт решения.' }, { status: 404 })
    return NextResponse.json(job)
  }
  return NextResponse.json(listPending())
})

export const POST = withRoute('/mcp/admin/pending', async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown
    decision?: unknown
    ok?: unknown
    payload?: unknown
  }
  if (typeof body.id !== 'string' || (body.decision !== 'approve' && body.decision !== 'reject')) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Нужны id и decision.' }, { status: 400 })
  }
  const done = await decideApproval(
    body.id,
    body.decision,
    body.decision === 'approve' ? { ok: body.ok === true, payload: body.payload } : undefined,
  )
  if (!done) return NextResponse.json({ code: 'NOT_FOUND', error: 'Запрос уже решён или истёк.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
