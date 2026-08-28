import { NextResponse, type NextRequest } from 'next/server'
import { getSession, listSessions, safeId, saveSession } from '@/lib/ai-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await listSessions())
}

export async function POST(req: NextRequest) {
  const b = (await req.json()) as { id?: string; title?: string }
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
}
