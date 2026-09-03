/* ============================================================
   МОДЕЛЬ УВЕДОМЛЕНИЙ · retention (P0-5, вынесено под тест в P0-4)
   Чистые функции без React: активная лента ограничена количеством,
   архив — количеством и сроком. События приватности из обрезки
   активной части исключены: они не должны тонуть в потоке конвейера.
   ============================================================ */

export const NOTIF_ACTIVE_CAP = 200
export const NOTIF_ARCHIVE_CAP = 300
export const NOTIF_ARCHIVE_TTL = 30 * 24 * 60 * 60_000

type Prunable = { at: number; archived?: boolean; cat: string }

type Snoozable = { archived?: boolean; snoozedUntil?: number }

/** Отложенное уведомление скрыто из ленты до срока — и из счётчиков тоже. */
export function isSnoozed(n: Snoozable, now = Date.now()): boolean {
  return n.snoozedUntil !== undefined && n.snoozedUntil > now
}

/** Видно в ленте: не в архиве и не отложено. */
export function isVisible(n: Snoozable, now = Date.now()): boolean {
  return n.archived !== true && !isSnoozed(n, now)
}

/** Отложенные: панель говорит о них отдельной строкой, а не молчит. */
export function snoozedCount<T extends Snoozable>(all: T[], now = Date.now()): number {
  return all.filter((n) => n.archived !== true && isSnoozed(n, now)).length
}

export function pruneNotifs<T extends Prunable>(all: T[], now = Date.now()): T[] {
  const kept = all.filter((n) => !(n.archived && now - n.at > NOTIF_ARCHIVE_TTL))
  const active = kept.filter((n) => !n.archived)
  const keepAlways = active.filter((n) => n.cat === 'privacy')
  const trimmable = active.filter((n) => n.cat !== 'privacy').slice(0, NOTIF_ACTIVE_CAP)
  const arch = kept.filter((n) => n.archived).slice(0, NOTIF_ARCHIVE_CAP)
  return [...[...keepAlways, ...trimmable].sort((a, b) => b.at - a.at), ...arch]
}

/** Непрочитанные, которые ЛЕНТА ПОКАЖЕТ: без архива и без отложенных.
 *  Бейдж колокольчика и счётчики фильтров считаются одной функцией —
 *  иначе цифра на колокольчике обещает события, которых в панели нет. */
export function unreadCount<T extends Prunable & { unread: boolean; snoozedUntil?: number }>(
  all: T[],
  now = Date.now(),
): number {
  return all.filter((n) => n.unread && isVisible(n, now)).length
}

/* ---------- UX-3: одна ось фильтров ---------- */

export type NotifFilter = 'all' | 'unread' | 'pipeline' | 'privacy' | 'system' | 'archive'

export const NOTIF_FILTERS: NotifFilter[] = [
  'all',
  'unread',
  'pipeline',
  'privacy',
  'system',
  'archive',
]

/** Выбранный фильтр переживает открытия и перезагрузку — но только валидный. */
export function parseNotifFilter(raw: unknown): NotifFilter {
  return NOTIF_FILTERS.includes(raw as NotifFilter) ? (raw as NotifFilter) : 'all'
}
