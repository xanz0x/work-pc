import { NextResponse, type NextRequest } from 'next/server'
import { getSession, listSessions, safeId, saveSession } from '@/lib/ai-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/ai-api/sessions', async () =>
  NextResponse.json(await listSessions()),
)

export const POST = withRoute('/ai-api/sessions', async (req: NextRequest) => {
  let b: { id?: string; title?: string }
  try {
    b = (await req.json()) as typeof b
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', error: 'тело запроса не JSON' }, { status: 400 })
  }
  const id = safeId(b.id ?? `s-${Date.now().toString(36)}`)
  const cur = await getSession(id)
  if (cur) return NextResponse.json(cur)
  const s = {
    id,
    title: String(b.title ?? 'Новый диалог').slice(0, 60),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: [],
    msgs: [],
    llm: [],
  }
  await saveSession(s)
  return NextResponse.json(s)
})
