/* ============================================================
   MCP-СЕРВЕР НАРУЖУ · серверное состояние (NF-10)
   Токены и аудит лежат на диске рядом со скиллами (AI_DIR/mcp-access),
   очередь заданий и ожидающие подтверждения — в памяти процесса.

   Данные сейфа живут в браузере (IndexedDB), а не на сервере, поэтому
   сервер сам ничего не ищет и не пишет: он ставит задание в очередь, а
   открытая вкладка WorkSpaceX («мост») выполняет его и возвращает ответ.
   Без открытой вкладки внешний агент получает честную ошибку, а не пустоту.
   ============================================================ */

import { promises as fs } from 'fs'
import path from 'path'
import { equalConst } from './app-auth'
import { log } from './log'
import {
  APPROVAL_TTL_MS,
  formatToken,
  hashSecret,
  newTokenParts,
  parseToken,
  summarizeArgs,
  type ApprovalStatus,
  type McpToolName,
  type PendingView,
  type Scope,
  type TokenView,
} from './permissions'

const ROOT = path.join(process.env.AI_DIR?.trim() || path.join(process.cwd(), 'ai'), 'mcp-access')
const TOKENS_FILE = path.join(ROOT, 'tokens.json')
const AUDIT_FILE = path.join(ROOT, 'audit.jsonl')
const CURSOR_FILE = path.join(ROOT, 'cursor.json')

/** Сколько ждём ответа вкладки на одно задание. */
export const JOB_TIMEOUT_MS = 25_000
/** Вкладка считается подключённой, если опрашивала мост недавно. */
const BRIDGE_ALIVE_MS = 30_000

type TokenRecord = TokenView & { hash: string }

export type AuditKind = 'call' | 'denied' | 'token-issued' | 'token-revoked' | 'approval'

export type AuditEntry = {
  seq: number
  at: number
  kind: AuditKind
  tokenId: string | null
  tokenName: string
  tool: McpToolName | null
  ok: boolean
  detail: string
}

export type Job = {
  id: string
  tool: McpToolName
  args: Record<string, unknown>
  tokenName: string
}

type Pending = PendingView & {
  args: Record<string, unknown>
  tokenId: string
  result?: { ok: boolean; payload: unknown }
}

type Waiter = { resolve: (v: { ok: boolean; payload: unknown }) => void; timer: NodeJS.Timeout }

type State = {
  loaded: boolean
  tokens: TokenRecord[]
  audit: AuditEntry[]
  auditSeq: number
  deliveredSeq: number
  queue: Job[]
  waiters: Map<string, Waiter>
  pending: Map<string, Pending>
  bridgeWake: (() => void)[]
  lastBridgeAt: number
}

/* Одно состояние на процесс: маршруты Next компилируются в разные модули,
   поэтому держим его на globalThis, как принято для singletons в Node. */
const g = globalThis as unknown as { __wsxMcp?: State }
const S: State = (g.__wsxMcp ??= {
  loaded: false,
  tokens: [],
  audit: [],
  auditSeq: 0,
  deliveredSeq: 0,
  queue: [],
  waiters: new Map(),
  pending: new Map(),
  bridgeWake: [],
  lastBridgeAt: 0,
})

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function load(): Promise<void> {
  if (S.loaded) return
  await fs.mkdir(ROOT, { recursive: true })
  S.tokens = await readJson<TokenRecord[]>(TOKENS_FILE, [])
  const cursor = await readJson<{ deliveredSeq: number }>(CURSOR_FILE, { deliveredSeq: 0 })
  S.deliveredSeq = cursor.deliveredSeq
  try {
    const lines = (await fs.readFile(AUDIT_FILE, 'utf8')).split('\n').filter(Boolean)
    S.audit = lines.map((l) => JSON.parse(l) as AuditEntry)
  } catch {
    S.audit = []
  }
  S.auditSeq = S.audit.reduce((m, e) => Math.max(m, e.seq), 0)
  S.loaded = true
}

