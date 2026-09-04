import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { tempMessage } from '@/lib/temp-mail'
import { tempErrorResponse, tempGuard } from '@/lib/temp-mail-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; mid: string }> }

export const GET = withRoute('/ai-api/mail/temp/[id]/messages/[mid]', async (_req: NextRequest, ctx: Ctx) => {
  const { id, mid } = await ctx.params
  const bad = tempGuard(id)
  if (bad) return bad
  try {
    return NextResponse.json({ message: await tempMessage(id, decodeURIComponent(mid)) })
  } catch (e) {
    return tempErrorResponse(e)
  }
})
