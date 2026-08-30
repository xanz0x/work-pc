import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/app-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Состояние сессии: нужно интерфейсу, чтобы показать «Войти» до первого хода. */
export async function GET(req: NextRequest) {
  const secret = process.env.APP_SESSION_SECRET
  const authed = secret
    ? await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value)
    : false
  return NextResponse.json({ authed, configured: Boolean(secret && process.env.APP_PASSWORD) })
}

/** Выход: cookie стирается, диалоги остаются на диске. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}
