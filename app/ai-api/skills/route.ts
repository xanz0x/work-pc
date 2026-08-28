import { NextResponse, type NextRequest } from 'next/server'
import { listSkills, saveSkill, type SkillFile } from '@/lib/ai-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await listSkills())
}

/** Создание пользовательского скилла-инструкции. */
export async function POST(req: NextRequest) {
  const b = (await req.json()) as { name?: string; description?: string; instructions?: string }
  const name = (b.name ?? '').trim().slice(0, 60)
  const instructions = (b.instructions ?? '').trim().slice(0, 4000)
  if (!name || !instructions) {
    return NextResponse.json({ error: 'нужны название и инструкция' }, { status: 400 })
  }
  const s: SkillFile = {
    id: `custom-${Date.now().toString(36)}`,
    name,
    kind: 'prompt',
    builtin: false,
    enabled: true,
    description: (b.description ?? '').trim().slice(0, 200),
    instructions,
  }
  await saveSkill(s)
  return NextResponse.json(s)
}
