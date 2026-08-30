import { NextResponse, type NextRequest } from 'next/server'
import { listSkills, saveSkill, type SkillFile } from '@/lib/ai-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/ai-api/skills', async () =>
  NextResponse.json(await listSkills()),
)

/** Создание пользовательского скилла-инструкции. */
export const POST = withRoute('/ai-api/skills', async (req: NextRequest) => {
  let b: { name?: string; description?: string; instructions?: string }
  try {
    b = (await req.json()) as typeof b
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', error: 'тело запроса не JSON' }, { status: 400 })
  }
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
})
