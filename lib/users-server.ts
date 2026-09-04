/* ============================================================
   АККАУНТЫ · серверное хранилище (Node)
   Пользователи, сессии и лицензии — JSON на диске (AI_DIR/users/*.json),
   пароли — scrypt с солью, сессии — серверный список (отзываемы).
   Данные каждого пользователя лежат в AI_DIR/users/<id>/ — диалоги,
   навыки, MCP-токены, пространства синка. Первый запуск переносит
   старые общие каталоги первому админу (см. seedAdmin).
   ============================================================ */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { log } from './log'
import {
  DEFAULT_AI_DAILY_LIMIT,
  DEFAULT_FEATURES,
  accessState,
  type Features,
  type LicenseView,
  type Role,
  type UserStatus,
  type UserView,
} from './users'

export const AI_ROOT = process.env.AI_DIR?.trim() || path.join(process.cwd(), 'ai')
const ROOT = path.join(AI_ROOT, 'users')
const USERS_FILE = path.join(ROOT, 'users.json')
const SESSIONS_FILE = path.join(ROOT, 'sessions.json')
const LICENSES_FILE = path.join(ROOT, 'licenses.json')

/** Каталог личных данных пользователя. Первый админ — старый корень AI_DIR. */
export function userDir(uid: string, legacy = false): string {
  return legacy ? AI_ROOT : path.join(ROOT, uid)
}

type UserRecord = {
  id: string
  email: string
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
  mustChangePassword: boolean
  passwordFromEnv: boolean
  legacyStore: boolean
  createdAt: number
  lastLoginAt: number | null
}

export type SessionRecord = { sid: string; uid: string; createdAt: number; expiresAt: number; ua: string }

type LicenseRecord = LicenseView & { keyHash: string }

type State = {
  loaded: boolean
  users: UserRecord[]
  sessions: SessionRecord[]
  licenses: LicenseRecord[]
}

const g = globalThis as unknown as { __wsxUsers?: State }
const S: State = (g.__wsxUsers ??= { loaded: false, users: [], sessions: [], licenses: [] })

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

/* ---------- загрузка и посев ---------- */

export async function load(): Promise<void> {
  if (S.loaded) return
  await fs.mkdir(ROOT, { recursive: true })
  S.users = await readJson<UserRecord[]>(USERS_FILE, [])
  S.sessions = await readJson<SessionRecord[]>(SESSIONS_FILE, [])
  S.licenses = await readJson<LicenseRecord[]>(LICENSES_FILE, [])
  S.loaded = true
  await seedAdmin()
}

/**
 * Первый админ рождается из окружения: ADMIN_EMAIL + APP_PASSWORD.
 * Пока админ не менял пароль сам, смена APP_PASSWORD в .env применяется;
 * после — окружение больше не источник истины.
 */
async function seedAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL?.trim() || 'admin@workspacex.local').toLowerCase()
  const password = process.env.APP_PASSWORD
  if (!password) return
  let admin = S.users.find((u) => u.role === 'admin' && u.passwordFromEnv)
  if (!admin) {
    if (S.users.some((u) => u.email === email)) return
    admin = {
      id: uid(),
      email,
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
      mustChangePassword: false,
      passwordFromEnv: true,
      legacyStore: true,
      createdAt: Date.now(),
      lastLoginAt: null,
    }
    S.users.push(admin)
    await saveUsers()
    log('info', 'users.seed-admin', { where: email })
    return
  }
  if (!(await verifyPassword(password, admin.passHash))) {
    admin.passHash = await hashPassword(password)
    await saveUsers()
    log('info', 'users.admin-password-resynced', {})
  }
}

/* ---------- представление ---------- */

function view(u: UserRecord): UserView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    features: u.features,
    aiDailyLimit: u.aiDailyLimit,
    aiCallsToday: u.aiDay === today() ? u.aiDayCount : 0,
    aiCallsTotal: u.aiTotal,
    licenseUntil: u.licenseUntil,
    mustChangePassword: u.mustChangePassword,
    legacyStore: u.legacyStore,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    sessions: S.sessions.filter((s) => s.uid === u.id && s.expiresAt > Date.now()).length,
  }
}

const byId = (id: string) => S.users.find((u) => u.id === id)
const byEmail = (email: string) => S.users.find((u) => u.email === email.trim().toLowerCase())

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

export async function login(email: string | null, password: string, ttlMs: number, ua: string): Promise<LoginResult> {
  await load()
  /* Совместимость: вход одним паролем — это вход первого админа. */
  const u = email ? byEmail(email) : S.users.find((x) => x.role === 'admin' && x.legacyStore)
  if (!u || !(await verifyPassword(password, u.passHash))) return { ok: false, code: 'BAD_CREDENTIALS' }
  if (u.status === 'blocked') return { ok: false, code: 'BLOCKED' }
  u.lastLoginAt = Date.now()
  const sid = randomBytes(16).toString('hex')
  S.sessions = S.sessions.filter((s) => s.expiresAt > Date.now())
  S.sessions.push({ sid, uid: u.id, createdAt: Date.now(), expiresAt: Date.now() + ttlMs, ua: ua.slice(0, 120) })
  await Promise.all([saveUsers(), saveSessions()])
  return { ok: true, user: view(u), sid }
}

