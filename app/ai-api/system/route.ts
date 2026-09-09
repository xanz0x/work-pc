import { NextResponse, type NextRequest } from 'next/server'
import { getSystemPrompt, saveSystemPrompt } from '@/lib/ai-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/ai-api/system', async () =>
  NextResponse.json({ text: await getSystemPrompt() }),
)

export const PUT = withRoute('/ai-api/system', async (req: NextRequest) => {
  let b: { text?: string }
  try {
    b = (await req.json()) as typeof b
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', error: 'тело запроса не JSON' }, { status: 400 })
  }
  const text = (b.text ?? '').slice(0, 12000)
  if (!text.trim()) return NextResponse.json({ error: 'промпт пуст' }, { status: 400 })
  await saveSystemPrompt(text)
  return NextResponse.json({ ok: true })
})
