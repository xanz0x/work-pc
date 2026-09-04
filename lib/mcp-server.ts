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

const AI_ROOT = process.env.AI_DIR?.trim() || path.join(process.cwd(), 'ai')
/** Токены всех пользователей — в одном файле (Bearer не знает владельца заранее). */
const TOKENS_FILE = path.join(AI_ROOT, 'mcp-access', 'tokens.json')

/**
 * Владелец: первый админ хранит аудит и очередь под старым каталогом,
 * остальные — под AI_DIR/users/<id>/mcp-access.
 */
export type Owner = string
export const LEGACY_OWNER = 'legacy'
export const ownerOf = (u: { uid: string; legacy: boolean }): Owner => (u.legacy ? LEGACY_OWNER : u.uid)
const ownerDir = (o: Owner) =>
  o === LEGACY_OWNER ? path.join(AI_ROOT, 'mcp-access') : path.join(AI_ROOT, 'users', o, 'mcp-access')

/** Сколько ждём ответа вкладки на одно задание. */
export const JOB_TIMEOUT_MS = 25_000
/** Вкладка считается подключённой, если опрашивала мост недавно. */
const BRIDGE_ALIVE_MS = 30_000

type TokenRecord = TokenView & { hash: string; owner?: Owner }

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

type OwnerState = {
  loaded: boolean
  audit: AuditEntry[]
  auditSeq: number
  deliveredSeq: number
  queue: Job[]
  bridgeWake: (() => void)[]
  lastBridgeAt: number
}

type Global = {
  tokensLoaded: boolean
  tokens: TokenRecord[]
  owners: Map<Owner, OwnerState>
  waiters: Map<string, Waiter>
  pending: Map<string, Pending & { owner: Owner }>
}

/* Одно состояние на процесс: маршруты Next компилируются в разные модули,
   поэтому держим его на globalThis, как принято для singletons в Node. */
const g = globalThis as unknown as { __wsxMcp?: Global }
const G: Global = (g.__wsxMcp ??= {
  tokensLoaded: false,
  tokens: [],
  owners: new Map(),
  waiters: new Map(),
  pending: new Map(),
})

