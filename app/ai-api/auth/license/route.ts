import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/app-auth'
import { clientIp, limitLogin } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'
import { redeemLicense, resolveSession } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Активация ключа лицензии пользователем. Перебор ключей режется тем же лимитом, что и вход. */
export const POST = withRoute('/ai-api/auth/license', async (req: NextRequest) => {
  const secret = process.env.APP_SESSION_SECRET
  const sid = secret ? await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value) : null
  const r = sid ? await resolveSession(sid) : null
  if (!r) return NextResponse.json({ code: 'AUTH_REQUIRED', error: 'Нужен вход.' }, { status: 401 })
  const wait = limitLogin(clientIp(req.headers))
  if (wait) return NextResponse.json({ code: 'RATE_LIMITED', error: 'Слишком много попыток.' }, { status: 429, headers: { 'Retry-After': String(wait) } })

  const b = (await req.json().catch(() => ({}))) as { key?: unknown }
  const key = String(b.key ?? '').trim().toUpperCase()
  if (!/^WSX(-[A-Z2-9]{4}){4}$/.test(key)) {
    return NextResponse.json({ code: 'INVALID', error: 'Ключ выглядит как WSX-XXXX-XXXX-XXXX-XXXX.' }, { status: 400 })
  }
  const out = await redeemLicense(r.user.id, key)
  const msg = { INVALID: 'Такого ключа нет.', USED: 'Ключ уже активирован.', REVOKED: 'Ключ отозван администратором.' }
  if (out !== 'ok') return NextResponse.json({ code: out, error: msg[out] }, { status: 400 })
  return NextResponse.json({ ok: true })
})
