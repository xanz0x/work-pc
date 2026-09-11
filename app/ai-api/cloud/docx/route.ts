import { NextResponse, type NextRequest } from 'next/server'
import mammoth from 'mammoth'
import { withRoute } from '@/lib/route-log'
import { cloudError } from '@/lib/cloud-route'
import { readFileBytes } from '@/lib/cloud-store'
import { sanitizeMailHtml } from '@/lib/mail-html'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024

/**
 * { objectId } → { html } · предпросмотр .docx прямо в программе.
 * Разметку делает mammoth на сервере (в браузере распаковать docx нечем),
 * результат прогоняем через тот же санитайзер, что и письма: наружу уходит
 * только текст, заголовки, списки и таблицы.
 */
export const POST = withRoute('/ai-api/cloud/docx', async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as { objectId?: unknown } | null
    const objectId = typeof body?.objectId === 'string' ? body.objectId.trim() : ''
    if (!objectId) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Не указан objectId.' }, { status: 400 })

    const { data } = await readFileBytes(objectId)
    if (data.byteLength > MAX_BYTES) {
      return NextResponse.json({ code: 'INVALID_ARGS', error: 'Документ больше 25 МБ — откройте его на ПК.' }, { status: 400 })
    }
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(data) })
    return NextResponse.json({ html: sanitizeMailHtml(String(result?.value ?? '')) })
  } catch (e) {
    return cloudError(e)
  }
})
