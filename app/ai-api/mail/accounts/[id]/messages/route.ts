import { NextResponse, type NextRequest } from 'next/server'
import { listMessages } from '@/lib/mail-imap'
import { PAGE_LIMIT_DEFAULT } from '@/lib/mail-read'
import { folderParam, mailErrorResponse, readGuard } from '@/lib/mail-read-route'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** ?folder=INBOX&cursor=&limit=30 — конверты без тел, от новых к старым. */
export const GET = withRoute('/ai-api/mail/accounts/[id]/messages', async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const g = await readGuard(id)
  if (g instanceof NextResponse) return g
  const q = req.nextUrl.searchParams
  const folder = folderParam(q.get('folder'))
  if (folder instanceof NextResponse) return folder
  const cursorRaw = q.get('cursor')
  const cursor = cursorRaw ? Number(cursorRaw) : null
  if (cursor !== null && (!Number.isInteger(cursor) || cursor < 1)) return NextResponse.json({ code: 'INVALID_ARGS', error: 'cursor указан неверно.' }, { status: 400 })
  const limit = Number(q.get('limit') ?? PAGE_LIMIT_DEFAULT)
  const withFolders = q.get('withFolders') === '1'
  try {
    const page = await listMessages(g.acc, folder, cursor, Number.isFinite(limit) ? limit : PAGE_LIMIT_DEFAULT, withFolders)
    return NextResponse.json({ ...page, syncedAt: Date.now() })
  } catch (e) {
    return mailErrorResponse(e, g.acc)
  }
})
