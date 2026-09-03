/* ============================================================
   NF-7 · ХРАНЕНИЕ СНИМКОВ И РОТАЦИЯ
   Снимки живут там же, где сейф: IndexedDB. Индекс (мета-список) —
   один документ, каждый снимок — свой документ, чтобы список открывался
   мгновенно и не тащил за собой мегабайты шифртекста.

   Ротация — часть записи, а не отдельная кнопка: как только снимков
   становится больше `keep`, самые старые удаляются вместе со своими
   документами. Пароль снимка не хранится в открытом виде: он завёрнут
   мастер-ключом сеанса (sealWithMaster), поэтому снимок по расписанию
   не требует ввода пароля, а без открытого сейфа его не достать.
   ============================================================ */

import { docs } from '@/lib/db'
import {
  isPortableBlob,
  openWithMaster,
  sealWithMaster,
  type PortableBlob,
} from '@/lib/secrets-crypto'
import { ALL_MODULE_IDS, type ModuleId } from './registry'

export const BACKUP_CONFIG_KEY = 'wf.backup.config.v1'
export const BACKUP_INDEX_KEY = 'wf.backup.index.v1'
export const SNAP_PREFIX = 'wf.backup.snap.'

export const FILE_KIND = 'workflow-vault-backup'
export const FILE_EXT = 'vaultbak'

export type Schedule = 'off' | 'daily' | 'weekly'

export const KEEP_CHOICES = [3, 5, 10]

export type BackupConfig = {
  v: 1
  schedule: Schedule
  /** Сколько снимков держать: остальное удаляет ротация. */
  keep: number
  modules: ModuleId[]
  lastAt: number | null
  /** Пароль снимка под мастер-ключом сеанса. */
  pwd: { ct: string; iv: string } | null
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  v: 1,
  schedule: 'off',
  keep: 5,
  modules: ALL_MODULE_IDS,
  lastAt: null,
  pwd: null,
}

export type SnapshotMeta = {
  id: string
  at: number
  auto: boolean
  /** Размер шифртекста снимка в байтах. */
  bytes: number
  build: string
  modules: { id: ModuleId; items: number; docs: number }[]
  hasKeys: boolean
}

function normalizeConfig(raw: unknown): BackupConfig {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_BACKUP_CONFIG
  const b = raw as Partial<BackupConfig>
  const schedule: Schedule =
    b.schedule === 'daily' || b.schedule === 'weekly' || b.schedule === 'off' ? b.schedule : 'off'
  const modules = Array.isArray(b.modules)
    ? b.modules.filter((m): m is ModuleId => ALL_MODULE_IDS.includes(m as ModuleId))
    : ALL_MODULE_IDS
  return {
    v: 1,
    schedule,
    keep: typeof b.keep === 'number' && b.keep >= 1 && b.keep <= 20 ? Math.round(b.keep) : 5,
    modules: modules.length > 0 ? modules : ALL_MODULE_IDS,
    lastAt: typeof b.lastAt === 'number' ? b.lastAt : null,
    pwd:
      typeof b.pwd === 'object' && b.pwd !== null &&
      typeof (b.pwd as { ct?: unknown }).ct === 'string' &&
      typeof (b.pwd as { iv?: unknown }).iv === 'string'
        ? { ct: (b.pwd as { ct: string }).ct, iv: (b.pwd as { iv: string }).iv }
        : null,
  }
}

export async function readConfig(): Promise<BackupConfig> {
  return normalizeConfig(await docs.get(BACKUP_CONFIG_KEY))
}

export async function writeConfig(patch: Partial<BackupConfig>): Promise<BackupConfig> {
  const next = normalizeConfig({ ...(await readConfig()), ...patch })
  await docs.put(BACKUP_CONFIG_KEY, next)
  return next
}

/* ---------- пароль снимка ---------- */

