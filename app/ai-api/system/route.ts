import { NextResponse, type NextRequest } from 'next/server'
import { getSystemPrompt, saveSystemPrompt } from '@/lib/ai-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ text: await getSystemPrompt() })
}

export async function PUT(req: NextRequest) {
  const b = (await req.json()) as { text?: string }
  const text = (b.text ?? '').slice(0, 12000)
  if (!text.trim()) return NextResponse.json({ error: 'промпт пуст' }, { status: 400 })
  await saveSystemPrompt(text)
  return NextResponse.json({ ok: true })
}
