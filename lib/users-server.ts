/* ============================================================
   АККАУНТЫ · серверное хранилище (Node)
   Пользователи, сессии, тарифы и ключи лицензий — JSON на диске
   (AI_DIR/users/*.json), пароли — scrypt с солью, сессии — серверный
   список (отзываемы). Регистрация возможна только по ключу лицензии,
   который админ выдаёт под конкретный тариф: ключ задаёт набор функций,
   лимит ИИ и срок. Данные каждого пользователя лежат в AI_DIR/users/<id>/.
   ============================================================ */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { log } from './log'
import {
  DEFAULT_AI_DAILY_LIMIT,
  DEFAULT_FEATURES,
  DEFAULT_PLANS,
  accessState,
  normalizeLogin,
  type Features,
  type LicenseView,
  type Plan,
  type PlanColor,
  type PlanInput,
  type PlanRef,
  type PlanStats,
  type Role,
  type UserStatus,
  type UserView,
} from './users'

export const AI_ROOT = process.env.AI_DIR?.trim() || path.join(process.cwd(), 'ai')
const ROOT = path.join(AI_ROOT, 'users')
const USERS_FILE = path.join(ROOT, 'users.json')
const SESSIONS_FILE = path.join(ROOT, 'sessions.json')
const LICENSES_FILE = path.join(ROOT, 'licenses.json')
const PLANS_FILE = path.join(ROOT, 'plans.json')

/** Каталог личных данных пользователя. Первый админ — старый корень AI_DIR. */
export function userDir(uid: string, legacy = false): string {
  return legacy ? AI_ROOT : path.join(ROOT, uid)
}

type UserRecord = {
  id: string
  login: string
  /** Старое поле до перехода на логины; при загрузке превращается в login. */
  email?: string
  name: string
  passHash: string
  role: Role
  status: UserStatus
  features: Features
  aiDailyLimit: number
  aiDay: string
  aiDayCount: number
  aiTotal: number
  licenseUntil: number | null
  planId: string | null
  mustChangePassword: boolean
  passwordFromEnv: boolean
  legacyStore: boolean
  createdAt: number
  lastLoginAt: number | null
}

export type SessionRecord = { sid: string; uid: string; createdAt: number; expiresAt: number; ua: string }

type LicenseRecord = Omit<LicenseView, 'usedByLogin' | 'planName' | 'planColor'> & { keyHash: string }

type State = {
  loaded: boolean
  users: UserRecord[]
  sessions: SessionRecord[]
  licenses: LicenseRecord[]
  plans: Plan[]
}

const g = globalThis as unknown as { __wsxUsers?: State }
const S: State = (g.__wsxUsers ??= { loaded: false, users: [], sessions: [], licenses: [], plans: [] })

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return fallback
  }
}
async function writeJson(p: string, v: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8')
}

const saveUsers = () => writeJson(USERS_FILE, S.users)
const saveSessions = () => writeJson(SESSIONS_FILE, S.sessions)
const saveLicenses = () => writeJson(LICENSES_FILE, S.licenses)
const savePlans = () => writeJson(PLANS_FILE, S.plans)

/* ---------- пароли ---------- */

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'))
  const expected = Buffer.from(keyB64, 'base64')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

const uid = () => randomBytes(8).toString('hex')
const today = () => new Date().toISOString().slice(0, 10)
const DAY_MS = 86_400_000

/* ---------- загрузка и посев ---------- */

export async function load(): Promise<void> {
  if (S.loaded) return
  await fs.mkdir(ROOT, { recursive: true })
  S.users = await readJson<UserRecord[]>(USERS_FILE, [])
  S.sessions = await readJson<SessionRecord[]>(SESSIONS_FILE, [])
  S.licenses = await readJson<LicenseRecord[]>(LICENSES_FILE, [])
  S.plans = await readJson<Plan[]>(PLANS_FILE, [])
  S.loaded = true
  await seedPlans()
  await migrateUsers()
  await seedAdmin()
}

async function seedPlans(): Promise<void> {
  if (S.plans.length) return
  S.plans = DEFAULT_PLANS.map((p, i) => ({ ...p, id: uid(), order: i, archived: false, createdAt: Date.now() }))
  await savePlans()
  log('info', 'users.seed-plans', { count: S.plans.length })
}

