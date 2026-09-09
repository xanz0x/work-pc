import { NextResponse, type NextRequest } from 'next/server'
import {
  approvalState,
  auditDenied,
  authenticate,
  requestApproval,
  runTool,
} from '@/lib/mcp-server'
import { TOOL_DEFS, validateArgs } from '@/app/mcp/tools'
import { allowedTools, hasScope, isDangerous, isToolName, type McpToolName } from '@/lib/permissions'
import { limitMcp } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ============================================================
   MCP · Streamable HTTP (NF-10)
   Один маршрут POST /mcp: JSON-RPC 2.0 без внешних библиотек. Ответы
   отдаются как application/json — спецификация это разрешает, а поток
   SSE здесь не нужен: ни один инструмент не стримит.
   Авторизация — только Bearer-токен с областями видимости. Сессия
   браузера сюда не пускает: у агента свой ключ, который можно отозвать.
   ============================================================ */

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

type RpcId = string | number | null
type RpcReq = { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> }

const rpcOk = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcErr = (id: RpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
})

const toolResult = (payload: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
  structuredContent: typeof payload === 'object' && payload !== null ? payload : undefined,
  isError,
})

const unauthorized = (code: string, status = 401) =>
  NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: code } },
    { status, headers: { 'WWW-Authenticate': 'Bearer realm="WorkSpaceX MCP"' } },
  )

export const GET = withRoute('/mcp', async () =>
  NextResponse.json(
    { code: 'METHOD_NOT_ALLOWED', error: 'MCP-сервер WorkSpaceX принимает только POST (Streamable HTTP).' },
    { status: 405, headers: { Allow: 'POST' } },
  ),
)

export const DELETE = withRoute('/mcp', async () => new Response(null, { status: 204 }))

export const POST = withRoute('/mcp', async (req: NextRequest) => {
  const auth = await authenticate(req.headers.get('authorization'))
  if (!auth.ok) return unauthorized(auth.code)
  const token = auth.token

  const wait = limitMcp(token.id)
  if (wait) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'RATE_LIMITED' } },
      { status: 429, headers: { 'Retry-After': String(wait) } },
    )
  }

  const body = (await req.json().catch(() => null)) as RpcReq | RpcReq[] | null
  if (!body) return NextResponse.json(rpcErr(null, -32700, 'Parse error'), { status: 400 })

  const reqs = Array.isArray(body) ? body : [body]
  const out: unknown[] = []
  for (const r of reqs) {
    const res = await handle(r, token.id, token.scopes)
    if (res !== undefined) out.push(res)
  }
  if (out.length === 0) return new Response(null, { status: 202 })
  return NextResponse.json(Array.isArray(body) ? out : out[0])

  async function handle(r: RpcReq, tokenId: string, scopes: typeof token.scopes): Promise<unknown> {
    const id = r.id ?? null
    const isNotification = r.id === undefined
    if (r.jsonrpc !== '2.0' || typeof r.method !== 'string') {
      return isNotification ? undefined : rpcErr(id, -32600, 'Invalid Request')
    }
    if (isNotification) return undefined
    const p = r.params ?? {}

    switch (r.method) {
      case 'initialize': {
        const asked = typeof p.protocolVersion === 'string' ? p.protocolVersion : ''
        return rpcOk(id, {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'WorkSpaceX', version: '1.0.0' },
          instructions:
            'Локальный сейф WorkSpaceX. Доступны только инструменты, разрешённые токеном. ' +
            'Запись секретов требует подтверждения владельца в интерфейсе: при ответе pending_approval ' +
            'повторите вызов с тем же approvalId после одобрения.',
        })
      }
      case 'ping':
        return rpcOk(id, {})
      case 'tools/list': {
        const names = allowedTools(scopes)
        return rpcOk(id, { tools: TOOL_DEFS.filter((t) => names.includes(t.name)) })
      }
      case 'tools/call': {
        const name = p.name
        const args = (p.arguments ?? {}) as Record<string, unknown>
        if (!isToolName(name)) return rpcOk(id, toolResult({ code: 'UNKNOWN_TOOL', tool: name }, true))
        return rpcOk(id, await callTool(name, args, tokenId))
      }
      default:
        return rpcErr(id, -32601, 'Method not found')
    }
  }

  async function callTool(name: McpToolName, args: Record<string, unknown>, tokenId: string) {
    if (!hasScope(token.scopes, name)) {
      await auditDenied(token, name, `Нет области ${name}: у токена ${token.scopes.join(', ') || 'ничего'}`)
      return toolResult({ code: 'SCOPE_DENIED', tool: name, need: name }, true)
    }
    const invalid = validateArgs(name, args)
    if (invalid) {
      await auditDenied(token, name, `Неверные аргументы: ${invalid}`)
      return toolResult({ code: 'INVALID_ARGS', detail: invalid }, true)
    }

    if (isDangerous(name)) {
      const approvalId = typeof args.approvalId === 'string' ? args.approvalId : null
      if (approvalId) {
        const st = approvalState(approvalId, tokenId)
        if (st.status === 'pending') return toolResult({ status: 'pending_approval', approvalId })
        if (st.status === 'approved' && st.result) {
          return toolResult(st.result.ok ? st.result.payload : { code: 'FAILED', detail: st.result.payload }, !st.result.ok)
        }
        if (st.status === 'rejected') return toolResult({ code: 'REJECTED', approvalId }, true)
        if (st.status === 'expired') return toolResult({ code: 'APPROVAL_EXPIRED', approvalId }, true)
        return toolResult({ code: 'APPROVAL_UNKNOWN', approvalId }, true)
      }
      const pending = await requestApproval(token, name, args)
      return toolResult({
        status: 'pending_approval',
        approvalId: pending.id,
        message:
          'Операция ждёт подтверждения владельца в WorkSpaceX (Настройки → MCP наружу). ' +
          'Повторите вызов с этим approvalId после одобрения.',
      })
    }

    try {
      const r = await runTool(token, name, args)
      return toolResult(r.ok ? r.payload : { code: 'FAILED', detail: r.payload }, !r.ok)
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN'
      const hint =
        code === 'NO_BRIDGE'
          ? 'Вкладка WorkSpaceX не открыта: данные сейфа живут в браузере владельца.'
          : 'Вкладка не ответила вовремя.'
      return toolResult({ code, detail: hint }, true)
    }
  }
})
