import { NextResponse, type NextRequest } from 'next/server'
import { issueSession, sessionTtlMs, setSessionCookies } from '@/lib/app-auth'
import { clientIp, failKey, limitKey } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'
import { KEY_ERRORS, KEY_RE, loginProblem, normalizeKey, passwordProblem } from '@/lib/users'
import { register } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Регистрация только по ключу лицензии: логин + пароль дважды + ключ.
   Аккаунт сразу получает тариф и срок, зашитые в ключ. */
export const POST = withRoute('/ai-api/auth/register', async (req: NextRequest) => {
  const secret = process.env.APP_SESSION_SECRET
  if (!secret) return NextResponse.json({ code: 'CLOUD_NOT_CONFIGURED', error: 'Вход не настроен на сервере.' }, { status: 503 })
  const ip = clientIp(req.headers)
  const wait = limitKey(ip)
  if (wait) return NextResponse.json({ code: 'RATE_LIMITED', error: 'Слишком много попыток.' }, { status: 429, headers: { 'Retry-After': String(wait) } })

  const b = (await req.json().catch(() => ({}))) as { login?: unknown; password?: unknown; passwordConfirm?: unknown; key?: unknown }
  const bad = (error: string) => NextResponse.json({ code: 'INVALID_ARGS', error }, { status: 400 })
  const lp = loginProblem(b.login)
  if (lp) return bad(lp)
  const pp = passwordProblem(b.password)
  if (pp) return bad(pp)
  if (b.password !== b.passwordConfirm) return bad('Пароли не совпадают.')
  const key = normalizeKey(b.key)
  if (!KEY_RE.test(key)) return bad('Ключ выглядит как WSX-XXXX-XXXX-XXXX-XXXX.')

  const r = await register(String(b.login), b.password as string, key, sessionTtlMs(), req.headers.get('user-agent') ?? '')
  if (!r.ok) {
    if (r.code === 'LOGIN_TAKEN') return NextResponse.json({ code: r.code, error: 'Этот логин уже занят.' }, { status: 409 })
    failKey(ip)
    return NextResponse.json({ code: r.code, error: KEY_ERRORS[r.code] }, { status: 400 })
  }

  const { token, expires } = await issueSession(secret, sessionTtlMs(), r.sid)
  const res = NextResponse.json({ ok: true, user: r.user })
  setSessionCookies(res, token, expires, r.user.id)
  return res
})
