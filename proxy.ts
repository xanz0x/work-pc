import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/app-auth'
import { log, newRequestId } from '@/lib/log'
import { accessState, type FeatureId } from '@/lib/users'
import { resolveSession } from '@/lib/users-server'

/**
 * Всё под /ai-api, /mcp/admin, /sync и /admin/api закрыто сессией пользователя.
 * Сессия — подписанная cookie, а её sid сверяется со списком на сервере:
 * администратор может завершить сессию досрочно. Дальше проверяются
 * блокировка, лицензия и тумблеры функций, выданные админом; маршрут
 * получает пользователя заголовками x-user-* (клиентские копии стираются).
 * Сам /mcp открыт агентам по Bearer-токену и сессию не использует.
 * В Next 16 конвенция middleware переименована в proxy (P0-2).
 * Здесь же рождается request-id (AR-5).
 */
export const config = { matcher: ['/ai-api/:path*', '/mcp/:path*', '/sync/:path*', '/admin/api/:path*'] }

const FEATURE_BY_PREFIX: [string, FeatureId][] = [
  ['/ai-api/chat', 'ai'],
  ['/ai-api/sessions', 'ai'],
  ['/ai-api/skills', 'ai'],
  ['/ai-api/mcp', 'ai'],
  ['/ai-api/system', 'ai'],
  ['/mcp/admin', 'mcp'],
  ['/sync', 'sync'],
]

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

  const pass = (user?: { id: string; role: string; legacy: boolean; sid: string }) => {
    const headers = new Headers(req.headers)
    for (const h of ['x-user-id', 'x-user-role', 'x-user-legacy', 'x-session-id']) headers.delete(h)
    headers.set('x-request-id', rid)
    if (user) {
      headers.set('x-user-id', user.id)
      headers.set('x-user-role', user.role)
      headers.set('x-user-legacy', user.legacy ? '1' : '0')
      headers.set('x-session-id', user.sid)
    }
    const res = NextResponse.next({ request: { headers } })
    res.headers.set('X-Request-Id', rid)
    return res
  }

  if (route.startsWith('/ai-api/auth')) return pass()
  if (route === '/mcp') return pass()
  /* §3.5: приём клиентской ошибки открыт без сессии — падение на экране
     входа тоже должно доходить. Лимит стоит в самом маршруте. */
  if (route === '/ai-api/telemetry' && method === 'POST') return pass()

  const secret = process.env.APP_SESSION_SECRET
  const password = process.env.APP_PASSWORD
  if (!secret || !password) {
    return deny(503, 'CLOUD_NOT_CONFIGURED', 'Вход в приложение не настроен на сервере.')
  }

  const sid = await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value)
  const resolved = sid ? await resolveSession(sid) : null
  if (!sid || !resolved) return deny(401, 'AUTH_REQUIRED', 'Нужен вход в приложение.')
  const { user } = resolved

  const access = accessState(user)
  if (access === 'blocked') return deny(403, 'BLOCKED', 'Учётная запись заблокирована администратором.')
  if (access === 'password') return deny(403, 'PASSWORD_CHANGE_REQUIRED', 'Сначала смените временный пароль.')
  if (access === 'license') return deny(403, 'LICENSE_REQUIRED', 'Нужен действующий ключ лицензии.')

  if (route.startsWith('/admin/api') || (route === '/ai-api/telemetry' && method === 'GET')) {
    if (user.role !== 'admin') return deny(403, 'ADMIN_ONLY', 'Только для администратора.')
  }
  const gate = FEATURE_BY_PREFIX.find(([p]) => route === p || route.startsWith(`${p}/`))
  if (gate && !user.features[gate[1]]) {
    return deny(403, 'FEATURE_DISABLED', 'Эта функция выключена администратором для вашей учётной записи.')
  }

  return pass({ id: user.id, role: user.role, legacy: user.legacyStore, sid })
}