/** Переход email → login: логин берётся из части до @, дубли получают суффикс. */
async function migrateUsers(): Promise<void> {
  let changed = false
  for (const u of S.users) {
    if (!u.login) {
      const base = normalizeLogin((u.email ?? 'user').split('@')[0]).replace(/[^a-z0-9._-]/g, '') || 'user'
      let candidate = base.length < 3 ? `${base}user`.slice(0, 32) : base.slice(0, 32)
      let n = 1
      while (S.users.some((x) => x !== u && x.login === candidate)) candidate = `${base.slice(0, 28)}-${++n}`
      u.login = candidate
      delete u.email
      changed = true
    }
    if (u.planId === undefined) {
      u.planId = null
      changed = true
    }
  }
  for (const l of S.licenses) {
    if (!l.planId) {
      l.planId = S.plans[0]?.id ?? ''
      changed = true
    }
  }
  if (changed) await Promise.all([saveUsers(), saveLicenses()])
}

/**
 * Первый админ рождается из окружения: ADMIN_LOGIN + APP_PASSWORD.
 * Пока админ не менял пароль сам, смена APP_PASSWORD в .env применяется;
 * после — окружение больше не источник истины.
 */
async function seedAdmin(): Promise<void> {
  const login = normalizeLogin(process.env.ADMIN_LOGIN?.trim() || 'admin')
  const password = process.env.APP_PASSWORD
  if (!password) return
  let admin = S.users.find((u) => u.role === 'admin' && u.passwordFromEnv)
  if (!admin) {
    if (byLogin(login)) return
    admin = {
      id: uid(),
      login,
      name: 'Администратор',
      passHash: await hashPassword(password),
      role: 'admin',
      status: 'active',
      features: { ...DEFAULT_FEATURES },
      aiDailyLimit: 0,
      aiDay: today(),
      aiDayCount: 0,
      aiTotal: 0,
      licenseUntil: null,
      planId: null,
      mustChangePassword: false,
      passwordFromEnv: true,
      legacyStore: true,
      createdAt: Date.now(),
      lastLoginAt: null,
    }
    S.users.push(admin)
    await saveUsers()
    log('info', 'users.seed-admin', { where: login })
    return
  }
  let changed = false
  if (admin.login !== login && !byLogin(login)) {
    admin.login = login
    changed = true
  }
  if (!(await verifyPassword(password, admin.passHash))) {
    admin.passHash = await hashPassword(password)
    changed = true
    log('info', 'users.admin-password-resynced', {})
  }
  if (changed) await saveUsers()
}

/* ---------- представление ---------- */

const planRef = (id: string | null): PlanRef | null => {
  const p = id ? S.plans.find((x) => x.id === id) : null
  return p ? { id: p.id, name: p.name, color: p.color } : null
}

function view(u: UserRecord): UserView {
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    role: u.role,
    status: u.status,
    features: u.features,
    aiDailyLimit: u.aiDailyLimit,
    aiCallsToday: u.aiDay === today() ? u.aiDayCount : 0,
    aiCallsTotal: u.aiTotal,
    licenseUntil: u.licenseUntil,
    plan: planRef(u.planId),
    mustChangePassword: u.mustChangePassword,
    legacyStore: u.legacyStore,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    sessions: S.sessions.filter((s) => s.uid === u.id && s.expiresAt > Date.now()).length,
  }
}

const byId = (id: string) => S.users.find((u) => u.id === id)
const byLogin = (login: string) => S.users.find((u) => u.login === normalizeLogin(login))

export async function getUser(id: string): Promise<UserView | null> {
  await load()
  const u = byId(id)
  return u ? view(u) : null
}

export async function listUsers(): Promise<UserView[]> {
  await load()
  return S.users.map(view).sort((a, b) => a.createdAt - b.createdAt)
}

/* ---------- вход, регистрация, сессии ---------- */

export type LoginResult =
  | { ok: true; user: UserView; sid: string }
  | { ok: false; code: 'BAD_CREDENTIALS' | 'BLOCKED' }

export async function login(login: string | null, password: string, ttlMs: number, ua: string): Promise<LoginResult> {
  await load()
  /* Совместимость: вход одним паролем — это вход первого админа. */
  const u = login ? byLogin(login) : S.users.find((x) => x.role === 'admin' && x.legacyStore)
  if (!u || !(await verifyPassword(password, u.passHash))) return { ok: false, code: 'BAD_CREDENTIALS' }
  if (u.status === 'blocked') return { ok: false, code: 'BLOCKED' }
  u.lastLoginAt = Date.now()
  const sid = randomBytes(16).toString('hex')
  S.sessions = S.sessions.filter((s) => s.expiresAt > Date.now())
  S.sessions.push({ sid, uid: u.id, createdAt: Date.now(), expiresAt: Date.now() + ttlMs, ua: ua.slice(0, 120) })
  await Promise.all([saveUsers(), saveSessions()])
  return { ok: true, user: view(u), sid }
}

