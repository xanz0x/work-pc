import { NextResponse, type NextRequest } from 'next/server'
import { issueSession, sessionTtlMs, setSessionCookies } from '@/lib/app-auth'
import { clientIp, limitLogin } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'
import { isEmail, passwordProblem } from '@/lib/users'
import { register } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Саморегистрация: аккаунт создаётся сразу, но работать он начнёт только
   после ключа лицензии от администратора (см. accessState). */
export const POST = withRoute('/ai-api/auth/register', async (req: NextRequest) => {
  const secret = process.env.APP_SESSION_SECRET
  if (!secret) return NextResponse.json({ code: 'CLOUD_NOT_CONFIGURED', error: 'Вход не настроен на сервере.' }, { status: 503 })
  const wait = limitLogin(clientIp(req.headers))
  if (wait) return NextResponse.json({ code: 'RATE_LIMITED', error: 'Слишком много попыток.' }, { status: 429, headers: { 'Retry-After': String(wait) } })

  const b = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; name?: unknown }
  if (!isEmail(b.email)) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Введите корректный email.' }, { status: 400 })
  const pp = passwordProblem(b.password)
  if (pp) return NextResponse.json({ code: 'INVALID_ARGS', error: pp }, { status: 400 })

  const r = await register(b.email, b.password as string, String(b.name ?? ''), sessionTtlMs(), req.headers.get('user-agent') ?? '')
  if (!r.ok) return NextResponse.json({ code: 'EMAIL_TAKEN', error: 'Такой email уже зарегистрирован.' }, { status: 409 })

  const { token, expires } = await issueSession(secret, sessionTtlMs(), r.sid)
  const res = NextResponse.json({ ok: true, user: r.user })
  setSessionCookies(res, token, expires, r.user.id)
  return res
})
