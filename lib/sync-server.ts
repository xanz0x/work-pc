/* ============================================================
   NF-11 · СЛЕПОЕ ХРАНИЛИЩЕ СИНХРОНИЗАЦИИ (сервер)
   Сервер видит идентификатор пространства, хеш его пароля, список
   устройств и журнал шифртекстов с порядковыми номерами. Ключа у него
   нет ни в каком виде, поэтому содержимое операций для него — байты.
   Диск: AI_DIR/sync/<spaceId>/space.json + ops.jsonl (только добавление).
   ============================================================ */

import { promises as fs } from 'fs'
import path from 'path'
import { equalConst, sha256 } from './app-auth'
import { log } from './log'

const ROOT = path.join(process.env.AI_DIR?.trim() || path.join(process.cwd(), 'ai'), 'sync')

export const MAX_OPS_PER_PUSH = 500
export const MAX_CT_CHARS = 256 * 1024

type Device = {
  id: string
  tokenHash: string
  /** Имя устройства — шифртекст: сервер не знает, как владелец его назвал. */
  label: { ct: string; iv: string }
  createdAt: number
  lastSeenAt: number
  revokedAt: number | null
}

type SpaceFile = { passHash: string; createdAt: number; devices: Device[] }

export type Envelope = { seq: number; dev: string; at: number; ct: string; iv: string }

type Space = SpaceFile & { id: string; ops: Envelope[]; seq: number; wake: (() => void)[] }

const g = globalThis as unknown as { __wsxSync?: Map<string, Space> }
const SPACES = (g.__wsxSync ??= new Map<string, Space>())

export const isSpaceId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v)
export const isDeviceId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v)
export const isSealed = (v: unknown): v is { ct: string; iv: string } =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { ct?: unknown }).ct === 'string' &&
  typeof (v as { iv?: unknown }).iv === 'string' &&
  (v as { ct: string }).ct.length <= MAX_CT_CHARS &&
  (v as { iv: string }).iv.length <= 64

const dir = (id: string) => path.join(ROOT, id)

