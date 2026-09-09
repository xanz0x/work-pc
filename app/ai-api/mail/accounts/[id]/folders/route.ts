import { NextResponse, type NextRequest } from 'next/server'
import { listFolders } from '@/lib/mail-imap'
import { mailErrorResponse, readGuard } from '@/lib/mail-read-route'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** Папки ящика со счётчиками (всего / непрочитанных). */
export const GET = withRoute('/ai-api/mail/accounts/[id]/folders', async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const g = await readGuard(id)
  if (g instanceof NextResponse) return g
  try {
    const folders = await listFolders(g.acc)
    return NextResponse.json({ folders, syncedAt: Date.now() })
  } catch (e) {
    return mailErrorResponse(e, g.acc)
  }
})
