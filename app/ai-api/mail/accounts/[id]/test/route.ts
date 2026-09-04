import { NextResponse, type NextRequest } from 'next/server'
import { mailEnabled } from '@/lib/mail-crypto'
import { testAccount } from '@/lib/mail-server'
import { requireUser } from '@/lib/request-context'
import { limitMailAuth } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** Повторная проверка SMTP и IMAP; обновляет status ящика. */
export const POST = withRoute('/ai-api/mail/accounts/[id]/test', async (_req: NextRequest, ctx: Ctx) => {
  if (!mailEnabled()) return NextResponse.json({ code: 'MAIL_DISABLED', error: 'Модуль почты выключен: не задан MAIL_SECRET.' }, { status: 503 })
  const { id } = await ctx.params
  if (!/^[a-f0-9]{8}$/.test(id)) return NextResponse.json({ code: 'NOT_FOUND', error: 'Ящик не найден.' }, { status: 404 })
  const wait = limitMailAuth(`${requireUser().uid}:${id}`)
  if (wait) return NextResponse.json({ code: 'RATE_LIMITED', error: `Слишком много проверок. Повторите через ${wait} с.`, retryAfter: wait }, { status: 429 })
  const r = await testAccount(id)
  if (!r) return NextResponse.json({ code: 'NOT_FOUND', error: 'Ящик не найден.' }, { status: 404 })
  return NextResponse.json(r)
})
