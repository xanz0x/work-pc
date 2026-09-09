import { NextResponse, type NextRequest } from 'next/server'
import { getMessage } from '@/lib/mail-imap'
import { folderParam, mailErrorResponse, readGuard, uidParam } from '@/lib/mail-read-route'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; uid: string }> }

/** ?folder=INBOX&markSeen=0 — письмо целиком: заголовки, очищенный HTML или текст, список вложений. */
export const GET = withRoute('/ai-api/mail/accounts/[id]/messages/[uid]', async (req: NextRequest, ctx: Ctx) => {
  const { id, uid: uidRaw } = await ctx.params
  const g = await readGuard(id)
  if (g instanceof NextResponse) return g
  const folder = folderParam(req.nextUrl.searchParams.get('folder'))
  if (folder instanceof NextResponse) return folder
  const uid = uidParam(uidRaw)
  if (uid instanceof NextResponse) return uid
  const markSeen = req.nextUrl.searchParams.get('markSeen') !== '0'
  try {
    const message = await getMessage(g.acc, folder, uid, markSeen)
    return NextResponse.json({ message })
  } catch (e) {
    return mailErrorResponse(e, g.acc)
  }
})
