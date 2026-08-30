import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/app-auth'

/**
 * Всё под /ai-api закрыто сессией: без cookie — 401, кроме самого входа.
 * В Next 16 конвенция middleware переименована в proxy (P0-2).
 */
export const config = { matcher: ['/ai-api/:path*'] }

export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/ai-api/auth')) return NextResponse.next()

  const secret = process.env.APP_SESSION_SECRET
  const password = process.env.APP_PASSWORD
  if (!secret || !password) {
    return NextResponse.json(
      { code: 'CLOUD_NOT_CONFIGURED', error: 'Вход в приложение не настроен на сервере.' },
      { status: 503 },
    )
  }

  const ok = await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value)
  if (!ok) {
    return NextResponse.json(
      { code: 'AUTH_REQUIRED', error: 'Нужен вход в приложение.' },
      { status: 401 },
    )
  }
  return NextResponse.next()
}
