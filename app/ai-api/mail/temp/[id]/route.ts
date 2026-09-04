import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { extendTempBox, removeTempBox } from '@/lib/temp-mail'
import { tempErrorResponse, tempGuard } from '@/lib/temp-mail-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const DELETE = withRoute('/ai-api/mail/temp/[id]', async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const bad = tempGuard(id)
  if (bad) return bad
  try {
    if (!(await removeTempBox(id))) return NextResponse.json({ code: 'NOT_FOUND', error: 'Временный ящик не найден.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return tempErrorResponse(e)
  }
})

/** Продление обычного временного ящика на очередные 10 минут. */
export const PATCH = withRoute('/ai-api/mail/temp/[id]', async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const bad = tempGuard(id)
  if (bad) return bad
  try {
    return NextResponse.json({ box: await extendTempBox(id) })
  } catch (e) {
    return tempErrorResponse(e)
  }
})
