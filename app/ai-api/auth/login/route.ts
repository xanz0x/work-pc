import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, equalConst, issueSession, sessionTtlMs, sha256 } from '@/lib/app-auth'
import { clientIp, limitLogin, resetLogin } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRoute('/ai-api/auth/login', async (req: NextRequest) => {
  const password = process.env.APP_PASSWORD
  const secret = process.env.APP_SESSION_SECRET
  if (!password || !secret) {
    return NextResponse.json(
      { code: 'CLOUD_NOT_CONFIGURED', error: 'Вход не настроен на сервере.' },
      { status: 503 },
    )
  }

  const ip = clientIp(req.headers)
  const wait = limitLogin(ip)
  if (wait) {
    return NextResponse.json(
      { code: 'RATE_LIMITED', error: 'Слишком много попыток. Подождите и повторите.' },
      { status: 429, headers: { 'Retry-After': String(wait) } },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string }
  const given = await sha256(String(body.password ?? ''))
  if (!equalConst(given, await sha256(password))) {
    return NextResponse.json({ code: 'AUTH_REQUIRED', error: 'Пароль не подошёл.' }, { status: 401 })
  }

  const { token, expires } = await issueSession(secret, sessionTtlMs())
  resetLogin(ip)
  const res = NextResponse.json({ ok: true, expires: expires.getTime() })
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  })
  return res
})
