import { NextResponse, type NextRequest } from 'next/server'
import { setFlags } from '@/lib/mail-imap'
import { folderParam, mailErrorResponse, readGuard, uidParam } from '@/lib/mail-read-route'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; uid: string }> }

/** { folder, seen?, flagged? } — прочитано / звезда. */
export const POST = withRoute('/ai-api/mail/accounts/[id]/messages/[uid]/flags', async (req: NextRequest, ctx: Ctx) => {
  const { id, uid: uidRaw } = await ctx.params
  const g = await readGuard(id)
  if (g instanceof NextResponse) return g
  const uid = uidParam(uidRaw)
  if (uid instanceof NextResponse) return uid
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Тело запроса не JSON.' }, { status: 400 })
  const folder = folderParam(typeof body.folder === 'string' ? body.folder : null)
  if (folder instanceof NextResponse) return folder
  const patch = {
    seen: typeof body.seen === 'boolean' ? body.seen : undefined,
    flagged: typeof body.flagged === 'boolean' ? body.flagged : undefined,
  }
  if (patch.seen === undefined && patch.flagged === undefined) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Укажите seen и/или flagged.' }, { status: 400 })
  try {
    const flags = await setFlags(g.acc, folder, uid, patch)
    return NextResponse.json({ ok: true, ...flags })
  } catch (e) {
    return mailErrorResponse(e, g.acc)
  }
})
