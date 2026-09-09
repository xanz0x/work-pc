import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { uploadFile } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** multipart/form-data: file (обязателен), dir (папка назначения). */
export const POST = withRoute('/ai-api/cloud/upload', async (req: NextRequest) => {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Файл не передан.' }, { status: 400 })
    const dir = String(form.get('dir') ?? '')
    const data = new Uint8Array(await file.arrayBuffer())
    const saved = await uploadFile(file.name, dir, data, file.type || 'application/octet-stream')
    const { path: _p, ...view } = saved
    void _p
    return NextResponse.json({ file: view }, { status: 201 })
  } catch (e) {
    return cloudError(e)
  }
})
