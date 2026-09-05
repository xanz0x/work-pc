import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { deleteFile, readFileBytes, renameFile } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** Скачать файл. ?inline=1 — показать в браузере (превью картинок). */
export const GET = withRoute('/ai-api/cloud/file/[id]', async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  try {
    const f = await readFileBytes(id)
    const inline = req.nextUrl.searchParams.get('inline') === '1'
    const disp = inline ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`
    return new Response(f.data, {
      status: 200,
      headers: {
        'Content-Type': f.contentType,
        'Content-Disposition': disp,
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (e) {
    return cloudError(e)
  }
})

/** { name } — переименовать. */
export const PATCH = withRoute('/ai-api/cloud/file/[id]', async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { name?: unknown }
  try {
    await renameFile(id, String(body.name ?? ''))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return cloudError(e)
  }
})

export const DELETE = withRoute('/ai-api/cloud/file/[id]', async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  try {
    await deleteFile(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return cloudError(e)
  }
})
