import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { createFolder, removeFolder } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** { parent, name } — создать папку внутри parent. */
export const POST = withRoute('/ai-api/cloud/folder', async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { parent?: unknown; name?: unknown }
  try {
    await createFolder(String(body.parent ?? ''), String(body.name ?? ''))
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    return cloudError(e)
  }
})

/** { path } — удалить папку с содержимым. */
export const DELETE = withRoute('/ai-api/cloud/folder', async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { path?: unknown }
  try {
    await removeFolder(String(body.path ?? ''))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return cloudError(e)
  }
})