async function saveTokens(): Promise<void> {
  await fs.writeFile(TOKENS_FILE, `${JSON.stringify(S.tokens, null, 2)}\n`, 'utf8')
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function wakeBridge(): void {
  const list = S.bridgeWake.splice(0)
  for (const fn of list) fn()
}

/* ---------- аудит ---------- */

async function audit(e: Omit<AuditEntry, 'seq' | 'at'>): Promise<void> {
  await load()
  const entry: AuditEntry = { ...e, seq: ++S.auditSeq, at: Date.now() }
  S.audit.push(entry)
  if (S.audit.length > 2000) S.audit.splice(0, S.audit.length - 2000)
  try {
    await fs.appendFile(AUDIT_FILE, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    log('error', 'mcp.audit-failed', { reason: err instanceof Error ? err.message : 'неизвестно' })
  }
  log(e.ok ? 'info' : 'warn', `mcp.${e.kind}`, { where: e.tool ?? undefined, code: e.tokenId ?? undefined })
  wakeBridge()
}

/* ---------- токены ---------- */

function view(t: TokenRecord): TokenView {
  const { hash: _hash, ...rest } = t
  void _hash
  return rest
}

export async function listTokens(): Promise<TokenView[]> {
  await load()
  return S.tokens.map(view).sort((a, b) => b.createdAt - a.createdAt)
}

export async function issueToken(
  name: string,
  scopes: Scope[],
  ttlHours: number,
): Promise<{ token: string; view: TokenView }> {
  await load()
  const { id, secret } = newTokenParts()
  const now = Date.now()
  const rec: TokenRecord = {
    id,
    name: name.trim().slice(0, 60) || 'Без имени',
    scopes,
    createdAt: now,
    expiresAt: now + ttlHours * 3_600_000,
    revokedAt: null,
    lastUsedAt: null,
    calls: 0,
    hash: await hashSecret(secret),
  }
  S.tokens.push(rec)
  await saveTokens()
  await audit({
    kind: 'token-issued',
    tokenId: id,
    tokenName: rec.name,
    tool: null,
    ok: true,
    detail: `Области: ${scopes.join(', ')} · срок ${ttlHours} ч`,
  })
  return { token: formatToken(id, secret), view: view(rec) }
}

export async function revokeToken(id: string): Promise<boolean> {
  await load()
  const rec = S.tokens.find((t) => t.id === id)
  if (!rec || rec.revokedAt) return false
  rec.revokedAt = Date.now()
  await saveTokens()
  await audit({
    kind: 'token-revoked',
    tokenId: id,
    tokenName: rec.name,
    tool: null,
    ok: true,
    detail: 'Токен отозван владельцем: дальнейшие вызовы отклоняются',
  })
  return true
}

export type AuthResult =
  | { ok: true; token: TokenView }
  | { ok: false; code: 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_REVOKED' }

/** Проверка Bearer-токена. Каждый провал — запись в аудит. */
export async function authenticate(header: string | null): Promise<AuthResult> {
  await load()
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!raw) return { ok: false, code: 'TOKEN_MISSING' }
  const parsed = parseToken(raw)
  const rec = parsed ? S.tokens.find((t) => t.id === parsed.id) : undefined
  if (!parsed || !rec || !equalConst(rec.hash, await hashSecret(parsed.secret))) {
    await audit({
      kind: 'denied',
      tokenId: parsed?.id ?? null,
      tokenName: rec?.name ?? 'неизвестный',
      tool: null,
      ok: false,
      detail: 'Токен не распознан',
    })
    return { ok: false, code: 'TOKEN_INVALID' }
  }
  if (rec.revokedAt) {
    await audit({ kind: 'denied', tokenId: rec.id, tokenName: rec.name, tool: null, ok: false, detail: 'Токен отозван' })
    return { ok: false, code: 'TOKEN_REVOKED' }
  }
  if (rec.expiresAt <= Date.now()) {
    await audit({ kind: 'denied', tokenId: rec.id, tokenName: rec.name, tool: null, ok: false, detail: 'Срок токена истёк' })
    return { ok: false, code: 'TOKEN_EXPIRED' }
  }
  return { ok: true, token: view(rec) }
}

async function touch(tokenId: string): Promise<void> {
  const rec = S.tokens.find((t) => t.id === tokenId)
  if (!rec) return
  rec.lastUsedAt = Date.now()
  rec.calls += 1
  await saveTokens().catch(() => {})
}

export async function auditDenied(token: TokenView, tool: McpToolName, detail: string): Promise<void> {
  await audit({ kind: 'denied', tokenId: token.id, tokenName: token.name, tool, ok: false, detail })
}

/* ---------- очередь заданий для вкладки ---------- */

export function bridgeAlive(): boolean {
  return S.bridgeWake.length > 0 || Date.now() - S.lastBridgeAt < BRIDGE_ALIVE_MS
}

/**
 * Выполнить инструмент через открытую вкладку. Возвращает результат
 * или бросает код ошибки: NO_BRIDGE (вкладка не открыта) / BRIDGE_TIMEOUT.
 */
export async function runTool(
  token: TokenView,
  tool: McpToolName,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; payload: unknown }> {
  await load()
  if (!bridgeAlive()) {
    await audit({
      kind: 'call',
      tokenId: token.id,
      tokenName: token.name,
      tool,
      ok: false,
      detail: `${summarizeArgs(tool, args)} · вкладка WorkSpaceX не открыта`,
    })
    throw new Error('NO_BRIDGE')
  }
  const job: Job = { id: uid('job'), tool, args, tokenName: token.name }
  const result = await new Promise<{ ok: boolean; payload: unknown }>((resolve) => {
    const timer = setTimeout(() => {
      S.waiters.delete(job.id)
      S.queue = S.queue.filter((j) => j.id !== job.id)
      resolve({ ok: false, payload: 'BRIDGE_TIMEOUT' })
    }, JOB_TIMEOUT_MS)
    S.waiters.set(job.id, { resolve, timer })
    S.queue.push(job)
    wakeBridge()
  })
  await touch(token.id)
  await audit({
    kind: 'call',
    tokenId: token.id,
    tokenName: token.name,
    tool,
    ok: result.ok,
    detail: result.ok
      ? summarizeArgs(tool, args)
      : `${summarizeArgs(tool, args)} · ошибка: ${String(result.payload).slice(0, 120)}`,
  })
  if (!result.ok && result.payload === 'BRIDGE_TIMEOUT') throw new Error('BRIDGE_TIMEOUT')
  return result
}

export type BridgePoll = {
  jobs: Job[]
  audit: AuditEntry[]
  pending: PendingView[]
  serverAt: number
}

/** Опрос моста: отдаём сразу, если есть работа, иначе ждём до `waitMs`. */
export async function bridgePoll(waitMs: number): Promise<BridgePoll> {
  await load()
  S.lastBridgeAt = Date.now()
  expirePending()
  const hasWork = () => S.queue.length > 0 || S.auditSeq > S.deliveredSeq
  if (!hasWork() && waitMs > 0) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        S.bridgeWake = S.bridgeWake.filter((f) => f !== wake)
        resolve()
      }, waitMs)
      const wake = () => {
        clearTimeout(t)
        resolve()
      }
      S.bridgeWake.push(wake)
    })
    S.lastBridgeAt = Date.now()
  }
  const jobs = S.queue.splice(0)
  const fresh = S.audit.filter((e) => e.seq > S.deliveredSeq)
  if (fresh.length) {
    S.deliveredSeq = S.auditSeq
    await fs.writeFile(CURSOR_FILE, JSON.stringify({ deliveredSeq: S.deliveredSeq }), 'utf8').catch(() => {})
  }
  return { jobs, audit: fresh, pending: listPending(), serverAt: Date.now() }
}

