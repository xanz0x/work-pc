import { NextResponse, type NextRequest } from 'next/server'
import { getMcp, safeId, saveMcp } from '@/lib/ai-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: P) {
  const { id } = await params
  const m = await getMcp(safeId(id))
  if (!m) return NextResponse.json({ error: 'нет такого MCP-сервера' }, { status: 404 })
  const b = (await req.json()) as {
    host?: string
    port?: number
    enabled?: boolean
  }
  if (typeof b.host === 'string') m.host = b.host.trim().slice(0, 200)
  if (typeof b.port === 'number' && b.port > 0 && b.port < 65536) m.port = Math.round(b.port)
  if (typeof b.enabled === 'boolean') m.enabled = b.enabled
  /* Токен через API не принимается: он живёт только в окружении сервера. */
  await saveMcp(m)
  return NextResponse.json(m)
}

/** Действия скелета: проверка соединения и мок «вытянуть документ». */
export async function POST(req: NextRequest, { params }: P) {
  const { id } = await params
  const m = await getMcp(safeId(id))
  if (!m) return NextResponse.json({ error: 'нет такого MCP-сервера' }, { status: 404 })
  const b = (await req.json()) as { action?: string; query?: string }

  if (b.action === 'test') {
    if (!m.enabled) {
      return NextResponse.json({ ok: false, message: 'Сервер выключен — включите тумблер.' })
    }
    if (!m.host) {
      return NextResponse.json({ ok: false, message: 'Укажите адрес сервера (IP или хост).' })
    }
    return NextResponse.json({
      ok: true,
      mode: 'skeleton',
      latency: 40 + Math.round(Math.random() * 80),
      message: `Скелет ответил: ${m.host}:${m.port} принят. ${
        m.tokenSet
          ? 'Токен задан в окружении — реальное соединение появится вместе с клиентом MCP.'
          : 'Токен в окружении не задан (MCP_NOTION_TOKEN) — ответы остаются макетом.'
      }`,
    })
  }

  if (b.action === 'pull') {
    if (!m.enabled) {
      return NextResponse.json({
        ok: false,
        error: 'MCP-сервер Notion выключен. Включите его в AI-центре.',
      })
    }
    const q = (b.query ?? 'документ').slice(0, 120)
    return NextResponse.json({
      ok: true,
      mock: true,
      doc: {
        title: `Notion · ${q}`,
        url: `https://notion.so/mock/${encodeURIComponent(q.replace(/\s+/g, '-')).slice(0, 60)}`,
        excerpt: `Это макет документа «${q}» из скелета MCP. Реальное содержимое появится после подключения токена Notion${m.host ? ` (сервер ${m.host}:${m.port})` : ''}.`,
        updated: new Date().toISOString(),
      },
    })
  }

  return NextResponse.json({ error: 'неизвестное действие' }, { status: 400 })
}
