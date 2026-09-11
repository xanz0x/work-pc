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
import { createHash, randomBytes } from 'node:crypto'
import { requireUser } from './request-context'
import { cloudWrite } from './cloud-write-lock'
import type { CloudNoteSnapshot, CloudSource } from './cloud-types'
import { getUser } from './users-server'
import { accessState } from './users'
import { dropLocalObject, getLocalObject, putLocalObject } from './local-objects'

function cloudEnv(key: 'AI_DIR' | 'INTEGRATION_PROXY_URL') {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing cloud configuration: ${key}`)
  return value
}
const AI_ROOT = cloudEnv('AI_DIR')
const APP = 'worxspacex'

const storageUrl = () => `${cloudEnv('INTEGRATION_PROXY_URL').replace(/\/+$/, '')}/objstore/api/v1/storage`
const localStorage = () => process.env.CLOUD_STORAGE === 'local'

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
    r = await fetch(`${storageUrl()}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emergent_key: key }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new CloudError('PROVIDER', 'Хранилище не отвечает.')
  }
  if (!r.ok) throw new CloudError('PROVIDER', `Не удалось подключиться к хранилищу (HTTP ${r.status}).`)
  storageKey = String((await r.json()).storage_key ?? '')
  if (!storageKey) throw new CloudError('PROVIDER', 'Хранилище не выдало ключ сессии.')
  return storageKey
}