export function bridgeResult(jobId: string, ok: boolean, payload: unknown): boolean {
  const w = S.waiters.get(jobId)
  if (!w) return false
  clearTimeout(w.timer)
  S.waiters.delete(jobId)
  w.resolve({ ok, payload })
  return true
}

/* ---------- подтверждения опасных операций ---------- */

function expirePending(): void {
  const now = Date.now()
  for (const p of S.pending.values()) {
    if (p.status === 'pending' && now - p.createdAt > APPROVAL_TTL_MS) p.status = 'expired'
    if (now - p.createdAt > APPROVAL_TTL_MS * 3) S.pending.delete(p.id)
  }
}

function pendingView(p: Pending): PendingView {
  return { id: p.id, tool: p.tool, summary: p.summary, tokenName: p.tokenName, createdAt: p.createdAt, status: p.status }
}

export function listPending(): PendingView[] {
  expirePending()
  return [...S.pending.values()].filter((p) => p.status === 'pending').map(pendingView)
}

/** Агент просит опасную операцию: заводим запрос и ждём человека. */
export async function requestApproval(
  token: TokenView,
  tool: McpToolName,
  args: Record<string, unknown>,
): Promise<PendingView> {
  await load()
  const p: Pending = {
    id: uid('appr'),
    tool,
    args,
    summary: summarizeArgs(tool, args),
    tokenName: token.name,
    tokenId: token.id,
    createdAt: Date.now(),
    status: 'pending',
  }
  S.pending.set(p.id, p)
  await touch(token.id)
  await audit({
    kind: 'approval',
    tokenId: token.id,
    tokenName: token.name,
    tool,
    ok: true,
    detail: `Запрошено подтверждение: ${p.summary}`,
  })
  return pendingView(p)
}

