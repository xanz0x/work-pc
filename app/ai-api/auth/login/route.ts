import { NextResponse, type NextRequest } from 'next/server'
import { issueSession, sessionTtlMs, setSessionCookies } from '@/lib/app-auth'
import { clientIp, limitLogin, resetLogin } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'
import { isEmail } from '@/lib/users'
import { login } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRoute('/ai-api/auth/login', async (req: NextRequest) => {
  const secret = process.env.APP_SESSION_SECRET
  if (!process.env.APP_PASSWORD || !secret) {
    return NextResponse.json({ code: 'CLOUD_NOT_CONFIGURED', error: 'Вход не настроен на сервере.' }, { status: 503 })
  }

  const ip = clientIp(req.headers)
  const wait = limitLogin(ip)
  if (wait) {
    return NextResponse.json(
      { code: 'RATE_LIMITED', error: 'Слишком много попыток. Подождите и повторите.' },
      { status: 429, headers: { 'Retry-After': String(wait) } },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown }
  const email = typeof body.email === 'string' && body.email.trim() ? body.email : null
  if (email !== null && !isEmail(email)) {
    return NextResponse.json({ code: 'AUTH_REQUIRED', error: 'Введите корректный email.' }, { status: 401 })
  }
  const r = await login(email, String(body.password ?? ''), sessionTtlMs(), req.headers.get('user-agent') ?? '')
  if (!r.ok) {
    const msg = r.code === 'BLOCKED' ? 'Учётная запись заблокирована администратором.' : 'Email или пароль не подошли.'
    return NextResponse.json({ code: r.code === 'BLOCKED' ? 'BLOCKED' : 'AUTH_REQUIRED', error: msg }, { status: r.code === 'BLOCKED' ? 403 : 401 })
  }

  const { token, expires } = await issueSession(secret, sessionTtlMs(), r.sid)
  resetLogin(ip)
  const res = NextResponse.json({ ok: true, expires: expires.getTime(), user: r.user })
  setSessionCookies(res, token, expires, r.user.id)
  return res
})
