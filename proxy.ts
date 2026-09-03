import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/app-auth'
import { log, newRequestId } from '@/lib/log'

/**
 * Всё под /ai-api закрыто сессией: без cookie — 401, кроме самого входа.
 * NF-10: управление MCP-токенами и мост вкладки (/mcp/admin/*) закрыты так же;
 * сам /mcp открыт агентам по Bearer-токену и сессию не использует.
 * В Next 16 конвенция middleware переименована в proxy (P0-2).
 * Здесь же рождается request-id (AR-5): он уезжает в маршрут заголовком
 * x-request-id и возвращается клиенту в X-Request-Id.
 */
export const config = { matcher: ['/ai-api/:path*', '/mcp/admin/:path*'] }

export async function proxy(req: NextRequest) {
  const rid = newRequestId()
  const route = req.nextUrl.pathname
  const method = req.method

  const deny = (status: number, code: string, error: string) => {
    log('warn', 'ai-api.deny', { rid, route, method, status, code })
    const res = NextResponse.json({ code, error, requestId: rid }, { status })
    res.headers.set('X-Request-Id', rid)
    return res
  }

  const pass = () => {
    const headers = new Headers(req.headers)
    headers.set('x-request-id', rid)
    const res = NextResponse.next({ request: { headers } })
    res.headers.set('X-Request-Id', rid)
    return res
  }

  if (route.startsWith('/ai-api/auth')) return pass()
  /* §3.5: приём клиентской ошибки открыт без сессии — падение на экране
     входа тоже должно доходить. Лимит стоит в самом маршруте; чтение
     метрик (GET) остаётся закрытым. */
  if (route === '/ai-api/telemetry' && method === 'POST') return pass()

  const secret = process.env.APP_SESSION_SECRET
  const password = process.env.APP_PASSWORD
  if (!secret || !password) {
    return deny(503, 'CLOUD_NOT_CONFIGURED', 'Вход в приложение не настроен на сервере.')
  }

  const ok = await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value)
  if (!ok) return deny(401, 'AUTH_REQUIRED', 'Нужен вход в приложение.')
  return pass()
}
