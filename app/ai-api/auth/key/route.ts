import { NextResponse, type NextRequest } from 'next/server'
import { clientIp, failKey, limitKey } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'
import { KEY_ERRORS, KEY_RE, normalizeKey } from '@/lib/users'
import { inspectKey } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Предпросмотр ключа перед регистрацией: тариф и срок, без активации.
   Открыт без сессии; бюджет тратят только неудачные попытки. */
export const POST = withRoute('/ai-api/auth/key', async (req: NextRequest) => {
  const ip = clientIp(req.headers)
  const wait = limitKey(ip)
  if (wait) return NextResponse.json({ code: 'RATE_LIMITED', error: 'Слишком много попыток.' }, { status: 429, headers: { 'Retry-After': String(wait) } })
  const b = (await req.json().catch(() => ({}))) as { key?: unknown }
  const key = normalizeKey(b.key)
  if (!KEY_RE.test(key)) return NextResponse.json({ code: 'INVALID', error: 'Ключ выглядит как WSX-XXXX-XXXX-XXXX-XXXX.' }, { status: 400 })
  const r = await inspectKey(key)
  if (!r.ok) {
    failKey(ip)
    return NextResponse.json({ code: r.code, error: KEY_ERRORS[r.code] }, { status: 400 })
  }
  return NextResponse.json(r)
})
