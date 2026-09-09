import { NextResponse, type NextRequest } from 'next/server'
import { getMcp, safeId, saveMcp } from '@/lib/ai-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

/**
 * RM-3: пометка макета едет в КАЖДОМ ответе скелета.
 * Клиент рисует плашку по этому признаку, а не по имени скилла, — если
 * когда-нибудь появится настоящий клиент MCP, плашка исчезнет сама.
 */
const MOCK_NOTICE = 'макет, не реальные данные'

function mock(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ...body, mock: true, notice: MOCK_NOTICE }, { status })
}

export const PUT = withRoute('/ai-api/mcp/[id]', async (req: NextRequest, { params }: P) => {
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
})

/**
 * Действия скелета: проверка соединения и макет «вытянуть документ».
 * Настоящей сети здесь нет — поэтому нет ни правдоподобных ссылок, ни
 * выдуманной задержки: имитировать признаки живого сервиса значит врать
 * человеку о том, чего в продукте пока не существует.
 */
export const POST = withRoute('/ai-api/mcp/[id]', async (req: NextRequest, { params }: P) => {
  const { id } = await params
  const m = await getMcp(safeId(id))
  if (!m) return NextResponse.json({ error: 'нет такого MCP-сервера' }, { status: 404 })
  const b = (await req.json()) as { action?: string; query?: string }

  if (b.action === 'test') {
    if (!m.enabled) {
      return mock({ ok: false, message: 'Сервер выключен — включите тумблер.' })
    }
    if (!m.host) {
      return mock({ ok: false, message: 'Укажите адрес сервера (IP или хост).' })
    }
    return mock({
      ok: true,
      mode: 'skeleton',
      /* Соединения не было: сообщать «latency 73 мс» — выдумка. */
      message: `Настройки приняты: ${m.host}:${m.port}. Соединение НЕ проверялось — клиента MCP в сборке ещё нет. ${
        m.tokenSet
          ? 'Токен задан в окружении сервера.'
          : 'Токен в окружении не задан (MCP_NOTION_TOKEN).'
      }`,
    })
  }

  if (b.action === 'pull') {
    if (!m.enabled) {
      return mock({
        ok: false,
        error: 'MCP-сервер Notion выключен. Включите его в AI-центре.',
      })
    }
    const q = (b.query ?? 'документ').slice(0, 120)
    return mock({
      ok: true,
      source: 'skeleton',
      doc: {
        title: `Макет ответа на запрос «${q}»`,
        /* Схема mock:// вместо notion.so — по такой ссылке некуда пойти,
           и её нельзя перепутать с настоящим документом. */
        url: `mock://notion/${encodeURIComponent(q.replace(/\s+/g, '-')).slice(0, 60)}`,
        excerpt: `Документа с таким содержимым не существует: это заглушка скелета MCP${
          m.host ? ` (сервер ${m.host}:${m.port} записан в настройках, но не опрашивался)` : ''
        }. Реальный текст появится вместе с клиентом MCP и токеном Notion.`,
      },
    })
  }

  return NextResponse.json({ error: 'неизвестное действие' }, { status: 400 })
})