async function putObject(objPath: string, data: Uint8Array, contentType: string): Promise<{ path: string; size: number }> {
  if (localStorage()) {
    try { return await putLocalObject(objPath, data) }
    catch { throw new CloudError('PROVIDER', 'Не удалось сохранить файл на главном ПК. Проверьте свободное место и доступ к папке данных.') }
  }
  const run = async (key: string) =>
    fetch(`${storageUrl()}/objects/${objPath}`, {
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
  if (localStorage()) {
    try { return await getLocalObject(objPath) }
    catch { throw new CloudError('NOT_FOUND', 'Файл не найден на главном ПК или недоступен для чтения.') }
  }
  const run = async (key: string) =>
    fetch(`${storageUrl()}/objects/${objPath}`, { headers: { 'X-Storage-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(60_000) })
  let r = await run(await initStorage())
  if (r.status === 404) r = await run(await initStorage(true))
  if (r.status === 404) throw new CloudError('NOT_FOUND', 'Файл не найден в хранилище.')
  if (!r.ok) throw new CloudError('PROVIDER', `Не удалось скачать файл (${r.status}).`)
  return { data: await r.arrayBuffer(), contentType: r.headers.get('Content-Type') || 'application/octet-stream' }
}

/**
 * Стереть байты объекта. Нужно при удалении файла «вместе с копией», когда
 * файл лежит не в папке на ПК, а во внутреннем хранилище байтов. Ошибку
 * наружу не поднимаем: запись библиотеки всё равно должна уйти, а объект без
 * записи никому не виден.
 */
async function dropObject(objPath: string): Promise<void> {
  if (localStorage()) {
    await dropLocalObject(objPath).catch(() => {})
    return
  }
  try {
    const key = await initStorage()
    await fetch(`${storageUrl()}/objects/${objPath}`, {
      method: 'DELETE',
      headers: { 'X-Storage-Key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    /* хранилище недоступно — байты подчистит владелец хранилища */
  }
}


/* ---------- папка хранения (куда физически пишутся новые файлы) ---------- */
/**
 * Папка на ПК пользователя, выбранная как место хранения общего диска:
 * новые загрузки пишутся в неё под исходными именами. Путь хранится в
 * <AI_DIR>/cloud/storage-root.json. Пока папка не выбрана, действует прежнее
 * поведение — объектное хранилище (в локальном режиме data/cloud/objects);
 * старые объекты остаются читаемыми в любом случае.
 */

const storageRootFile = () => path.join(AI_ROOT, 'cloud', 'storage-root.json')

async function readStorageRoot(): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(storageRootFile(), 'utf8')) as { root?: unknown }
    const root = typeof raw?.root === 'string' ? raw.root.trim() : ''
    return root || null
  } catch {
    return null // файла нет или он повреждён — считаем «папка не выбрана»
  }
}

async function writeStorageRoot(root: string | null): Promise<void> {
  const p = storageRootFile()
  await fs.mkdir(path.dirname(p), { recursive: true })
  if (!root) {
    await fs.rm(p, { force: true })
    return
  }
  const tmp = `${p}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify({ root }, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, p)
}

/** Текущая папка хранения — для UI (менять её может только администратор). */
export async function storageRootView(): Promise<{ root: string | null }> {
  requireAdmin()
  return { root: await readStorageRoot() }
}

/**
 * Задать/изменить/очистить папку хранения. Путь валидируется: папка создаётся
 * при необходимости; если по пути лежит файл — ошибка. Пустая строка
 * отключает папку (возврат к внутреннему объектному хранилищу).
 */
export async function setStorageRoot(raw: unknown): Promise<string | null> {
  requireAdmin()
  const value = String(raw ?? '').trim()
  if (!value) {
    await writeStorageRoot(null)
    return null
  }
  if (value.length > 1024 || value.includes('\0')) {
    throw new CloudError('INVALID_ARGS', 'Некорректный путь к папке.')
  }
  if (!path.isAbsolute(value)) {
    throw new CloudError('INVALID_ARGS', 'Укажите абсолютный путь к папке на этом ПК, например C:\\Users\\Имя\\WorkSpaceX.')
  }
  const abs = path.resolve(value)
  let st: Awaited<ReturnType<typeof fs.stat>> | null = null
  try {
    st = await fs.stat(abs)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new CloudError('INVALID_ARGS', 'Путь недоступен: проверьте букву диска и права доступа.')
    }
  }
  if (st && !st.isDirectory()) {
    throw new CloudError('INVALID_ARGS', 'По этому пути лежит файл — укажите папку.')
  }
  if (!st) {
    try {
      await fs.mkdir(abs, { recursive: true })
    } catch {
      throw new CloudError('PROVIDER', 'Не удалось создать папку: проверьте путь и права доступа.')
    }
  }
  await writeStorageRoot(abs)
  return abs
}

/** Безопасное физическое имя: символы, запрещённые в Windows, — в пробел. */
function safeDiskName(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f<>:"|?*]/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
  const base = cleaned || 'file'
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(base) ? `_${base}` : base
}

/**
 * Записать байты в папку хранения под исходным именем. `relDir` — подпапка
 * внутри корня (пусто — сам корень), она создаётся при необходимости.
 * Имя занято — «имя-1.ext», «имя-2.ext»… Возвращает путь внутри корня.
 */
async function writeIntoRoot(root: string, name: string, data: Uint8Array, relDir = ''): Promise<string> {
  const safe = safeDiskName(name)
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  const candidates = [safe, ...Array.from({ length: 99 }, (_, i) => `${stem}-${i + 1}${ext}`)]
  const segments = relDir.split('/').filter(Boolean).map(safeDiskName)
  const dir = segments.length > 0 ? path.join(root, segments.join('/')) : root
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    throw new CloudError('PROVIDER', 'Папка хранения недоступна: проверьте путь и права доступа.')
  }
  for (const candidate of candidates) {
    const target = path.join(dir, candidate)
    let handle: Awaited<ReturnType<typeof fs.open>>
    try {
      handle = await fs.open(target, 'wx', 0o600)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw new CloudError('PROVIDER', 'Не удалось записать файл в папку хранения. Проверьте свободное место и права доступа.')
    }
    try {
      await handle.writeFile(data)
      return [...segments, candidate].join('/')
    } catch {
      await fs.rm(target, { force: true })
      throw new CloudError('PROVIDER', 'Не удалось записать файл в папку хранения. Проверьте свободное место и права доступа.')
    } finally {
      await handle.close()
    }
  }
  throw new CloudError('PROVIDER', 'В папке хранения слишком много файлов с таким именем.')
}

/* ---------- перенос старых объектов в выбранную папку ---------- */

export type StorageMigrationReport = {
  /** Сколько объектов физически скопировано в папку хранения. */
  copied: number
  /** Сколько объектов скопировать не удалось (это не фатально). */
  failed: number
  /** «имя: причина» по каждому неудавшемуся объекту. */
  errors: string[]
}

const sameDir = (a: string, b: string): boolean => path.resolve(a) === path.resolve(b)

/** absPath объекта внутри папки хранения; null — путь вылезает за корень. */
function absPathInRoot(root: string, relPath: string): string | null {
  const abs = path.resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return abs
}

/**
 * Перенести все живые объекты общего диска в выбранную папку: байты
 * читаются из прежней папки (relPath) или объектного хранилища (path)
 * и пишутся в новую под исходными именами (коллизии — «имя-1.ext»).
 * Ошибка одного объекта не фатальна: он остаётся читаемым на прежнем
 * месте, а отчёт называет причину. Метаданные обновляются только у
 * успешно перенесённых объектов.
 */
async function migrateObjectsIntoRoot(root: string, previousRoot: string | null): Promise<StorageMigrationReport> {
  return cloudWrite(async () => {
    const d = await readDrive()
    const report: StorageMigrationReport = { copied: 0, failed: 0, errors: [] }
    const rootResolved = path.resolve(root)
    const previousResolved = previousRoot ? path.resolve(previousRoot) : null
    for (const f of d.files) {
      if (f.deleted) continue
      /* Файл с relPath физически лежит в папке: в прежней (если она была)
         или — при повторном выборе после отключения — в самой новой папке. */
      if (f.relPath) {
        if (!previousResolved || sameDir(previousResolved, rootResolved)) continue
        try {
          const from = path.resolve(previousResolved, f.relPath)
          if (from !== previousResolved && !from.startsWith(previousResolved + path.sep)) {
            throw new Error('файл лежит вне прежней папки хранения')
          }
          const data = new Uint8Array(await fs.readFile(from))
          f.relPath = await writeIntoRoot(rootResolved, f.name, data, f.dir)
          f.path = f.relPath
          report.copied += 1
        } catch (e) {
          report.failed += 1
          report.errors.push(`${f.name}: ${e instanceof Error ? e.message : 'ошибка копирования'}`)
        }
        continue
      }
      /* Легаси-объект — байты достаём из объектного хранилища. */
      try {
        const data = new Uint8Array((await getObject(f.path)).data)
        f.relPath = await writeIntoRoot(rootResolved, f.name, data, f.dir)
        f.path = f.relPath
        report.copied += 1
      } catch (e) {
        report.failed += 1
        report.errors.push(`${f.name}: ${e instanceof Error ? e.message : 'ошибка копирования'}`)
      }
    }
    if (report.copied > 0) await writeDrive(d)
    return report
  })
}

/**
 * Задать/изменить/очистить папку хранения, а при migrate:true — перенести
 * в новую папку все живые объекты диска. Отчёт о переносе возвращается
 * только когда перенос выполнялся.
 */
export async function setStorageRootMigrating(
  raw: unknown,
  migrate: boolean,
): Promise<{ root: string | null; migrated?: StorageMigrationReport }> {
  requireAdmin()
  const previousRoot = await readStorageRoot()
  const root = await setStorageRoot(raw)
  if (!root || !migrate) return { root }
  return { root, migrated: await migrateObjectsIntoRoot(root, previousRoot) }
}

/* ---------- метаданные общего диска ---------- */

/** Тип файла, определённый конвейером анализа (mime/расширение). */
export type CloudAnalysisKind =
  | 'text'
  | 'code'
  | 'markdown'
  | 'pdf'
  | 'docx'
  | 'archive'
  | 'image'
  | 'unknown'

export type CloudFile = {
  id: string
  name: string
  /** Папка (путь через «/», '' — корень). */
  dir: string
  /** Путь объекта в хранилище. Для файлов из папки хранения — совпадает с relPath. */
  path: string
  /** Файл лежит в папке хранения: путь относительно её корня (исходное имя файла). */
  relPath?: string
  /** SHA-256 содержимого, считается при загрузке. */
  sha256?: string
  /** Результат анализа содержимого — пишет серверный конвейер анализа. */
  title?: string
  description?: string
  /** Метки от модели-архивариуса (до 5): тема, тип, назначение. */
  analysisTags?: string[]
  analysisStatus?: 'queued' | 'done' | 'partial' | 'failed'
  analysisKind?: CloudAnalysisKind
  analyzedAt?: string
  analysisError?: string
  contentType: string
  size: number
  by: string
  at: string
  deleted: boolean
  /**
   * Файл лежит на общем диске (виден всем участникам). false — личный файл:
   * он физически в локальной папке хранения и виден только владельцу, пока
   * тот не добавит его в общую папку вручную. Старые записи без поля
   * считаются общими: раньше весь диск был общим.
   */
  shared?: boolean
  kind?: 'file' | 'note'
  source?: CloudSource
  note?: CloudNoteSnapshot
}

export type Drive = {
  inviteCode: string
  members: string[]
  folders: string[]
  files: CloudFile[]
}

const driveFile = () => path.join(AI_ROOT, 'cloud', 'drive.json')

async function readDrive(): Promise<Drive> {
  const context = requireUser()
  const user = await getUser(context.uid)
  if (!user || user.role !== context.role || accessState(user) !== 'ok' || (user.role !== 'admin' && !user.features.cloud)) {
    throw new CloudError('FORBIDDEN', 'Общий диск недоступен для этой учётной записи.')
  }
  try {
    const d = JSON.parse(await fs.readFile(driveFile(), 'utf8')) as Drive
    return { inviteCode: d.inviteCode || '', members: d.members ?? [], folders: d.folders ?? [], files: d.files ?? [] }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new CloudError('PROVIDER', 'Не удалось прочитать общий диск. Данные не изменены.')
    }
    // Только первый доступ. Ошибка чтения/JSON не должна обнулять общий диск.
    const fresh: Drive = { inviteCode: randomBytes(4).toString('hex'), members: [], folders: [], files: [] }
    await fs.mkdir(path.dirname(driveFile()), { recursive: true })
    try {
      await fs.writeFile(driveFile(), JSON.stringify(fresh), { flag: 'wx', mode: 0o600 })
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code === 'EEXIST') return readDrive()
      throw new CloudError('PROVIDER', 'Не удалось подготовить общий диск.')
    }
    return fresh
  }
}

async function writeDrive(d: Drive): Promise<void> {
  const p = driveFile()
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(d, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, p)
}

/* ---------- доступ ---------- */

const isAdmin = (): boolean => requireUser().role === 'admin'

/** Записи без поля shared остались со времён, когда весь диск был общим. */
const isShared = (f: { shared?: boolean }): boolean => f.shared !== false

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
  /** Папка хранения — только администратору (он ею управляет). */
  storageRoot?: string | null
  folders: string[]
  files: CloudFileView[]
}

/** Файл в виде для клиента: path спрятан, absPath отдаётся только админу. */
export type CloudFileView = Omit<CloudFile, 'path'> & {
  /** Абсолютный путь файла в папке хранения (админ + выбранная папка + relPath). */
  absPath?: string
}

export async function driveView(): Promise<DriveView> {
  const d = await readDrive()
  const admin = isAdmin()
  const member = await isMember(d)
  if (!member) return { isAdmin: admin, member: false, folders: [], files: [] }
  const uid = requireUser().uid
  const root = admin ? await readStorageRoot() : null
  return {
    isAdmin: admin,
    member: true,
    inviteCode: admin ? d.inviteCode : undefined,
    membersCount: admin ? d.members.length : undefined,
    ...(admin ? { storageRoot: root } : {}),
    folders: d.folders.slice().sort(),
    /* Личные файлы (shared:false) видит только их владелец: локальная папка
       на ПК — личное хранилище, общим становится лишь добавленное вручную. */
    files: d.files.filter((f) => !f.deleted && (isShared(f) || f.by === uid)).map(({ path: _p, source, ...rest }) => ({
      ...rest,
      shared: isShared(rest as CloudFile),
      /* absPath нужен админу для «Открыть на ПК»/«Показать в папке» через мост. */
      ...(admin && root && rest.relPath ? { absPath: absPathInRoot(root, rest.relPath) ?? undefined } : {}),
      // Связь с личным оригиналом нужна только создателю копии.
      ...(rest.by === uid && source ? { source } : {}),
    })),
  }
}

/** Войти на общий диск по секретному коду. */
async function joinDriveImpl(code: string): Promise<boolean> {
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
async function rotateInviteImpl(): Promise<string> {
  if (!isAdmin()) throw new CloudError('FORBIDDEN', 'Только администратор может менять код.')
  const d = await readDrive()
  d.inviteCode = randomBytes(4).toString('hex')
  await writeDrive(d)
  return d.inviteCode
}

async function createFolderImpl(parent: string, name: string): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const nm = cleanName(name)
  if (!nm) throw new CloudError('INVALID_ARGS', 'Укажите имя папки.')
  const p = cleanDir(parent ? `${parent}/${nm}` : nm)
  if (!p) throw new CloudError('INVALID_ARGS', 'Некорректное имя папки.')
  /* Папка настоящая: создаём её на диске внутри выбранной папки хранения. */
  const root = await readStorageRoot()
  if (root) {
    const rel = p.split('/').map(safeDiskName).join('/')
    const abs = path.resolve(root, rel)
    try {
      await fs.mkdir(/*turbopackIgnore: true*/ abs, { recursive: true })
    } catch {
      throw new CloudError('PROVIDER', 'Не удалось создать папку на диске: проверьте права доступа.')
    }
  }
  if (!d.folders.includes(p)) {
    d.folders.push(p)
    await writeDrive(d)
  }
}

async function removeFolderImpl(dirPath: string): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const p = cleanDir(dirPath)
  if (!p) throw new CloudError('INVALID_ARGS', 'Не указана папка.')
  d.folders = d.folders.filter((f) => f !== p && !f.startsWith(`${p}/`))
  for (const f of d.files) if (!f.deleted && (f.dir === p || f.dir.startsWith(`${p}/`))) f.deleted = true
  await writeDrive(d)
}

async function uploadFileImpl(
  name: string,
  dir: string,
  data: Uint8Array,
  contentType: string,
  opts: { shared?: boolean; source?: CloudSource; note?: CloudNoteSnapshot } = {},
): Promise<CloudFile> {
  const { shared = true, source, note } = opts
  const d = await readDrive()
  requireAdmin()
  if (source) {
    const existing = d.files.find((f) => !f.deleted && f.by === requireUser().uid && f.source?.kind === source.kind && f.source.id === source.id)
    if (existing) return existing
  }
  const nm = cleanName(name) || 'file'
  const dirPath = cleanDir(dir)
  const root = await readStorageRoot()
  let objPath: string
  let relPath: string | undefined
  let size: number
  if (root) {
    /* Выбрана папка на ПК: байты физически пишутся в неё (в подпапку, если
       человек выбрал её при добавлении) под исходным именем. */
    relPath = await writeIntoRoot(root, nm, data, dirPath)
    objPath = relPath
    size = data.byteLength
  } else {
    /* Прежнее поведение: объектное хранилище (или data/cloud/objects локально). */
    const ext = nm.includes('.') ? nm.split('.').pop() : 'bin'
    objPath = `${APP}/cloud/${randomBytes(12).toString('hex')}.${ext}`
    const put = await putObject(objPath, data, contentType || 'application/octet-stream')
    size = put.size
  }
  const file: CloudFile = {
    id: randomBytes(6).toString('hex'),
    name: nm,
    dir: dirPath,
    path: objPath,
    ...(relPath ? { relPath } : {}),
    sha256: createHash('sha256').update(data).digest('hex'),
    contentType: contentType || 'application/octet-stream',
    size,
    by: requireUser().uid,
    at: new Date().toISOString(),
    deleted: false,
    shared,
    ...(source ? { source, kind: source.kind } : {}),
    ...(note ? { note } : {}),
  }
  d.files.push(file)
  await writeDrive(d)
  return file
}

async function renameFileImpl(id: string, name: string): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const f = d.files.find((x) => x.id === id && !x.deleted)
  if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
  const nm = cleanName(name)
  if (!nm) throw new CloudError('INVALID_ARGS', 'Укажите имя файла.')
  f.name = nm
  await writeDrive(d)
}

async function deleteFileImpl(id: string, opts: { removeBytes?: boolean } = {}): Promise<void> {
  const d = await readDrive()
  requireAdmin()
  const f = d.files.find((x) => x.id === id && !x.deleted)
  if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
  /* «Удалить также с ПК»: байты в папке хранения стираются до пометки записи.
     Если байты не ушли — запись остаётся живой: файл не должен исчезнуть из
     библиотеки, продолжая лежать на диске. */
  if (opts.removeBytes && f.relPath) {
    const root = await readStorageRoot()
    if (!root) throw new CloudError('PROVIDER', 'Папка хранения не выбрана: файл нельзя удалить с ПК.')
    const abs = path.resolve(root, f.relPath)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new CloudError('FORBIDDEN', 'Файл находится вне папки хранения.')
    }
    // Windows держит файл, если он открыт просмотрщиком: несколько попыток.
    let removed = false
    for (let attempt = 0; attempt < 3 && !removed; attempt += 1) {
      try {
        await fs.rm(/*turbopackIgnore: true*/ abs, { force: true })
        removed = true
      } catch {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    if (!removed || (await fs.stat(abs).then(() => true).catch(() => false))) {
      throw new CloudError('PROVIDER', 'Не удалось удалить файл с ПК: закройте его в просмотрщике или проводнике и повторите.')
    }
  } else if (opts.removeBytes && !f.relPath) {
    /* Файл лежит не в папке хранения, а во внутреннем хранилище байтов
       (так бывает у файлов, добавленных до выбора папки на ПК). Раз человек
       просил стереть копию — стираем и её. */
    await dropObject(f.path)
  }
  f.deleted = true
  await writeDrive(d)
}

export async function readFileBytes(id: string): Promise<{ name: string; contentType: string; data: ArrayBuffer }> {
  const d = await readDrive()
  requireMember(d)
  const f = d.files.find((x) => x.id === id && !x.deleted)
  if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
  if (!isShared(f) && f.by !== requireUser().uid) {
    throw new CloudError('FORBIDDEN', 'Это личный файл владельца локальной папки.')
  }
  if (f.relPath) {
    /* Новый файл лежит в папке хранения под исходным именем. */
    const root = await readStorageRoot()
    if (!root) throw new CloudError('PROVIDER', 'Папка хранения не выбрана: укажите её в настройках общего облака, чтобы читать этот файл.')
    const abs = path.resolve(root, f.relPath)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new CloudError('FORBIDDEN', 'Файл находится вне папки хранения.')
    }
    try {
      const buf = await fs.readFile(/*turbopackIgnore: true*/ abs)
      return {
        name: f.name,
        contentType: f.contentType || 'application/octet-stream',
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      }
    } catch {
      throw new CloudError('NOT_FOUND', 'Файла нет в папке хранения: папка была перемещена, переименована или файл удалён вручную.')
    }
  }
  const obj = await getObject(f.path)
  return { name: f.name, contentType: f.contentType || obj.contentType, data: obj.data }
}

/* ---------- конвейер анализа (lib/file-analyzer.ts) ---------- */

export type AnalysisInput = {
  id: string
  name: string
  contentType: string
  size: number
  /** Уже сохранённый результат прошлого анализа (если был). */
  analysis?: {
    title?: string
    description?: string
    analysisTags?: string[]
    analysisStatus?: 'queued' | 'done' | 'partial' | 'failed'
    analysisKind?: CloudAnalysisKind
    analyzedAt?: string
    analysisError?: string
  }
}

/** Метаданные объекта для анализа: без байтов, чтобы большие файлы не читать зря. */
export async function getAnalysisInput(id: string): Promise<AnalysisInput> {
  const d = await readDrive()
  requireMember(d)
  const f = d.files.find((x) => x.id === id && !x.deleted)
  if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
  return {
    id: f.id,
    name: f.name,
    contentType: f.contentType || 'application/octet-stream',
    size: f.size,
    ...(f.title || f.description || f.analysisStatus || f.analysisKind || f.analyzedAt || f.analysisError || f.analysisTags
      ? {
          analysis: {
            ...(f.title ? { title: f.title } : {}),
            ...(f.description ? { description: f.description } : {}),
            ...(f.analysisTags ? { analysisTags: f.analysisTags } : {}),
            ...(f.analysisStatus ? { analysisStatus: f.analysisStatus } : {}),
            ...(f.analysisKind ? { analysisKind: f.analysisKind } : {}),
            ...(f.analyzedAt ? { analyzedAt: f.analyzedAt } : {}),
            ...(f.analysisError ? { analysisError: f.analysisError } : {}),
          },
        }
      : {}),
  }
}

export type AnalysisPatch = {
  title?: string
  description?: string
  analysisTags?: string[]
  analysisStatus?: 'queued' | 'done' | 'partial' | 'failed'
  analysisKind?: CloudAnalysisKind
  analyzedAt?: string
  analysisError?: string
}

/** Сохранить результат анализа в метаданные объекта. */
export async function setFileAnalysis(id: string, patch: AnalysisPatch): Promise<void> {
  await cloudWrite(async () => {
    const d = await readDrive()
    requireMember(d)
    const f = d.files.find((x) => x.id === id && !x.deleted)
    if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
    if ('title' in patch) f.title = patch.title
    if ('description' in patch) f.description = patch.description
    if ('analysisTags' in patch) f.analysisTags = patch.analysisTags
    if ('analysisStatus' in patch) f.analysisStatus = patch.analysisStatus
    if ('analysisKind' in patch) f.analysisKind = patch.analysisKind
    if ('analyzedAt' in patch) f.analyzedAt = patch.analyzedAt
    if ('analysisError' in patch) f.analysisError = patch.analysisError
    await writeDrive(d)
  })
}

export const joinDrive = (code: string) => cloudWrite(() => joinDriveImpl(code))
export const rotateInvite = () => cloudWrite(rotateInviteImpl)
export const createFolder = (parent: string, name: string) => cloudWrite(() => createFolderImpl(parent, name))
export const removeFolder = (dir: string) => cloudWrite(() => removeFolderImpl(dir))
export const renameFile = (id: string, name: string) => cloudWrite(() => renameFileImpl(id, name))
export const deleteFile = (id: string, opts: { removeBytes?: boolean } = {}) => cloudWrite(() => deleteFileImpl(id, opts))
export const uploadFile = (name: string, dir: string, data: Uint8Array, contentType: string, shared = true) =>
  cloudWrite(() => uploadFileImpl(name, dir, data, contentType, { shared }))

/** Повторный запрос для того же личного объекта возвращает прежнюю общую копию. */
export const shareFile = (sourceId: string, name: string, data: Uint8Array, contentType: string) =>
  cloudWrite(() => uploadFileImpl(name, '', data, contentType, { shared: true, source: { kind: 'file', id: sourceId } }))

export const shareNote = (sourceId: string, note: CloudNoteSnapshot) => cloudWrite(() => {
  const bytes = new TextEncoder().encode(JSON.stringify(note))
  return uploadFileImpl(`${note.title}.json`, '', bytes, 'application/json; charset=utf-8', {
    shared: true,
    source: { kind: 'note', id: sourceId },
    note,
  })
})

/**
 * Перевести файл между «моей папкой» и общим диском. Байты не двигаются:
 * файл так и лежит в локальной папке хранения, меняется только видимость
 * для участников. Так задумано: локальная папка — личная, в общую попадает
 * только то, что человек добавил сам.
 */
export const setFileShared = (id: string, shared: boolean) =>
  cloudWrite(async () => {
    const d = await readDrive()
    requireAdmin()
    const f = d.files.find((x) => x.id === id && !x.deleted)
    if (!f) throw new CloudError('NOT_FOUND', 'Файл не найден.')
    f.shared = shared
    await writeDrive(d)
  })
