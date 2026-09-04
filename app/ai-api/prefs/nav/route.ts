import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse, type NextRequest } from 'next/server'
import { NAV_DEFAULT, normalizeNavPrefs } from '@/lib/nav-prefs'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { userDir } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function navFile(): string {
  const u = requireUser()
  return path.join(userDir(u.uid, u.legacy), 'nav.json')
}

/** Порядок и скрытые пункты бокового меню — своё у каждого пользователя. */
export const GET = withRoute('/ai-api/prefs/nav', async () => {
  try {
    const raw = await fs.readFile(navFile(), 'utf8')
    return NextResponse.json(normalizeNavPrefs(JSON.parse(raw)))
  } catch {
    return NextResponse.json(NAV_DEFAULT)
  }
})

export const PUT = withRoute('/ai-api/prefs/nav', async (req: NextRequest) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', error: 'тело запроса не JSON' }, { status: 400 })
  }
  const prefs = normalizeNavPrefs(body)
  const p = navFile()
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `${JSON.stringify(prefs, null, 2)}\n`, 'utf8')
  return NextResponse.json(prefs)
})
