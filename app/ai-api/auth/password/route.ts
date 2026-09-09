import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/app-auth'
import { withRoute } from '@/lib/route-log'
import { passwordProblem } from '@/lib/users'
import { changePassword, resolveSession } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Смена пароля. Доступна и до лицензии: временный пароль от админа
   меняется здесь. Текущий пароль не нужен только при обязательной смене. */
export const POST = withRoute('/ai-api/auth/password', async (req: NextRequest) => {
  const secret = process.env.APP_SESSION_SECRET
  const sid = secret ? await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value) : null
  const r = sid ? await resolveSession(sid) : null
  if (!r) return NextResponse.json({ code: 'AUTH_REQUIRED', error: 'Нужен вход.' }, { status: 401 })

  const b = (await req.json().catch(() => ({}))) as { current?: unknown; next?: unknown }
  const pp = passwordProblem(b.next)
  if (pp) return NextResponse.json({ code: 'INVALID_ARGS', error: pp }, { status: 400 })
  const current = r.user.mustChangePassword ? null : String(b.current ?? '')
  const out = await changePassword(r.user.id, current, b.next as string)
  if (out === 'BAD_CURRENT') return NextResponse.json({ code: 'BAD_CURRENT', error: 'Текущий пароль не подошёл.' }, { status: 400 })
  if (out !== 'ok') return NextResponse.json({ code: 'NOT_FOUND', error: 'Пользователь не найден.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
