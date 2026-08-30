import { NextResponse, type NextRequest } from 'next/server'
import { deleteSession, getSession, safeId, saveSession } from '@/lib/ai-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

export const GET = withRoute('/ai-api/sessions/[id]', async (_req: NextRequest, { params }: P) => {
  const { id } = await params
  const s = await getSession(safeId(id))
  if (!s) return NextResponse.json({ error: 'нет такой сессии' }, { status: 404 })
  return NextResponse.json({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    pinned: s.pinned,
    msgs: s.msgs,
  })
})

export const PATCH = withRoute('/ai-api/sessions/[id]', async (req: NextRequest, { params }: P) => {
  const { id } = await params
  let b: { title?: string; msgs?: unknown[]; pinned?: string[]; createdAt?: number }
  try {
    b = (await req.json()) as typeof b
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', error: 'тело запроса не JSON' }, { status: 400 })
  }
  let s = await getSession(safeId(id))
  if (!s) {
    s = {
      id: safeId(id),
      title: 'Новый диалог',
      createdAt: b.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      pinned: [],
      msgs: [],
      llm: [],
    }
  }
  if (typeof b.title === 'string') s.title = b.title.slice(0, 60)
  if (Array.isArray(b.msgs)) s.msgs = b.msgs
  if (Array.isArray(b.pinned)) s.pinned = b.pinned
  s.updatedAt = Date.now()
  await saveSession(s)
  return NextResponse.json({ ok: true })
})

export const DELETE = withRoute(
  '/ai-api/sessions/[id]',
  async (_req: NextRequest, { params }: P) => {
    const { id } = await params
    await deleteSession(safeId(id))
    return NextResponse.json({ ok: true })
  },
)
