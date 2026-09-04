import { NextResponse, type NextRequest } from 'next/server'
import {
  authFromHeaders,
  isDeviceId,
  isSealed,
  isSpaceId,
  listDevices,
  registerDevice,
  revokeDevice,
} from '@/lib/sync-server'
import { ownerOf } from '@/lib/mcp-server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Устройства пространства синхронизации. Маршрут закрыт сессией (proxy.ts),
   а внутри — ещё и токеном устройства: сессия общая на весь сейф, токен — свой. */

const syncAuth = (req: NextRequest) => authFromHeaders(ownerOf(requireUser()), req.headers)

const deny = () => NextResponse.json({ code: 'SYNC_AUTH', error: 'Устройство не опознано или отозвано.' }, { status: 403 })

export const POST = withRoute('/sync/devices', async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (!isSpaceId(b.spaceId) || !isDeviceId(b.deviceId) || typeof b.spacePass !== 'string' || !isSealed(b.label)) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Неверная форма запроса.' }, { status: 400 })
  }
  if (!/^[a-f0-9]{64}$/.test(b.spacePass)) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Неверная форма запроса.' }, { status: 400 })
  }
  const r = await registerDevice(ownerOf(requireUser()), b.spaceId, b.spacePass, b.deviceId, b.label)
  if (!r.ok) return NextResponse.json({ code: r.code, error: 'Фраза не подходит к этому пространству.' }, { status: 403 })
  return NextResponse.json({ token: r.token, created: r.created })
})

export const GET = withRoute('/sync/devices', async (req: NextRequest) => {
  const auth = await syncAuth(req)
  if (!auth) return deny()
  return NextResponse.json({ devices: listDevices(auth.space), self: auth.device.id })
})

export const DELETE = withRoute('/sync/devices', async (req: NextRequest) => {
  const auth = await syncAuth(req)
  if (!auth) return deny()
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const ok = isDeviceId(id) && (await revokeDevice(auth.space, id))
  if (!ok) return NextResponse.json({ code: 'NOT_FOUND', error: 'Устройство не найдено или уже отозвано.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
