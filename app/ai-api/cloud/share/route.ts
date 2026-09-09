import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { CloudError, shareFile, shareNote } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** sourceId — локальный id, область владельца задаётся серверной сессией. */
export const POST = withRoute('/ai-api/cloud/share', async (req: NextRequest) => {
  try {
    let saved
    if (req.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await req.formData()
      const sourceId = form.get('sourceId')
      const file = form.get('file')
      if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 300 || sourceId.startsWith('cloud:') || !(file instanceof File)) {
        throw new CloudError('INVALID_ARGS', 'Укажите оригинал файла.')
      }
      saved = await shareFile(sourceId, file.name, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream')
    } else {
      const body = await req.json().catch(() => null)
      if (!body || body.kind !== 'note' || typeof body.sourceId !== 'string' || !body.sourceId.trim() || body.sourceId.length > 300 || body.sourceId.startsWith('cloud:') ||
        typeof body.title !== 'string' || !body.title.trim() || body.title.length > 1000 || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 200_000 ||
        !Array.isArray(body.tags) || body.tags.length > 100 || body.tags.some((t: unknown) => typeof t !== 'string' || t.length > 200)) {
        throw new CloudError('INVALID_ARGS', 'Некорректные данные заметки.')
      }
      saved = await shareNote(body.sourceId, { title: body.title, body: body.body, tags: [...new Set<string>(body.tags)] })
    }
    const { path: _path, ...file } = saved
    return NextResponse.json({ file }, { status: 201 })
  } catch (e) {
    return cloudError(e)
  }
})