/** Повторный вызов агента с approvalId: узнаём судьбу запроса. */
export function approvalState(
  id: string,
  tokenId: string,
): { status: ApprovalStatus | 'unknown'; result?: { ok: boolean; payload: unknown } } {
  expirePending()
  const p = S.pending.get(id)
  if (!p || p.tokenId !== tokenId) return { status: 'unknown' }
  return { status: p.status, result: p.result }
}

/** Задание для вкладки при одобрении: те же аргументы, что прислал агент. */
export function pendingJob(id: string): Job | null {
  const p = S.pending.get(id)
  if (!p || p.status !== 'pending') return null
  return { id: p.id, tool: p.tool, args: p.args, tokenName: p.tokenName }
}

/** Решение человека из интерфейса. При одобрении вкладка уже выполнила запись. */
export async function decideApproval(
  id: string,
  decision: 'approve' | 'reject',
  result?: { ok: boolean; payload: unknown },
): Promise<boolean> {
  await load()
  const p = S.pending.get(id)
  if (!p || p.status !== 'pending') return false
  p.status = decision === 'approve' ? 'approved' : 'rejected'
  p.result = decision === 'approve' ? result : { ok: false, payload: 'REJECTED' }
  await audit({
    kind: 'approval',
    tokenId: p.tokenId,
    tokenName: p.tokenName,
    tool: p.tool,
    ok: decision === 'approve' && result?.ok === true,
    detail:
      decision === 'approve'
        ? result?.ok
          ? `Одобрено и выполнено: ${p.summary}`
          : `Одобрено, но не выполнено: ${String(result?.payload ?? '').slice(0, 120)}`
        : `Отклонено владельцем: ${p.summary}`,
  })
  return true
}

/** Для тестов: сброс состояния в памяти. */
export function resetMcpState(): void {
  S.loaded = false
  S.tokens = []
  S.audit = []
  S.auditSeq = 0
  S.deliveredSeq = 0
  S.queue = []
  S.waiters.clear()
  S.pending.clear()
  S.bridgeWake = []
  S.lastBridgeAt = 0
}
