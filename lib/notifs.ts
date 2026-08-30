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

export function pruneNotifs<T extends Prunable>(all: T[], now = Date.now()): T[] {
  const kept = all.filter((n) => !(n.archived && now - n.at > NOTIF_ARCHIVE_TTL))
  const active = kept.filter((n) => !n.archived)
  const keepAlways = active.filter((n) => n.cat === 'privacy')
  const trimmable = active.filter((n) => n.cat !== 'privacy').slice(0, NOTIF_ACTIVE_CAP)
  const arch = kept.filter((n) => n.archived).slice(0, NOTIF_ARCHIVE_CAP)
  return [...[...keepAlways, ...trimmable].sort((a, b) => b.at - a.at), ...arch]
}

/** Непрочитанные в активной ленте — цифра на колокольчике. */
export function unreadCount<T extends Prunable & { unread: boolean }>(all: T[]): number {
  return all.filter((n) => n.unread && !n.archived).length
}
