import { NextResponse, type NextRequest } from 'next/server'
import { deleteToken, issueToken, listTokens, ownerOf, purgeInactiveTokens, revokeToken } from '@/lib/mcp-server'
import { requireUser } from '@/lib/request-context'
import { TOKEN_TTL_OPTIONS, isScope, type Scope } from '@/lib/permissions'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Управление токенами из интерфейса. Маршрут закрыт сессией в proxy.ts. */

export const GET = withRoute('/mcp/admin/tokens', async () => NextResponse.json(await listTokens(ownerOf(requireUser()))))

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
  const { token, view } = await issueToken(ownerOf(requireUser()), String(body.name ?? ''), uniq, ttl)
  /* Секрет показывается ровно один раз: на сервере остаётся только хеш. */
  return NextResponse.json({ token, view })
})

/**
 * DELETE ?id=…            — отозвать (запись остаётся в списке как «отозван»);
 * DELETE ?id=…&purge=1    — стереть запись целиком;
 * DELETE ?inactive=1      — убрать все отозванные и истёкшие.
 */
export const DELETE = withRoute('/mcp/admin/tokens', async (req: NextRequest) => {
  const q = req.nextUrl.searchParams
  const owner = ownerOf(requireUser())
  if (q.get('inactive') === '1') {
    return NextResponse.json({ ok: true, removed: await purgeInactiveTokens(owner) })
  }
  const id = q.get('id') ?? ''
  if (!/^[a-z0-9]{8}$/.test(id)) {
    return NextResponse.json({ code: 'NOT_FOUND', error: 'Токен не найден.' }, { status: 404 })
  }
  const ok = q.get('purge') === '1' ? await deleteToken(owner, id) : await revokeToken(owner, id)
  if (!ok) return NextResponse.json({ code: 'NOT_FOUND', error: 'Токен не найден или уже отозван.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