export async function register(
  email: string,
  password: string,
  name: string,
  ttlMs: number,
  ua: string,
): Promise<{ ok: true; user: UserView; sid: string } | { ok: false; code: 'EMAIL_TAKEN' }> {
  await load()
  if (byEmail(email)) return { ok: false, code: 'EMAIL_TAKEN' }
  const u: UserRecord = {
    id: uid(),
    email: email.trim().toLowerCase(),
    name: name.trim().slice(0, 60) || email.split('@')[0],
    passHash: await hashPassword(password),
    role: 'user',
    status: 'active',
    features: { ...DEFAULT_FEATURES },
    aiDailyLimit: DEFAULT_AI_DAILY_LIMIT,
    aiDay: today(),
    aiDayCount: 0,
    aiTotal: 0,
    licenseUntil: null,
    mustChangePassword: false,
    passwordFromEnv: false,
    legacyStore: false,
    createdAt: Date.now(),
    lastLoginAt: null,
  }
  S.users.push(u)
  await saveUsers()
  log('info', 'users.registered', { where: u.id })
  return login(u.email, password, ttlMs, ua) as Promise<{ ok: true; user: UserView; sid: string }>
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

/* ---------- лицензии ---------- */

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
  return rest
}

export async function listLicenses(): Promise<LicenseView[]> {
  await load()
  return S.licenses.map(licView).sort((a, b) => b.createdAt - a.createdAt)
}

export async function issueLicense(days: number, note: string): Promise<{ key: string; view: LicenseView }> {
  await load()
  const key = newKey()
  const rec: LicenseRecord = {
    id: uid(),
    mask: `WSX-••••-••••-••••-${key.slice(-4)}`,
    days,
    note: note.trim().slice(0, 80),
    createdAt: Date.now(),
    usedBy: null,
    usedAt: null,
    revokedAt: null,
    keyHash: await keyHash(key),
  }
  S.licenses.push(rec)
  await saveLicenses()
  return { key, view: licView(rec) }
}

export async function revokeLicense(id: string): Promise<boolean> {
  await load()
  const l = S.licenses.find((x) => x.id === id)
  if (!l || l.revokedAt) return false
  l.revokedAt = Date.now()
  await saveLicenses()
  return true
}

export async function redeemLicense(userId: string, key: string): Promise<'ok' | 'INVALID' | 'USED' | 'REVOKED'> {
  await load()
  const u = byId(userId)
  if (!u) return 'INVALID'
  const h = await keyHash(key)
  const l = S.licenses.find((x) => x.keyHash === h)
  if (!l) return 'INVALID'
  if (l.revokedAt) return 'REVOKED'
  if (l.usedBy) return 'USED'
  l.usedBy = u.id
  l.usedAt = Date.now()
  const base = u.licenseUntil && u.licenseUntil > Date.now() ? u.licenseUntil : Date.now()
  u.licenseUntil = base + l.days * 86_400_000
  await Promise.all([saveLicenses(), saveUsers()])
  log('info', 'users.license-redeemed', { where: u.id, count: l.days })
  return 'ok'
}

/* ---------- администрирование ---------- */

export type CreateUserInput = {
  email: string
  name: string
  password: string
  role: Role
  features?: Features
  aiDailyLimit?: number
  licenseDays?: number
}

export async function adminCreateUser(input: CreateUserInput): Promise<UserView | 'EMAIL_TAKEN'> {
  await load()
  if (byEmail(input.email)) return 'EMAIL_TAKEN'
  const u: UserRecord = {
    id: uid(),
    email: input.email.trim().toLowerCase(),
    name: input.name.trim().slice(0, 60) || input.email.split('@')[0],
    passHash: await hashPassword(input.password),
    role: input.role,
    status: 'active',
    features: input.features ?? { ...DEFAULT_FEATURES },
    aiDailyLimit: input.aiDailyLimit ?? DEFAULT_AI_DAILY_LIMIT,
    aiDay: today(),
    aiDayCount: 0,
    aiTotal: 0,
    licenseUntil: input.licenseDays ? Date.now() + input.licenseDays * 86_400_000 : null,
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
    u.licenseUntil = base + days * 86_400_000
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
  awaitingLicense: number
  sessions: number
  aiToday: number
  aiTotal: number
  licensesFree: number
}> {
  await load()
  const now = Date.now()
  const t = today()
  return {
    users: S.users.length,
    admins: S.users.filter((u) => u.role === 'admin').length,
    blocked: S.users.filter((u) => u.status === 'blocked').length,
    licensed: S.users.filter((u) => u.role === 'user' && u.licenseUntil !== null && u.licenseUntil > now).length,
    awaitingLicense: S.users.filter((u) => accessState(view(u), now) === 'license').length,
    sessions: S.sessions.filter((s) => s.expiresAt > now).length,
    aiToday: S.users.reduce((n, u) => n + (u.aiDay === t ? u.aiDayCount : 0), 0),
    aiTotal: S.users.reduce((n, u) => n + u.aiTotal, 0),
    licensesFree: S.licenses.filter((l) => !l.usedBy && !l.revokedAt).length,
  }
}

/** Для тестов. */
export function resetUsersState(): void {
  S.loaded = false
  S.users = []
  S.sessions = []
  S.licenses = []
}
