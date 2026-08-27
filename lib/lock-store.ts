/* ============================================================
   LOCK-STORE · конфиг замка и синхронный bootstrap
   Конфиг читается СИНХРОННО до первого рендера (localStorage
   синхронный), поэтому первый кадр после гидратации уже знает,
   стоит ли замок — гонки «мигнул открытым» нет (п.10.1 плана).
   Сам факт разблокировки здесь НЕ хранится: он живёт только в
   памяти вкладки (п.10.5).
   ============================================================ */

export { FILE_KEY_PREFIX, LOCK_PING_KEY, LOCK_STATE_KEY } from './crypto-vault'

import {
  FILE_KEY_PREFIX,
  LOCK_PING_KEY,
  LOCK_STATE_KEY,
  readLockState,
  removeLockState,
} from './crypto-vault'

export const LOCK_CONFIG_KEY = 'wf.lock.config'
/** Маркер одноразовой миграции стикеров (этап 5); до него аудит не трогает демо-данные. */
export const LOCK_MIGRATED_KEY = 'wf.vault.keys.migrated'

export type LockMethod = 'pin' | 'password'

export type LockConfig = {
  enabled: boolean
  method: LockMethod
  /** 0 = никогда; иначе минуты простоя до автоблокировки. */
  autoLockMin: number
  createdAt: number
}

export const AUTOLOCK_MINUTES = [0, 5, 10, 15, 30] as const
export const DEFAULT_AUTOLOCK_MIN = 5

/* ---------- безопасный доступ к localStorage ---------- */

function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function rawSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* приватный режим — интерфейс работает без сохранения */
  }
}

function rawRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* игнорируем */
  }
}

/* ---------- конфиг ---------- */

export function isLockConfig(x: unknown): x is LockConfig {
  if (typeof x !== 'object' || x === null) return false
  const c = x as Record<string, unknown>
  return (
    typeof c.enabled === 'boolean' &&
    (c.method === 'pin' || c.method === 'password') &&
    typeof c.autoLockMin === 'number' &&
    c.autoLockMin >= 0 &&
    typeof c.createdAt === 'number'
  )
}

export function readLockConfig(): LockConfig | null {
  const raw = rawGet(LOCK_CONFIG_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLockConfig(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeLockConfig(cfg: LockConfig): void {
  rawSet(LOCK_CONFIG_KEY, JSON.stringify(cfg))
}

/**
 * Синхронное определение стартового статуса (п.10.1).
 * 'locked' только когда включено И верификатор на месте.
 * Вызывается один раз при монтировании провайдера — до первой отрисовки.
 */
export function readLockBootstrap(): 'off' | 'locked' {
  const cfg = readLockConfig()
  return cfg?.enabled && readLockState() !== null ? 'locked' : 'off'
}

/* ---------- валидация мастер-ключа ---------- */

/** Текст ошибки или null, если ключ проходит политику. */
export function validateSecret(secret: string, method: LockMethod): string | null {
  if (method === 'pin') {
    return /^\d{4,8}$/.test(secret) ? null : 'PIN: от 4 до 8 цифр, без других символов'
  }
  if (secret.length < 8) return 'Пароль: минимум 8 символов'
  if (secret.length > 128) return 'Пароль слишком длинный (максимум 128)'
  return null
}

/* ---------- сброс ---------- */

/** Полный сброс замка; вместе с ним стираются обёрнутые файловые ключи (план п.4). */
export function wipeLockData(): void {
  rawRemove(LOCK_CONFIG_KEY)
  removeLockState()
  clearFileKeys()
}

/** Сколько объектов лежит под файловым ключом (каркас этапа 5). */
export function countFileKeys(): number {
  let n = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith(FILE_KEY_PREFIX)) n++
    }
  } catch {
    /* нет доступа — считаем нулём */
  }
  return n
}

export function clearFileKeys(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(FILE_KEY_PREFIX)) doomed.push(k)
    }
    doomed.forEach((k) => rawRemove(k))
  } catch {
    /* игнорируем */
  }
}

