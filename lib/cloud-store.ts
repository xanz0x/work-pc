/* ============================================================
   ОБЩЕЕ ОБЛАКО (сервер)
   Один общий диск на всё приложение: файлы лежат в объектном
   хранилище Emergent (EMERGENT_LLM_KEY + INTEGRATION_PROXY_URL),
   а метаданные (имена, папки, кто загрузил) — в общем JSON
   AI_DIR/cloud/drive.json. Доступ: администраторы всегда, плюс
   участники, вошедшие по секретному коду-приглашению.
   Хранилище не умеет удалять/переименовывать — поэтому удаление
   мягкое (deleted:true), а переименование меняет только метаданные.
   ============================================================ */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { requireUser } from './request-context'

const AI_ROOT = process.env.AI_DIR?.trim() || path.join(process.cwd(), 'ai')
const APP = 'worxspacex'

const STORAGE_BASE = (process.env.INTEGRATION_PROXY_URL || '').trim() || 'https://integrations.emergentagent.com'
const STORAGE_URL = `${STORAGE_BASE.replace(/\/+$/, '')}/objstore/api/v1/storage`

export type CloudErrorCode = 'NO_KEY' | 'PROVIDER' | 'NOT_FOUND' | 'INVALID_ARGS' | 'FORBIDDEN'

