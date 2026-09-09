import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { TEMP_KINDS, createTempBox, listTempBoxes, sonjjConfigured, type TempKind } from '@/lib/temp-mail'
import { tempErrorResponse, tempGuard } from '@/lib/temp-mail-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/ai-api/mail/temp', async () => {
  const bad = tempGuard()
  if (bad) return bad
  return NextResponse.json({ boxes: await listTempBoxes(), smailpro: sonjjConfigured() })
})

/** { kind: mailtm | temp | gmail | outlook } — создаёт одноразовый ящик у выбранного генератора. */
export const POST = withRoute('/ai-api/mail/temp', async (req: NextRequest) => {
  const bad = tempGuard()
  if (bad) return bad
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const kind = body.kind as TempKind
  if (!TEMP_KINDS.includes(kind)) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Неизвестный генератор временной почты.' }, { status: 400 })
  try {
    return NextResponse.json({ box: await createTempBox(kind) }, { status: 201 })
  } catch (e) {
    return tempErrorResponse(e)
  }
})
