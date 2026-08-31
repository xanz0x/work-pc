/* ============================================================
   DB · схема локального хранилища (P0-3)
   Раньше весь архив лежал в localStorage: ~5 МБ, синхронная запись,
   ошибки глушились. Теперь крупные документы живут в IndexedDB, а в
   localStorage остаётся только то, что нужно СИНХРОННО до первого
   рендера или что не жалко потерять (черновики, позиции скролла).
   ============================================================ */

export const DB_NAME = 'workflow'

/**
 * Версии схемы:
 *  v1 — стор `docs` (keyPath 'key') с записями { key, value };
 *  v2 — у записей появилось `updatedAt`, добавлен стор `meta`
 *       (флаги миграций, отметки квоты).
 */
export const DB_VERSION = 2

export const DOC_STORE = 'docs'
export const META_STORE = 'meta'

/** Конверт документа: значение + время последней записи. */
export type Doc<T = unknown> = { key: string; value: T; updatedAt: number }

/**
 * Ключи, которые остаются в localStorage.
 * — конфиг замка и состояние замка читаются синхронно в bootstrap
 *   (первый кадр обязан знать, стоит ли замок — иначе «мигнёт открытым»);
 * — SEK менеджера секретов нужен крипто-ядру синхронно;
 * — активный экран, черновики и позиции скролла — мелочь на пару КБ.
 * Обёртки файловых ключей (`wf.vault.keys.<id>`) с волны 2 живут одним
 * документом в IndexedDB (`wf.filekeys.map.v1`, см. lib/file-keys-store.ts);
 * префикс остаётся местным, чтобы старые записи не переливались как документы,
 * а честно удалялись после подтверждённого переноса.
 */
const LOCAL_EXACT = new Set([
  'wf.lock.config',
  'wf.lock.state',
  'wf.lock.ping',
  'wf.vault.keys.migrated',
  'wf.secrets.sek.v1',
  'wf.telemetry.queue',
  'wf.chat.active',
  'wf.chat.drafts',
  'wf.chat.scroll',
  'wf.chat.rail',
  'wf.filekeys.lockedlist',
  'wf-nav',
])

const LOCAL_PREFIXES = ['wf.vault.keys.', 'wf.lock.migrate.backup.']

/** true — ключ живёт в localStorage, false — в IndexedDB. */
export function isLocalOnly(key: string): boolean {
  if (LOCAL_EXACT.has(key)) return true
  return LOCAL_PREFIXES.some((p) => key.startsWith(p))
}

/** Ключи документов, которые переливаются из localStorage в IndexedDB. */
export function isMigratableKey(key: string): boolean {
  return key.startsWith('wf.') && !isLocalOnly(key)
}

/** Метки в сторе `meta`. */
export const META_LS_MIGRATED = 'ls.migrated.v1'
export const META_LS_CLEANED = 'ls.cleaned.v1'