export type KeyProblem = 'INVALID' | 'USED' | 'REVOKED' | 'PLAN_GONE'

/** Проверка ключа без активации: что за тариф и на сколько дней. */
export async function inspectKey(key: string): Promise<{ ok: true; plan: PlanRef; tagline: string; days: number } | { ok: false; code: KeyProblem }> {
  await load()
  const h = await keyHash(key)
  const l = S.licenses.find((x) => x.keyHash === h)
  if (!l) return { ok: false, code: 'INVALID' }
  if (l.revokedAt) return { ok: false, code: 'REVOKED' }
  if (l.usedBy) return { ok: false, code: 'USED' }
  const p = S.plans.find((x) => x.id === l.planId)
  if (!p) return { ok: false, code: 'PLAN_GONE' }
  return { ok: true, plan: { id: p.id, name: p.name, color: p.color }, tagline: p.tagline, days: l.days }
}

/** Ключ применяется к пользователю: тариф задаёт функции и лимит, срок складывается с остатком того же тарифа. */
function applyLicense(u: UserRecord, l: LicenseRecord, p: Plan): void {
  const samePlan = u.planId === p.id
  const base = samePlan && u.licenseUntil && u.licenseUntil > Date.now() ? u.licenseUntil : Date.now()
  u.licenseUntil = base + l.days * DAY_MS
  u.planId = p.id
  u.features = { ...p.features }
  u.aiDailyLimit = p.aiDailyLimit
  l.usedBy = u.id
  l.usedAt = Date.now()
}

export type RegisterResult = { ok: true; user: UserView; sid: string } | { ok: false; code: 'LOGIN_TAKEN' | KeyProblem }

/** Регистрация только по ключу: аккаунт рождается сразу с тарифом и сроком ключа. */
export async function register(loginRaw: string, password: string, key: string, ttlMs: number, ua: string): Promise<RegisterResult> {
  await load()
  const login = normalizeLogin(loginRaw)
  if (byLogin(login)) return { ok: false, code: 'LOGIN_TAKEN' }
  const h = await keyHash(key)
  const l = S.licenses.find((x) => x.keyHash === h)
  if (!l) return { ok: false, code: 'INVALID' }
  if (l.revokedAt) return { ok: false, code: 'REVOKED' }
  if (l.usedBy) return { ok: false, code: 'USED' }
  const p = S.plans.find((x) => x.id === l.planId)
  if (!p) return { ok: false, code: 'PLAN_GONE' }
  const u: UserRecord = {
    id: uid(),
    login,
    name: login,
    passHash: await hashPassword(password),
    role: 'user',
    status: 'active',
    features: { ...p.features },
    aiDailyLimit: p.aiDailyLimit,
    aiDay: today(),
    aiDayCount: 0,
    aiTotal: 0,
    licenseUntil: null,
    planId: null,
    mustChangePassword: false,
    passwordFromEnv: false,
    legacyStore: false,
    createdAt: Date.now(),
    lastLoginAt: null,
  }
  applyLicense(u, l, p)
  S.users.push(u)
  await Promise.all([saveUsers(), saveLicenses()])
  log('info', 'users.registered', { where: u.id, count: l.days })
  return login_(u, password, ttlMs, ua)
}

async function login_(u: UserRecord, password: string, ttlMs: number, ua: string): Promise<RegisterResult> {
  const r = await login(u.login, password, ttlMs, ua)
  return r.ok ? r : { ok: false, code: 'INVALID' }
}

/** Сессия жива, если есть в списке и пользователь существует. */
export async function resolveSession(sid: string | null): Promise<{ user: UserView; session: SessionRecord } | null> {
  await load()
  if (!sid) return null
  const s = S.sessions.find((x) => x.sid === sid)
  if (!s || s.expiresAt <= Date.now()) return null
  const u = byId(s.uid)
  if (!u) return null
  return { user: view(u), session: s }
}

export async function endSession(sid: string): Promise<void> {
  await load()
  S.sessions = S.sessions.filter((s) => s.sid !== sid)
  await saveSessions()
}