async function loadSpace(id: string): Promise<Space | null> {
  const cached = SPACES.get(id)
  if (cached) return cached
  let file: SpaceFile
  try {
    file = JSON.parse(await fs.readFile(path.join(dir(id), 'space.json'), 'utf8')) as SpaceFile
  } catch {
    return null
  }
  let ops: Envelope[] = []
  try {
    ops = (await fs.readFile(path.join(dir(id), 'ops.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Envelope)
  } catch {
    ops = []
  }
  const space: Space = { ...file, id, ops, seq: ops.reduce((m, o) => Math.max(m, o.seq), 0), wake: [] }
  SPACES.set(id, space)
  return space
}

async function saveSpace(s: Space): Promise<void> {
  await fs.mkdir(dir(s.id), { recursive: true })
  const file: SpaceFile = { passHash: s.passHash, createdAt: s.createdAt, devices: s.devices }
  await fs.writeFile(path.join(dir(s.id), 'space.json'), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
}

export type DeviceView = Omit<Device, 'tokenHash'>

const view = (d: Device): DeviceView => ({
  id: d.id,
  label: d.label,
  createdAt: d.createdAt,
  lastSeenAt: d.lastSeenAt,
  revokedAt: d.revokedAt,
})

/**
 * Регистрация устройства. Пространства ещё нет — создаётся с хешем пароля.
 * Есть — пароль обязан совпасть; иначе это чужой ключ или опечатка во фразе.
 */
export async function registerDevice(
  spaceId: string,
  spacePass: string,
  deviceId: string,
  label: { ct: string; iv: string },
): Promise<{ ok: true; token: string; created: boolean } | { ok: false; code: 'WRONG_PASS' | 'REVOKED' }> {
  const passHash = await sha256(`wsx-sync.pass.${spacePass}`)
  let space = await loadSpace(spaceId)
  let created = false
  if (!space) {
    space = { id: spaceId, passHash, createdAt: Date.now(), devices: [], ops: [], seq: 0, wake: [] }
    SPACES.set(spaceId, space)
    created = true
  } else if (!equalConst(space.passHash, passHash)) {
    log('warn', 'sync.wrong-pass', { where: spaceId.slice(0, 8) })
    return { ok: false, code: 'WRONG_PASS' }
  }
  const existing = space.devices.find((d) => d.id === deviceId)
  if (existing?.revokedAt) return { ok: false, code: 'REVOKED' }
  const token = randomHex(24)
  const tokenHash = await sha256(`wsx-sync.token.${token}`)
  const now = Date.now()
  if (existing) {
    existing.tokenHash = tokenHash
    existing.lastSeenAt = now
    existing.label = label
  } else {
    space.devices.push({ id: deviceId, tokenHash, label, createdAt: now, lastSeenAt: now, revokedAt: null })
  }
  await saveSpace(space)
  log('info', 'sync.device', { where: spaceId.slice(0, 8), count: space.devices.length })
  return { ok: true, token, created }
}

export type Auth = { space: Space; device: Device }

/** Проверка устройства: заголовки → пространство и незаотозванное устройство. */
export async function authDevice(
  spaceId: string | null,
  deviceId: string | null,
  token: string | null,
): Promise<Auth | null> {
  if (!isSpaceId(spaceId) || !isDeviceId(deviceId) || !token) return null
  const space = await loadSpace(spaceId)
  const device = space?.devices.find((d) => d.id === deviceId)
  if (!space || !device || device.revokedAt) return null
  if (!equalConst(device.tokenHash, await sha256(`wsx-sync.token.${token}`))) return null
  device.lastSeenAt = Date.now()
  return { space, device }
}

export function listDevices(space: Space): DeviceView[] {
  return space.devices.map(view)
}

/** Заголовки клиента: X-Sync-Space / X-Sync-Device / X-Sync-Token. */
export function authFromHeaders(h: Headers): Promise<Auth | null> {
  return authDevice(h.get('x-sync-space'), h.get('x-sync-device'), h.get('x-sync-token'))
}

export async function revokeDevice(space: Space, id: string): Promise<boolean> {
  const d = space.devices.find((x) => x.id === id)
  if (!d || d.revokedAt) return false
  d.revokedAt = Date.now()
  await saveSpace(space)
  for (const fn of space.wake.splice(0)) fn()
  return true
}

/** Добавить шифртексты в журнал. Сервер не открывает их и не может. */
export async function pushOps(
  auth: Auth,
  sealed: { ct: string; iv: string }[],
): Promise<{ seq: number }> {
  const { space, device } = auth
  await fs.mkdir(dir(space.id), { recursive: true })
  const lines: string[] = []
  for (const s of sealed) {
    const env: Envelope = { seq: ++space.seq, dev: device.id, at: Date.now(), ct: s.ct, iv: s.iv }
    space.ops.push(env)
    lines.push(JSON.stringify(env))
  }
  if (lines.length) await fs.appendFile(path.join(dir(space.id), 'ops.jsonl'), `${lines.join('\n')}\n`, 'utf8')
  await saveSpace(space)
  for (const fn of space.wake.splice(0)) fn()
  return { seq: space.seq }
}

/** Забрать всё после `since`; при пустом ответе ждать до `waitMs`. */
export async function pullOps(
  auth: Auth,
  since: number,
  waitMs: number,
): Promise<{ ops: Envelope[]; seq: number; devices: DeviceView[] }> {
  const { space } = auth
  const fresh = () => space.ops.filter((o) => o.seq > since && o.dev !== auth.device.id)
  if (fresh().length === 0 && waitMs > 0) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        space.wake = space.wake.filter((f) => f !== wake)
        resolve()
      }, waitMs)
      const wake = () => {
        clearTimeout(t)
        resolve()
      }
      space.wake.push(wake)
    })
  }
  return { ops: fresh(), seq: space.seq, devices: listDevices(space) }
}

/** Для тестов. */
export function resetSyncState(): void {
  SPACES.clear()
}