/** Мгновенный сигнал другим вкладкам «закройтесь» (п.10.9). storage не срабатывает в своей вкладке. */
export function broadcastLockNow(): void {
  rawSet(LOCK_PING_KEY, String(Date.now()))
  postLockSync('lock')
}

/* ---------- синхронизация вкладок через канал (п.10.9) ----------
   storage-события между вкладками иногда не ходят (приватные окна,
   часть браузеров). BroadcastChannel дублирует сигналы: надёжнее storage.
   'lock' — чужой lockNow(): вторая вкладка обязана закрыться тоже.
   'unlock-config-changed' — настройка замка изменилась (создан/сменён/
   выключен мастер): остальные вкладки перечитывают конфиг. */

export const LOCK_CHANNEL_ID = 'workflow-lock'
export type LockSyncType = 'lock' | 'unlock-config-changed'
export type LockSyncMsg = { type: LockSyncType; at: number }

export function readLockSyncMsg(data: unknown): LockSyncMsg | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Partial<LockSyncMsg>
  if (m.type !== 'lock' && m.type !== 'unlock-config-changed') return null
  return { type: m.type, at: typeof m.at === 'number' ? m.at : 0 }
}

export function postLockSync(type: LockSyncType): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(LOCK_CHANNEL_ID)
    ch.postMessage({ type, at: Date.now() } satisfies LockSyncMsg)
    ch.close()
  } catch {
    /* нет канала — остаётся storage-сигнал */
  }
}

/* ============================================================
   АУДИТ ЦЕЛОСТНОСТИ (п.10.12) — выполняется после гидратации.
   Инварианты:
   1. config.enabled ⇒ верификатор существует и корректен;
   2. файловый ключ без родительского lock.state ⇒ ключ недоступен,
      честно стирается (объект остаётся, пароль к нему — нет);
   3. заметка locked=true ⇒ есть шифртекст — проверяется ТОЛЬКО после
      миграции этапа 5 (маркер LOCK_MIGRATED_KEY), чтобы не ломать
      демо-стикеры, которые ещё живут plaintext-полем secret.
   ============================================================ */

export type AuditReport = { ok: boolean; issues: string[]; fixes: string[] }

type AuditableNote = { id: string; locked: boolean; secret: string | null }

export function auditLockState(notes?: AuditableNote[]): AuditReport {
  const issues: string[] = []
  const fixes: string[] = []

  // 1. Включённый конфиг без верификатора — замок нерабочий, выключаем честно.
  const cfg = readLockConfig()
  if (cfg?.enabled && readLockState() === null) {
    issues.push('config.enabled=true, но wf.lock.state отсутствует или повреждён')
    writeLockConfig({ ...cfg, enabled: false })
    fixes.push('конфиг замка переведён в disabled — настройте мастер-ключ заново')
  }

  // 2. Осиротевшие файловые ключи: без мастера их никогда не открыть.
  if (readLockState() === null && countFileKeys() > 0) {
    issues.push('есть файловые ключи без родительского wf.lock.state')
    clearFileKeys()
    fixes.push('осиротевшие ключи стёрты — объекты доступны без пароля, поставьте его заново')
  }

  // 3. locked ⇒ шифртекст существует (только после миграции этапа 5).
  //    Возвращаем список сломанных id — вызывающая сторона снимает locked через patchNote
  //    и пишет событие в ленту; здесь состояние заметок не меняем (нет доступа к setNotes).
  if (rawGet(LOCK_MIGRATED_KEY) === '1' && notes) {
    const brokenIds = notes.filter((n) => n.locked && !n.secret).map((n) => n.id)
    if (brokenIds.length > 0) {
      issues.push(`стикеров locked без шифртекста: ${brokenIds.length}`)
      fixes.push(`снять locked у стикеров: ${brokenIds.join(', ')}`)
    }
  }

  return { ok: issues.length === 0, issues, fixes }
}

/** id стикеров, нарушающих инвариант locked ⇒ ct (для patchNote вызывающей стороны). */
export function brokenLockedNoteIds(notes?: { id: string; locked: boolean; secret: string | null }[]): string[] {
  if (rawGet(LOCK_MIGRATED_KEY) !== '1' || !notes) return []
  return notes.filter((n) => n.locked && !n.secret).map((n) => n.id)
}