export async function changePassword(id: string, current: string | null, next: string): Promise<'ok' | 'BAD_CURRENT' | 'NOT_FOUND'> {
  await load()
  const u = byId(id)
  if (!u) return 'NOT_FOUND'
  if (current !== null && !(await verifyPassword(current, u.passHash))) return 'BAD_CURRENT'
  u.passHash = await hashPassword(next)
  u.mustChangePassword = false
  u.passwordFromEnv = false
  await saveUsers()
  return 'ok'
}

/* ---------- лимит ИИ ---------- */

/** Учёт запроса к ИИ. false — суточный лимит исчерпан (0 = без лимита). */
export async function countAiCall(id: string): Promise<{ ok: boolean; used: number; limit: number }> {
  await load()
  const u = byId(id)
  if (!u) return { ok: false, used: 0, limit: 0 }
  if (u.aiDay !== today()) {
    u.aiDay = today()
    u.aiDayCount = 0
  }
  if (u.aiDailyLimit > 0 && u.aiDayCount >= u.aiDailyLimit) return { ok: false, used: u.aiDayCount, limit: u.aiDailyLimit }
  u.aiDayCount += 1
  u.aiTotal += 1
  await saveUsers()
  return { ok: true, used: u.aiDayCount, limit: u.aiDailyLimit }
}

/* ---------- тарифы ---------- */

export type { PlanStats }

export async function listPlans(): Promise<PlanStats[]> {
  await load()
  return S.plans
    .map((p) => ({
      ...p,
      users: S.users.filter((u) => u.planId === p.id).length,
      freeKeys: S.licenses.filter((l) => l.planId === p.id && !l.usedBy && !l.revokedAt).length,
    }))
    .sort((a, b) => a.order - b.order)
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  await load()
  const p: Plan = {
    ...input,
    name: input.name.trim(),
    tagline: input.tagline.trim(),
    id: uid(),
    order: S.plans.length ? Math.max(...S.plans.map((x) => x.order)) + 1 : 0,
    archived: false,
    createdAt: Date.now(),
  }
  S.plans.push(p)
  await savePlans()
  log('info', 'users.plan-created', { where: p.id })
  return p
}

export async function updatePlan(id: string, patch: Partial<PlanInput> & { archived?: boolean }): Promise<Plan | null> {
  await load()
  const p = S.plans.find((x) => x.id === id)
  if (!p) return null
  if (patch.name !== undefined) p.name = patch.name.trim()
  if (patch.tagline !== undefined) p.tagline = patch.tagline.trim()
  if (patch.color !== undefined) p.color = patch.color
  if (patch.days !== undefined) p.days = patch.days
  if (patch.aiDailyLimit !== undefined) p.aiDailyLimit = patch.aiDailyLimit
  if (patch.features !== undefined) p.features = { ...patch.features }
  if (patch.archived !== undefined) p.archived = patch.archived
  await savePlans()
  return p
}

/** Удалить можно только тариф без пользователей и ключей; иначе — архив. */
export async function deletePlan(id: string): Promise<'ok' | 'NOT_FOUND' | 'IN_USE'> {
  await load()
  const p = S.plans.find((x) => x.id === id)
  if (!p) return 'NOT_FOUND'
  if (S.users.some((u) => u.planId === id) || S.licenses.some((l) => l.planId === id)) return 'IN_USE'
  S.plans = S.plans.filter((x) => x.id !== id)
  await savePlans()
  return 'ok'
}

/* ---------- ключи лицензий ---------- */

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newKey(): string {
  const bytes = randomBytes(16)
  const chars = Array.from(bytes, (b) => KEY_ALPHABET[b % KEY_ALPHABET.length])
  return `WSX-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`
}

async function keyHash(key: string): Promise<string> {
  return createHash('sha256').update(`wsx-license.${key.trim().toUpperCase()}`).digest('hex')
}

const licView = (l: LicenseRecord): LicenseView => {
  const { keyHash: _h, ...rest } = l
  void _h
  const p = S.plans.find((x) => x.id === l.planId)
  const u = l.usedBy ? byId(l.usedBy) : null
  return {
    ...rest,
    planName: p?.name ?? 'удалённый тариф',
    planColor: (p?.color ?? 'graphite') as PlanColor,
    usedByLogin: u ? u.login : l.usedBy?.startsWith('deleted:') ? 'удалён' : null,
  }
}

export async function listLicenses(): Promise<LicenseView[]> {
  await load()
  return S.licenses.map(licView).sort((a, b) => b.createdAt - a.createdAt)
}

