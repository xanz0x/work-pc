import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, clearSessionCookies, verifySession } from '@/lib/app-auth'
import { withRoute } from '@/lib/route-log'
import { accessState } from '@/lib/users'
import { endSession, resolveSession } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Состояние сессии и профиль: интерфейс решает, что показать — вход, лицензию, смену пароля или приложение. */
export const GET = withRoute('/ai-api/auth/session', async (req: NextRequest) => {
  const secret = process.env.APP_SESSION_SECRET
  const configured = Boolean(secret && process.env.APP_PASSWORD)
  const sid = secret ? await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value) : null
  const r = sid ? await resolveSession(sid) : null
  if (!r) return NextResponse.json({ authed: false, configured, user: null, access: null })
  return NextResponse.json({ authed: true, configured, user: r.user, access: accessState(r.user) })
})

/** Выход: сессия удаляется на сервере, cookie стираются. Локальные данные остаются в браузере. */
export const DELETE = withRoute('/ai-api/auth/session', async (req: NextRequest) => {
  const secret = process.env.APP_SESSION_SECRET
  const sid = secret ? await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value) : null
  if (sid) await endSession(sid)
  const res = NextResponse.json({ ok: true })
  clearSessionCookies(res)
  return res
})
