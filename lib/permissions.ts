/* ============================================================
   РАЗРЕШЕНИЯ MCP (NF-10)
   Единственное место, где решается «что можно внешнему агенту»:
   области видимости токена, соответствие инструмент → область и список
   опасных операций, которые не выполняются без подтверждения в UI.
   Модуль чистый (без Node-API): его читают и сервер, и интерфейс.
   ============================================================ */

export type Scope = 'search' | 'read' | 'notes:write' | 'secrets:write'

export const SCOPES: { id: Scope; label: string; note: string; dangerous: boolean }[] = [
  { id: 'search', label: 'Поиск', note: 'Искать по сейфу: имена, метки, заголовки', dangerous: false },
  { id: 'read', label: 'Метаданные', note: 'Читать сведения о файлах и стикерах — без содержимого', dangerous: false },
  { id: 'notes:write', label: 'Стикеры', note: 'Создавать стикеры', dangerous: false },
  {
    id: 'secrets:write',
    label: 'Запись секретов',
    note: 'Создавать записи в менеджере секретов — каждая требует подтверждения в интерфейсе',
    dangerous: true,
  },
]

export type McpToolName = 'search' | 'get_metadata' | 'list_files' | 'create_sticker' | 'create_secret'

export const TOOL_SCOPE: Record<McpToolName, Scope> = {
  search: 'search',
  get_metadata: 'read',
  list_files: 'read',
  create_sticker: 'notes:write',
  create_secret: 'secrets:write',
}

export const TOOL_NAMES = Object.keys(TOOL_SCOPE) as McpToolName[]

export function isToolName(v: unknown): v is McpToolName {
  return typeof v === 'string' && v in TOOL_SCOPE
}

export function isScope(v: unknown): v is Scope {
  return typeof v === 'string' && SCOPES.some((s) => s.id === v)
}

/** Опасная операция: выполняется только после явного одобрения человеком. */
export function isDangerous(tool: McpToolName): boolean {
  return SCOPES.find((s) => s.id === TOOL_SCOPE[tool])?.dangerous === true
}

export function allowedTools(scopes: readonly Scope[]): McpToolName[] {
  return TOOL_NAMES.filter((t) => scopes.includes(TOOL_SCOPE[t]))
}

export function hasScope(scopes: readonly Scope[], tool: McpToolName): boolean {
  return scopes.includes(TOOL_SCOPE[tool])
}

/* ---------- токены ---------- */

export const TOKEN_TTL_OPTIONS: { label: string; hours: number }[] = [
  { label: '1 час', hours: 1 },
  { label: '24 часа', hours: 24 },
  { label: '7 дней', hours: 24 * 7 },
  { label: '30 дней', hours: 24 * 30 },
]

/** То, что видит интерфейс: секрета здесь нет ни в каком виде. */
export type TokenView = {
  id: string
  name: string
  scopes: Scope[]
  createdAt: number
  expiresAt: number
  revokedAt: number | null
  lastUsedAt: number | null
  calls: number
}

export type TokenStatus = 'active' | 'expired' | 'revoked'

export function tokenStatus(t: TokenView, now = Date.now()): TokenStatus {
  if (t.revokedAt) return 'revoked'
  if (t.expiresAt <= now) return 'expired'
  return 'active'
}

const PREFIX = 'wsx'

/** `wsx_<id>_<secret>`: id открыт, чтобы найти запись; секрет сравнивается по хешу. */
export function formatToken(id: string, secret: string): string {
  return `${PREFIX}_${id}_${secret}`
}

export function parseToken(raw: string | null | undefined): { id: string; secret: string } | null {
  if (!raw) return null
  const m = /^wsx_([a-z0-9]{8})_([a-f0-9]{48})$/.exec(raw.trim())
  return m ? { id: m[1], secret: m[2] } : null
}

const enc = new TextEncoder()

export async function hashSecret(secret: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`wsx-token.${secret}`))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Новый токен: id из 8 знаков, секрет — 24 случайных байта. */
export function newTokenParts(): { id: string; secret: string } {
  const idBytes = crypto.getRandomValues(new Uint8Array(6))
  const id = hex(idBytes).slice(0, 8)
  const secret = hex(crypto.getRandomValues(new Uint8Array(24)))
  return { id, secret }
}

/* ---------- ожидающие подтверждения ---------- */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

/** Время, за которое человек должен ответить на запрос агента. */
export const APPROVAL_TTL_MS = 10 * 60_000

export type PendingView = {
  id: string
  tool: McpToolName
  /** Только безопасная сводка аргументов: заголовок, тип, имена полей. */
  summary: string
  tokenName: string
  createdAt: number
  status: ApprovalStatus
}

/** Сводка для журнала и списка подтверждений: без значений секретных полей. */
export function summarizeArgs(tool: McpToolName, args: Record<string, unknown>): string {
  const title = typeof args.title === 'string' ? args.title.slice(0, 80) : ''
  if (tool === 'create_secret') {
    const type = typeof args.type === 'string' ? args.type : 'login'
    const fields = Array.isArray(args.fields)
      ? (args.fields as { name?: unknown }[]).map((f) => String(f?.name ?? '?')).slice(0, 8)
      : []
    return `${type} · «${title || 'без названия'}» · поля: ${fields.join(', ') || '—'}`
  }
  if (tool === 'create_sticker') return `«${title || 'без названия'}»`
  if (tool === 'search') return `запрос ${String(args.query ?? '').length} симв.`
  if (tool === 'get_metadata') return `id ${String(args.id ?? '')}`.slice(0, 60)
  return ''
}