export class CloudError extends Error {
  constructor(
    public code: CloudErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/* ---------- объектное хранилище ---------- */

let storageKey: string | null = null

async function initStorage(force = false): Promise<string> {
  if (storageKey && !force) return storageKey
  const key = process.env.EMERGENT_LLM_KEY?.trim()
  if (!key) throw new CloudError('NO_KEY', 'Облако выключено: на сервере не задан EMERGENT_LLM_KEY.')
  let r: Response
  try {
    r = await fetch(`${STORAGE_URL}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emergent_key: key }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new CloudError('PROVIDER', 'Хранилище не отвечает.')
  }
  if (!r.ok) throw new CloudError('PROVIDER', `Хранилище отклонило ключ (init ${r.status}).`)
  storageKey = String((await r.json()).storage_key ?? '')
  if (!storageKey) throw new CloudError('PROVIDER', 'Хранилище не выдало ключ сессии.')
  return storageKey
}

async function putObject(objPath: string, data: Uint8Array, contentType: string): Promise<{ path: string; size: number }> {
  const run = async (key: string) =>
    fetch(`${STORAGE_URL}/objects/${objPath}`, {
      method: 'PUT',
      headers: { 'X-Storage-Key': key, 'Content-Type': contentType },
      body: data,
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    })
  let r = await run(await initStorage())
  if (r.status === 404) r = await run(await initStorage(true))
  if (!r.ok) throw new CloudError('PROVIDER', `Не удалось загрузить файл (${r.status}).`)
  const body = (await r.json()) as { path?: string; size?: number }
  return { path: body.path ?? objPath, size: Number(body.size) || data.byteLength }
}

async function getObject(objPath: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const run = async (key: string) =>
    fetch(`${STORAGE_URL}/objects/${objPath}`, { headers: { 'X-Storage-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  let r = await run(await initStorage())
  if (r.status === 404) r = await run(await initStorage(true))
  if (r.status === 404) throw new CloudError('NOT_FOUND', 'Файл не найден в хранилище.')
  if (!r.ok) throw new CloudError('PROVIDER', `Не удалось скачать файл (${r.status}).`)
  return { data: await r.arrayBuffer(), contentType: r.headers.get('Content-Type') || 'application/octet-stream' }
}

/* ---------- метаданные общего диска ---------- */

export type CloudFile = {
  id: string
  name: string
  /** Папка (путь через «/», '' — корень). */
  dir: string
  /** Путь объекта в хранилище. */
  path: string
  contentType: string
  size: number
  by: string
  at: string
  deleted: boolean
}

export type Drive = {
  inviteCode: string
  members: string[]
  folders: string[]
  files: CloudFile[]
}

const driveFile = () => path.join(AI_ROOT, 'cloud', 'drive.json')

async function readDrive(): Promise<Drive> {
  try {
    const d = JSON.parse(await fs.readFile(driveFile(), 'utf8')) as Drive
    return { inviteCode: d.inviteCode || '', members: d.members ?? [], folders: d.folders ?? [], files: d.files ?? [] }
  } catch {
    /* Первый доступ: сразу фиксируем код-приглашение на диске, иначе при
       каждом чтении до первой записи он был бы новым и ссылка «протухала» бы. */
    const fresh: Drive = { inviteCode: randomBytes(4).toString('hex'), members: [], folders: [], files: [] }
    await writeDrive(fresh).catch(() => {})
    return fresh
  }
}

async function writeDrive(d: Drive): Promise<void> {
  const p = driveFile()
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(d, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, p)
}

/* ---------- доступ ---------- */

const isAdmin = (): boolean => requireUser().role === 'admin'

/** Менять общий диск (загрузка, удаление, папки) может только администратор. */
function requireAdmin(): void {
  if (requireUser().role !== 'admin') {
    throw new CloudError('FORBIDDEN', 'Изменять общий диск может только администратор. Приглашённым доступны просмотр и скачивание.')
  }
}

async function isMember(d: Drive): Promise<boolean> {
  const u = requireUser()
  return u.role === 'admin' || d.members.includes(u.uid)
}

function requireMember(d: Drive): void {
  const u = requireUser()
  if (u.role !== 'admin' && !d.members.includes(u.uid)) {
    throw new CloudError('FORBIDDEN', 'Нет доступа к общему диску. Войдите по коду-приглашению.')
  }
}

const cleanName = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/[\r\n\t/\\]+/g, ' ')
    .trim()
    .slice(0, 160)

const cleanDir = (raw: unknown): string =>
  String(raw ?? '')
    .split('/')
    .map((s) => s.replace(/[\\]+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('/')

/* ---------- вид для клиента ---------- */

export type DriveView = {
  isAdmin: boolean
  member: boolean
  /** Код-приглашение показываем только администратору. */
  inviteCode?: string
  membersCount?: number
  folders: string[]
  files: Omit<CloudFile, 'path'>[]
}

export async function driveView(): Promise<DriveView> {
  const d = await readDrive()
  const admin = isAdmin()
  const member = await isMember(d)
  if (!member) return { isAdmin: admin, member: false, folders: [], files: [] }
  return {
    isAdmin: admin,
    member: true,
    inviteCode: admin ? d.inviteCode : undefined,
    membersCount: admin ? d.members.length : undefined,
    folders: d.folders.slice().sort(),
    files: d.files.filter((f) => !f.deleted).map(({ path: _p, ...rest }) => rest),
  }
}

/** Войти на общий диск по секретному коду. */
export async function joinDrive(code: string): Promise<boolean> {
  const d = await readDrive()
  if (!code || code.trim().toLowerCase() !== d.inviteCode.toLowerCase()) {
    throw new CloudError('INVALID_ARGS', 'Неверный код-приглашение.')
  }
  const uid = requireUser().uid
  if (!d.members.includes(uid)) {
    d.members.push(uid)
    await writeDrive(d)
  }
  return true
}

/** Сменить код-приглашение (только админ). */
export async function rotateInvite(): Promise<string> {
  if (!isAdmin()) throw new CloudError('FORBIDDEN', 'Только администратор может менять код.')
  const d = await readDrive()
  d.inviteCode = randomBytes(4).toString('hex')
  await writeDrive(d)
  return d.inviteCode
}

export async function createFolder(parent: string, name: string): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const nm = cleanName(name)
  if (!nm) throw new CloudError('INVALID_ARGS', 'Укажите имя папки.')
  const p = cleanDir(parent ? `${parent}/${nm}` : nm)
  if (!p) throw new CloudError('INVALID_ARGS', 'Некорректное имя папки.')
  if (!d.folders.includes(p)) {
    d.folders.push(p)
    await writeDrive(d)
  }
}

export async function removeFolder(dirPath: string): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const p = cleanDir(dirPath)
  if (!p) throw new CloudError('INVALID_ARGS', 'Не указана папка.')
  d.folders = d.folders.filter((f) => f !== p && !f.startsWith(`${p}/`))
  for (const f of d.files) if (!f.deleted && (f.dir === p || f.dir.startsWith(`${p}/`))) f.deleted = true
  await writeDrive(d)
}

export async function uploadFile(name: string, dir: string, data: Uint8Array, contentType: string): Promise<CloudFile> {
  const d = await readDrive()
  requireAdmin()
  const nm = cleanName(name) || 'file'
  const ext = nm.includes('.') ? nm.split('.').pop() : 'bin'
  const objPath = `${APP}/cloud/${randomBytes(12).toString('hex')}.${ext}`
  const put = await putObject(objPath, data, contentType || 'application/octet-stream')
  const file: CloudFile = {
    id: randomBytes(6).toString('hex'),
    name: nm,
    dir: cleanDir(dir),
    path: put.path,
    contentType: contentType || 'application/octet-stream',
    size: put.size,
    by: requireUser().uid,
    at: new Date().toISOString(),
    deleted: false,
  }
  d.files.push(file)
  await writeDrive(d)
  return file
}

export async function renameFile(id: string, name: string): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const f = d.files.find((x) => x.id === id && !x.deleted)
  if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
  const nm = cleanName(name)
  if (!nm) throw new CloudError('INVALID_ARGS', 'Укажите имя файла.')
  f.name = nm
  await writeDrive(d)
}

export async function deleteFile(id: string): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const f = d.files.find((x) => x.id === id && !x.deleted)
  if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
  f.deleted = true
  await writeDrive(d)
}

export async function readFileBytes(id: string): Promise<{ name: string; contentType: string; data: ArrayBuffer }> {
  const d = await readDrive()
  requireMember(d)
  const f = d.files.find((x) => x.id === id && !x.deleted)
  if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
  const obj = await getObject(f.path)
  return { name: f.name, contentType: f.contentType || obj.contentType, data: obj.data }
}
