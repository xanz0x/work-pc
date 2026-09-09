/* ============================================================
   ПОЧТА · прокси картинок писем (/ai-api/mail/img)
   iframe письма — sandbox без allow-same-origin (opaque origin),
   часть CDN отдаёт 403 на запросы без Referer/null-origin. Прокси
   качает картинку серверно и отдаёт клиенту. Защита:
   • только http(s);
   • приватные диапазоны IP запрещены (SSRF);
   • лимит размера (8 МБ) и таймаут;
   • кэш в памяти не храним — поток напрямую;
   • Content-Type только image/*.
   Доступ — как у остальных почтовых маршрутов (сессия обязательна).
   ============================================================ */

import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import net from 'node:net'
import dns from 'node:dns/promises'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 15_000

function isPrivateIp(ip: string): boolean {
  const v4 = net.isIPv4(ip)
    ? ip.split('.').map(Number)
    : null
  if (v4) {
    if (v4[0] === 10 || v4[0] === 127 || (v4[0] === 192 && v4[1] === 168)) return true
    if (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) return true
    if (v4[0] === 169 && v4[1] === 254) return true
    if (v4[0] === 0 || v4[0] >= 224) return true
    return false
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase()
    if (low === '::1' || low === '::' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80')) return true
    if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7))
  }
  return false
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (isPrivateIp(hostname)) throw new Error('private')
  const addrs = await dns.lookup(hostname, { all: true })
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('private')
}

export const GET = withRoute('/ai-api/mail/img', async (req: NextRequest) => {
  const raw = req.nextUrl.searchParams.get('url') ?? ''
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Некорректный адрес картинки.' }, { status: 400 })
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Только http(s)-картинки.' }, { status: 400 })
  }
  try {
    await assertPublicHost(u.hostname)
  } catch {
    return NextResponse.json({ code: 'FORBIDDEN', error: 'Локальные адреса запрещены.' }, { status: 403 })
  }
  try {
    const upstream = await fetch(u, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'WorkSpaceX Mail/1.0', accept: 'image/*' },
    })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ code: 'PROVIDER', error: `Источник ответил ${upstream.status}.` }, { status: 502 })
    }
    const type = upstream.headers.get('content-type') ?? 'application/octet-stream'
    if (!type.startsWith('image/')) {
      return NextResponse.json({ code: 'PROVIDER', error: 'Источник вернул не картинку.' }, { status: 502 })
    }
    const buf = await upstream.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ code: 'PROVIDER', error: 'Картинка больше 8 МБ.' }, { status: 502 })
    }
    return new NextResponse(buf, {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' },
    })
  } catch {
    return NextResponse.json({ code: 'PROVIDER', error: 'Не удалось загрузить картинку.' }, { status: 502 })
  }
})