export async function issueLicenses(planId: string, days: number, note: string, count: number): Promise<{ keys: string[]; views: LicenseView[] } | 'NO_PLAN'> {
  await load()
  const p = S.plans.find((x) => x.id === planId)
  if (!p) return 'NO_PLAN'
  const keys: string[] = []
  const views: LicenseView[] = []
  for (let i = 0; i < count; i += 1) {
    const key = newKey()
    const rec: LicenseRecord = {
      id: uid(),
      mask: `WSX-••••-••••-••••-${key.slice(-4)}`,
      planId,
      days,
      note: note.trim().slice(0, 80),
      createdAt: Date.now(),
      usedBy: null,
      usedAt: null,
      revokedAt: null,
      keyHash: await keyHash(key),
    }
    S.licenses.push(rec)
    keys.push(key)
    views.push(licView(rec))
  }
  await saveLicenses()
  log('info', 'users.licenses-issued', { where: planId, count })
  return { keys, views }
}

export async function revokeLicense(id: string): Promise<boolean> {
  await load()
  const l = S.licenses.find((x) => x.id === id)
  if (!l || l.revokedAt || l.usedBy) return false
  l.revokedAt = Date.now()
  await saveLicenses()
  return true
}

export async function redeemLicense(userId: string, key: string): Promise<'ok' | KeyProblem> {
  await load()
  const u = byId(userId)
  if (!u) return 'INVALID'
  const h = await keyHash(key)
  const l = S.licenses.find((x) => x.keyHash === h)
  if (!l) return 'INVALID'
  if (l.revokedAt) return 'REVOKED'
  if (l.usedBy) return 'USED'
  const p = S.plans.find((x) => x.id === l.planId)
  if (!p) return 'PLAN_GONE'
  applyLicense(u, l, p)
  await Promise.all([saveLicenses(), saveUsers()])
  log('info', 'users.license-redeemed', { where: u.id, count: l.days })
  return 'ok'
}

/* ---------- администрирование ---------- */

export type CreateUserInput = {
  login: string
  name: string
  password: string
  role: Role
  planId?: string | null
  licenseDays?: number
}

export async function adminCreateUser(input: CreateUserInput): Promise<UserView | 'LOGIN_TAKEN' | 'NO_PLAN'> {
  await load()
  const login = normalizeLogin(input.login)
  if (byLogin(login)) return 'LOGIN_TAKEN'
  const p = input.planId ? S.plans.find((x) => x.id === input.planId) : null
  if (input.planId && !p) return 'NO_PLAN'
  const u: UserRecord = {
    id: uid(),
    login,
    name: input.name.trim().slice(0, 60) || login,
    passHash: await hashPassword(input.password),
    role: input.role,
    status: 'active',
    features: p ? { ...p.features } : { ...DEFAULT_FEATURES },
    aiDailyLimit: p ? p.aiDailyLimit : DEFAULT_AI_DAILY_LIMIT,
    aiDay: today(),
    aiDayCount: 0,
    aiTotal: 0,
    licenseUntil: p && input.role === 'user' ? Date.now() + (input.licenseDays || p.days) * DAY_MS : null,
    planId: p ? p.id : null,
    mustChangePassword: true,
    passwordFromEnv: false,
    legacyStore: false,
    createdAt: Date.now(),
    lastLoginAt: null,
  }
  S.users.push(u)
  await saveUsers()
  return view(u)
}

export type PatchUserInput = Partial<{
  name: string
  role: Role
  status: UserStatus
  features: Features
  aiDailyLimit: number
}>

export async function adminPatchUser(actorId: string, id: string, p: PatchUserInput): Promise<UserView | 'NOT_FOUND' | 'LAST_ADMIN' | 'SELF'> {
  await load()
  const u = byId(id)
  if (!u) return 'NOT_FOUND'
  if (actorId === id && (p.status === 'blocked' || p.role === 'user')) return 'SELF'
  const demoting = (p.role === 'user' && u.role === 'admin') || (p.status === 'blocked' && u.role === 'admin')
  if (demoting && S.users.filter((x) => x.role === 'admin' && x.status === 'active').length <= 1) return 'LAST_ADMIN'
  if (p.name !== undefined) u.name = p.name.trim().slice(0, 60) || u.name
  if (p.role) u.role = p.role
  if (p.status) u.status = p.status
  if (p.features) u.features = p.features
  if (p.aiDailyLimit !== undefined) u.aiDailyLimit = Math.max(0, Math.min(100_000, Math.floor(p.aiDailyLimit)))
  if (p.status === 'blocked') S.sessions = S.sessions.filter((s) => s.uid !== id)
  await Promise.all([saveUsers(), saveSessions()])
  return view(u)
}

