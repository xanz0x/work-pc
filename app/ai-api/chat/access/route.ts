import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { chatCapabilities } from '@/lib/chat-access-server'
import { toolAccess } from '@/lib/chat-tools'

export const dynamic = 'force-dynamic'
export const GET = withRoute('/ai-api/chat/access', async () => {
  const { tools, mail } = await chatCapabilities()
  return NextResponse.json({ tools, mail })
})
export const POST = withRoute('/ai-api/chat/access', async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.name !== 'string') return NextResponse.json({ error: 'Не указано действие.' }, { status: 400 })
  const { user, skills } = await chatCapabilities()
  const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {}
  const reason = toolAccess(body.name, user, args) || (!skills.some((s) => s.tool === body.name && s.enabled) ? 'Этот навык выключен в AI-центре.' : null)
  return NextResponse.json(reason ? { ok: false, error: reason } : { ok: true }, { status: reason ? 403 : 200 })
})