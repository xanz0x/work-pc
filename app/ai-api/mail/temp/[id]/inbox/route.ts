import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { tempInbox } from '@/lib/temp-mail'
import { tempErrorResponse, tempGuard } from '@/lib/temp-mail-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withRoute('/ai-api/mail/temp/[id]/inbox', async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const bad = tempGuard(id)
  if (bad) return bad
  try {
    const { box, rows } = await tempInbox(id)
    return NextResponse.json({ box, rows, syncedAt: Date.now() })
  } catch (e) {
    return tempErrorResponse(e)
  }
})