/** Смена тарифа админом: функции и лимит берутся из тарифа, срок лицензии не трогается. */
export async function adminSetPlan(id: string, planId: string, days: number | null): Promise<UserView | 'NOT_FOUND' | 'NO_PLAN'> {
  await load()
  const u = byId(id)
  if (!u) return 'NOT_FOUND'
  const p = S.plans.find((x) => x.id === planId)
  if (!p) return 'NO_PLAN'
  u.planId = p.id
  u.features = { ...p.features }
  u.aiDailyLimit = p.aiDailyLimit
  if (days) u.licenseUntil = Date.now() + days * DAY_MS
  await saveUsers()
  log('info', 'users.plan-set', { where: u.id })
  return view(u)
}

export async function adminResetPassword(id: string, password: string): Promise<boolean> {
  await load()
  const u = byId(id)
  if (!u) return false
  u.passHash = await hashPassword(password)
  u.mustChangePassword = true
  u.passwordFromEnv = false
  S.sessions = S.sessions.filter((s) => s.uid !== id)
  await Promise.all([saveUsers(), saveSessions()])
  return true
}

export async function adminTerminateSessions(id: string): Promise<number> {
  await load()
  const before = S.sessions.length
  S.sessions = S.sessions.filter((s) => s.uid !== id)
  await saveSessions()
  return before - S.sessions.length
}

export async function adminGrantLicense(id: string, days: number | null): Promise<UserView | null> {
  await load()
  const u = byId(id)
  if (!u) return null
  if (days === null) u.licenseUntil = null
  else {
    const base = u.licenseUntil && u.licenseUntil > Date.now() ? u.licenseUntil : Date.now()
    u.licenseUntil = base + days * DAY_MS
  }
  await saveUsers()
  return view(u)
}

/** Удаление вместе с личным каталогом на сервере. Первого админа удалить нельзя. */
export async function adminDeleteUser(actorId: string, id: string): Promise<'ok' | 'NOT_FOUND' | 'SELF' | 'LEGACY'> {
  await load()
  const u = byId(id)
  if (!u) return 'NOT_FOUND'
  if (u.id === actorId) return 'SELF'
  if (u.legacyStore) return 'LEGACY'
  S.users = S.users.filter((x) => x.id !== id)
  S.sessions = S.sessions.filter((s) => s.uid !== id)
  for (const l of S.licenses) if (l.usedBy === id) l.usedBy = `deleted:${id}`
  await Promise.all([saveUsers(), saveSessions(), saveLicenses()])
  await fs.rm(userDir(id), { recursive: true, force: true }).catch(() => {})
  log('warn', 'users.deleted', { where: id })
  return 'ok'
}

export async function adminOverview(): Promise<{
  users: number
  admins: number
  blocked: number
  licensed: number
  expired: number
  expiringSoon: number
  sessions: number
  aiToday: number
  aiTotal: number
  licensesFree: number
  plans: number
}> {
  await load()
  const now = Date.now()
  const t = today()
  const soon = now + 7 * DAY_MS
  return {
    users: S.users.length,
    admins: S.users.filter((u) => u.role === 'admin').length,
    blocked: S.users.filter((u) => u.status === 'blocked').length,
    licensed: S.users.filter((u) => u.role === 'user' && u.licenseUntil !== null && u.licenseUntil > now).length,
    expired: S.users.filter((u) => accessState(view(u), now) === 'license').length,
    expiringSoon: S.users.filter((u) => u.role === 'user' && u.licenseUntil !== null && u.licenseUntil > now && u.licenseUntil <= soon).length,
    sessions: S.sessions.filter((s) => s.expiresAt > now).length,
    aiToday: S.users.reduce((n, u) => n + (u.aiDay === t ? u.aiDayCount : 0), 0),
    aiTotal: S.users.reduce((n, u) => n + u.aiTotal, 0),
    licensesFree: S.licenses.filter((l) => !l.usedBy && !l.revokedAt).length,
    plans: S.plans.filter((p) => !p.archived).length,
  }
}

/** Для тестов. */
export function resetUsersState(): void {
  S.loaded = false
  S.users = []
  S.sessions = []
  S.licenses = []
  S.plans = []
}