/** Запомнить пароль под мастер-ключом: авто-снимки не спрашивают его снова. */
export async function rememberPassword(password: string): Promise<boolean> {
  const sealed = await sealWithMaster(password)
  if (!sealed) return false
  await writeConfig({ pwd: sealed })
  return true
}

export async function forgetPassword(): Promise<void> {
  await writeConfig({ pwd: null })
}

/** null = пароль не запомнен либо сейф закрыт. */
export async function recallPassword(): Promise<string | null> {
  const cfg = await readConfig()
  if (!cfg.pwd) return null
  return openWithMaster(cfg.pwd.ct, cfg.pwd.iv)
}

/* ---------- список снимков ---------- */

function normalizeIndex(raw: unknown): SnapshotMeta[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (m): m is SnapshotMeta =>
      typeof m === 'object' &&
      m !== null &&
      typeof (m as SnapshotMeta).id === 'string' &&
      typeof (m as SnapshotMeta).at === 'number',
  )
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const list = normalizeIndex(await docs.get(BACKUP_INDEX_KEY))
  return [...list].sort((a, b) => b.at - a.at)
}

export async function readSnapshot(id: string): Promise<PortableBlob | null> {
  const raw = await docs.get(`${SNAP_PREFIX}${id}`)
  return isPortableBlob(raw) ? raw : null
}

/**
 * Записать снимок и провернуть ротацию.
 * Возвращает список снимков после записи — вместе с тем, что удалено.
 */
export async function saveSnapshot(
  meta: SnapshotMeta,
  blob: PortableBlob,
  keep: number,
): Promise<{ ok: boolean; list: SnapshotMeta[]; dropped: SnapshotMeta[] }> {
  /* Не поместилось — снимка нет. Список не трогаем: он обязан описывать
     то, что действительно лежит в хранилище. */
  const ok = await docs.put(`${SNAP_PREFIX}${meta.id}`, blob)
  if (!ok) return { ok: false, list: await listSnapshots(), dropped: [] }
  const all = [meta, ...(await listSnapshots()).filter((m) => m.id !== meta.id)].sort(
    (a, b) => b.at - a.at,
  )
  const list = all.slice(0, Math.max(1, keep))
  const dropped = all.slice(list.length)
  for (const old of dropped) await docs.remove(`${SNAP_PREFIX}${old.id}`)
  await docs.put(BACKUP_INDEX_KEY, list)
  return { ok: true, list, dropped }
}

export async function removeSnapshot(id: string): Promise<SnapshotMeta[]> {
  const list = (await listSnapshots()).filter((m) => m.id !== id)
  await docs.remove(`${SNAP_PREFIX}${id}`)
  await docs.put(BACKUP_INDEX_KEY, list)
  return list
}

/* ---------- файл на диск ---------- */

export type SnapshotFile = {
  kind: typeof FILE_KIND
  v: 1
  at: number
  build: string
  modules: ModuleId[]
  hasKeys: boolean
  blob: PortableBlob
}

export function snapshotFile(meta: SnapshotMeta, blob: PortableBlob): { name: string; text: string } {
  const stamp = new Date(meta.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const file: SnapshotFile = {
    kind: FILE_KIND,
    v: 1,
    at: meta.at,
    build: meta.build,
    modules: meta.modules.map((m) => m.id),
    hasKeys: meta.hasKeys,
    blob,
  }
  return { name: `workflow-vault-${stamp}.${FILE_EXT}`, text: JSON.stringify(file, null, 2) }
}

/** null = это не файл снимка: подсказку о причине даёт вызывающий. */
export function parseSnapshotFile(text: string): SnapshotFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const box = parsed as Partial<SnapshotFile>
  if (box.kind !== FILE_KIND || !isPortableBlob(box.blob)) return null
  return {
    kind: FILE_KIND,
    v: 1,
    at: typeof box.at === 'number' ? box.at : 0,
    build: typeof box.build === 'string' ? box.build : '—',
    modules: Array.isArray(box.modules) ? box.modules : [],
    hasKeys: box.hasKeys === true,
    blob: box.blob,
  }
}
