import { NextResponse, type NextRequest } from 'next/server'
import AdmZip from 'adm-zip'
import { withRoute } from '@/lib/route-log'
import { readFileBytes } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Мини-роут предпросмотра ZIP-архивов общего диска.
 * POST { objectId } — список содержимого архива;
 * POST { objectId, entry } — содержимое выбранного файла из архива.
 * adm-zip в браузере недоступен, поэтому распаковка живёт на сервере:
 * байты архива читаются существующим объектным роутом (cloud-store).
 */

/** Верхний предел распаковываемой записи: просмотр не должен читать гигабайты. */
const MAX_ENTRY_BYTES = 25 * 1024 * 1024
const MAX_ENTRIES = 2000

const MIME: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const extMime = (name: string): string => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'

type Body = { objectId?: unknown; entry?: unknown }

export const POST = withRoute('/ai-api/cloud/zip', async (req: NextRequest) => {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Тело запроса не является корректным JSON.' }, { status: 400 })
  }
  const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : ''
  if (!objectId) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Не указан идентификатор объекта.' }, { status: 400 })
  }

  try {
    const f = await readFileBytes(objectId)
    const zip = new AdmZip(Buffer.from(f.data))

    /* Без entry — список содержимого: имя, папка, размер, каталог это или файл. */
    const entry = typeof body.entry === 'string' ? body.entry : ''
    if (!entry) {
      const entries = zip
        .getEntries()
        .slice(0, MAX_ENTRIES)
        .map((e) => ({
          name: e.entryName,
          dir: e.isDirectory,
          size: e.header.size,
        }))
      return NextResponse.json(
        { ok: true, name: f.name, truncated: zip.getEntries().length > MAX_ENTRIES, entries },
      )
    }

    /* С entry — содержимое выбранной записи. Имя берётся как есть:
       getEntry ищет внутри архива, наружу путь не выходит. */
    const picked = zip.getEntry(entry)
    if (!picked || picked.isDirectory) {
      return NextResponse.json({ code: 'NOT_FOUND', error: 'Запись в архиве не найдена.' }, { status: 404 })
    }
    if (picked.header.size > MAX_ENTRY_BYTES) {
      return NextResponse.json(
        { code: 'INVALID_ARGS', error: 'Файл внутри архива больше 25 МБ — предпросмотр недоступен.' },
        { status: 413 },
      )
    }
    const data = picked.getData()
    const base = picked.entryName.split('/').pop() || 'file'
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': extMime(base),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(base)}`,
        'X-Entry-Name': encodeURIComponent(picked.entryName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    return cloudError(e)
  }
})