function stateOf(owner: Owner): OwnerState {
  let st = G.owners.get(owner)
  if (!st) {
    st = { loaded: false, audit: [], auditSeq: 0, deliveredSeq: 0, queue: [], bridgeWake: [], lastBridgeAt: 0 }
    G.owners.set(owner, st)
  }
  return st
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function loadTokens(): Promise<void> {
  if (G.tokensLoaded) return
  await fs.mkdir(path.dirname(TOKENS_FILE), { recursive: true })
  G.tokens = await readJson<TokenRecord[]>(TOKENS_FILE, [])
  /* Токены до аккаунтов принадлежат первому админу. */
  for (const t of G.tokens) t.owner ??= LEGACY_OWNER
  G.tokensLoaded = true
}

async function load(owner: Owner): Promise<OwnerState> {
  await loadTokens()
  const S = stateOf(owner)
  if (S.loaded) return S
  const dir = ownerDir(owner)
  await fs.mkdir(dir, { recursive: true })
  const cursor = await readJson<{ deliveredSeq: number }>(path.join(dir, 'cursor.json'), { deliveredSeq: 0 })
  S.deliveredSeq = cursor.deliveredSeq
  try {
    const lines = (await fs.readFile(path.join(dir, 'audit.jsonl'), 'utf8')).split('\n').filter(Boolean)
    S.audit = lines.map((l) => JSON.parse(l) as AuditEntry)
  } catch {
    S.audit = []
  }
  S.auditSeq = S.audit.reduce((m, e) => Math.max(m, e.seq), 0)
  S.loaded = true
  return S
}

async function saveTokens(): Promise<void> {
  await fs.mkdir(path.dirname(TOKENS_FILE), { recursive: true })
  await fs.writeFile(TOKENS_FILE, `${JSON.stringify(G.tokens, null, 2)}\n`, 'utf8')
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function wakeBridge(S: OwnerState): void {
  const list = S.bridgeWake.splice(0)
  for (const fn of list) fn()
}

/* ---------- аудит ---------- */

async function audit(owner: Owner, e: Omit<AuditEntry, 'seq' | 'at'>): Promise<void> {
  const S = await load(owner)
  const entry: AuditEntry = { ...e, seq: ++S.auditSeq, at: Date.now() }
  S.audit.push(entry)
  if (S.audit.length > 2000) S.audit.splice(0, S.audit.length - 2000)
  try {
    await fs.appendFile(path.join(ownerDir(owner), 'audit.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    log('error', 'mcp.audit-failed', { reason: err instanceof Error ? err.message : 'неизвестно' })
  }
  log(e.ok ? 'info' : 'warn', `mcp.${e.kind}`, { where: e.tool ?? undefined, code: e.tokenId ?? undefined })
  wakeBridge(S)
}

/* ---------- токены ---------- */

function view(t: TokenRecord): TokenView {
  const { hash: _hash, owner: _owner, ...rest } = t
  void _hash
  void _owner
  return rest
}

export type OwnedToken = TokenView & { owner: Owner }

export async function listTokens(owner: Owner): Promise<TokenView[]> {
  await loadTokens()
  return G.tokens.filter((t) => t.owner === owner).map(view).sort((a, b) => b.createdAt - a.createdAt)
}

export async function issueToken(
  owner: Owner,
  name: string,
  scopes: Scope[],
  ttlHours: number,
): Promise<{ token: string; view: TokenView }> {
  await load(owner)
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
    owner,
  }
  G.tokens.push(rec)
  await saveTokens()
  await audit(owner, {
    kind: 'token-issued',
    tokenId: id,
    tokenName: rec.name,
    tool: null,
    ok: true,
    detail: `Области: ${scopes.join(', ')} · срок ${ttlHours} ч`,
  })
  return { token: formatToken(id, secret), view: view(rec) }
}

export async function revokeToken(owner: Owner, id: string): Promise<boolean> {
  await load(owner)
  const rec = G.tokens.find((t) => t.id === id && t.owner === owner)
  if (!rec || rec.revokedAt) return false
  rec.revokedAt = Date.now()
  await saveTokens()
  await audit(owner, {
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
  | { ok: true; token: OwnedToken }
  | { ok: false; code: 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_REVOKED' }

/** Проверка Bearer-токена. Каждый провал — запись в аудит. */
export async function authenticate(header: string | null): Promise<AuthResult> {
  await loadTokens()
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!raw) return { ok: false, code: 'TOKEN_MISSING' }
  const parsed = parseToken(raw)
  const rec = parsed ? G.tokens.find((t) => t.id === parsed.id) : undefined
  const owner = rec?.owner ?? LEGACY_OWNER
  if (!parsed || !rec || !equalConst(rec.hash, await hashSecret(parsed.secret))) {
    await audit(owner, {
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
    await audit(owner, { kind: 'denied', tokenId: rec.id, tokenName: rec.name, tool: null, ok: false, detail: 'Токен отозван' })
    return { ok: false, code: 'TOKEN_REVOKED' }
  }
  if (rec.expiresAt <= Date.now()) {
    await audit(owner, { kind: 'denied', tokenId: rec.id, tokenName: rec.name, tool: null, ok: false, detail: 'Срок токена истёк' })
    return { ok: false, code: 'TOKEN_EXPIRED' }
  }
  return { ok: true, token: { ...view(rec), owner } }
}

async function touch(tokenId: string): Promise<void> {
  const rec = G.tokens.find((t) => t.id === tokenId)
  if (!rec) return
  rec.lastUsedAt = Date.now()
  rec.calls += 1
  await saveTokens().catch(() => {})
}

export async function auditDenied(token: OwnedToken, tool: McpToolName, detail: string): Promise<void> {
  await audit(token.owner, { kind: 'denied', tokenId: token.id, tokenName: token.name, tool, ok: false, detail })
}

/* ---------- очередь заданий для вкладки ---------- */

export function bridgeAlive(owner: Owner): boolean {
  const S = stateOf(owner)
  return S.bridgeWake.length > 0 || Date.now() - S.lastBridgeAt < BRIDGE_ALIVE_MS
}

/**
 * Выполнить инструмент через открытую вкладку. Возвращает результат
 * или бросает код ошибки: NO_BRIDGE (вкладка не открыта) / BRIDGE_TIMEOUT.
 */
export async function runTool(
  token: OwnedToken,
  tool: McpToolName,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; payload: unknown }> {
  const S = await load(token.owner)
  if (!bridgeAlive(token.owner)) {
    await audit(token.owner, {
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
      G.waiters.delete(job.id)
      S.queue = S.queue.filter((j) => j.id !== job.id)
      resolve({ ok: false, payload: 'BRIDGE_TIMEOUT' })
    }, JOB_TIMEOUT_MS)
    G.waiters.set(job.id, { resolve, timer })
    S.queue.push(job)
    wakeBridge(S)
  })
  await touch(token.id)
  await audit(token.owner, {
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
export async function bridgePoll(owner: Owner, waitMs: number): Promise<BridgePoll> {
  const S = await load(owner)
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
    await fs
      .writeFile(path.join(ownerDir(owner), 'cursor.json'), JSON.stringify({ deliveredSeq: S.deliveredSeq }), 'utf8')
      .catch(() => {})
  }
  return { jobs, audit: fresh, pending: listPending(owner), serverAt: Date.now() }
}

export function bridgeResult(jobId: string, ok: boolean, payload: unknown): boolean {
  const w = G.waiters.get(jobId)
  if (!w) return false
  clearTimeout(w.timer)
  G.waiters.delete(jobId)
  w.resolve({ ok, payload })
  return true
}

/* ---------- подтверждения опасных операций ---------- */

function expirePending(): void {
  const now = Date.now()
  for (const p of G.pending.values()) {
    if (p.status === 'pending' && now - p.createdAt > APPROVAL_TTL_MS) p.status = 'expired'
    if (now - p.createdAt > APPROVAL_TTL_MS * 3) G.pending.delete(p.id)
  }
}

function pendingView(p: Pending): PendingView {
  return { id: p.id, tool: p.tool, summary: p.summary, tokenName: p.tokenName, createdAt: p.createdAt, status: p.status }
}

export function listPending(owner: Owner): PendingView[] {
  expirePending()
  return [...G.pending.values()].filter((p) => p.status === 'pending' && p.owner === owner).map(pendingView)
}

/** Агент просит опасную операцию: заводим запрос и ждём человека. */
export async function requestApproval(
  token: OwnedToken,
  tool: McpToolName,
  args: Record<string, unknown>,
): Promise<PendingView> {
  await load(token.owner)
  const p: Pending & { owner: Owner } = {
    owner: token.owner,
    id: uid('appr'),
    tool,
    args,
    summary: summarizeArgs(tool, args),
    tokenName: token.name,
    tokenId: token.id,
    createdAt: Date.now(),
    status: 'pending',
  }
  G.pending.set(p.id, p)
  await touch(token.id)
  await audit(token.owner, {
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
  const p = G.pending.get(id)
  if (!p || p.tokenId !== tokenId) return { status: 'unknown' }
  return { status: p.status, result: p.result }
}

/** Задание для вкладки при одобрении: те же аргументы, что прислал агент. */
export function pendingJob(owner: Owner, id: string): Job | null {
  const p = G.pending.get(id)
  if (!p || p.status !== 'pending' || p.owner !== owner) return null
  return { id: p.id, tool: p.tool, args: p.args, tokenName: p.tokenName }
}

/** Решение человека из интерфейса. При одобрении вкладка уже выполнила запись. */
export async function decideApproval(
  owner: Owner,
  id: string,
  decision: 'approve' | 'reject',
  result?: { ok: boolean; payload: unknown },
): Promise<boolean> {
  await load(owner)
  const p = G.pending.get(id)
  if (!p || p.status !== 'pending' || p.owner !== owner) return false
  p.status = decision === 'approve' ? 'approved' : 'rejected'
  p.result = decision === 'approve' ? result : { ok: false, payload: 'REJECTED' }
  await audit(owner, {
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
  G.tokensLoaded = false
  G.tokens = []
  G.owners.clear()
  G.waiters.clear()
  G.pending.clear()
}
