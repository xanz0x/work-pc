import { NextResponse, type NextRequest } from 'next/server'
import { issueToken, listTokens, revokeToken } from '@/lib/mcp-server'
import { TOKEN_TTL_OPTIONS, isScope, type Scope } from '@/lib/permissions'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Управление токенами из интерфейса. Маршрут закрыт сессией в proxy.ts. */

export const GET = withRoute('/mcp/admin/tokens', async () => NextResponse.json(await listTokens()))

export const POST = withRoute('/mcp/admin/tokens', async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown
    scopes?: unknown
    ttlHours?: unknown
  }
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter(isScope) : []
  const ttl = Number(body.ttlHours)
  if (scopes.length === 0 || !TOKEN_TTL_OPTIONS.some((o) => o.hours === ttl)) {
    return NextResponse.json(
      { code: 'INVALID_ARGS', error: 'Нужна хотя бы одна область и срок из списка.' },
      { status: 400 },
    )
  }
  const uniq = [...new Set(scopes)] as Scope[]
  const { token, view } = await issueToken(String(body.name ?? ''), uniq, ttl)
  /* Секрет показывается ровно один раз: на сервере остаётся только хеш. */
  return NextResponse.json({ token, view })
})

export const DELETE = withRoute('/mcp/admin/tokens', async (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const ok = /^[a-z0-9]{8}$/.test(id) && (await revokeToken(id))
  if (!ok) return NextResponse.json({ code: 'NOT_FOUND', error: 'Токен не найден или уже отозван.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
