import { NextResponse, type NextRequest } from 'next/server'
import { discover, splitEmail } from '@/lib/mail-discovery'
import { requireUser } from '@/lib/request-context'
import { limitMailDiscover } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** { email } → кандидаты настроек + подсказка про пароль. Без пароля, быстро. */
export const POST = withRoute('/ai-api/mail/discover', async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!splitEmail(email)) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Введите адрес вида name@domain.tld.' }, { status: 400 })
  }
  const wait = limitMailDiscover(requireUser().uid)
  if (wait) {
    return NextResponse.json({ code: 'RATE_LIMITED', error: `Слишком много запросов. Повторите через ${wait} с.`, retryAfter: wait }, { status: 429 })
  }
  const result = await discover(email)
  return NextResponse.json(result)
})
