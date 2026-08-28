import { NextResponse, type NextRequest } from 'next/server'
import { deleteSkill, getSkill, safeId, saveSkill } from '@/lib/ai-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: P) {
  const { id } = await params
  const s = await getSkill(safeId(id))
  if (!s) return NextResponse.json({ error: 'нет такого скилла' }, { status: 404 })
  const b = (await req.json()) as {
    name?: string
    description?: string
    instructions?: string
    enabled?: boolean
  }
  if (typeof b.name === 'string' && !s.builtin) s.name = b.name.trim().slice(0, 60) || s.name
  if (typeof b.description === 'string') s.description = b.description.trim().slice(0, 200)
  if (typeof b.instructions === 'string') s.instructions = b.instructions.trim().slice(0, 4000)
  if (typeof b.enabled === 'boolean') s.enabled = b.enabled
  await saveSkill(s)
  return NextResponse.json(s)
}

export async function DELETE(_req: NextRequest, { params }: P) {
  const { id } = await params
  const s = await getSkill(safeId(id))
  if (s?.builtin) {
    return NextResponse.json({ error: 'встроенный скилл нельзя удалить — только выключить' }, { status: 400 })
  }
  await deleteSkill(safeId(id))
  return NextResponse.json({ ok: true })
}
