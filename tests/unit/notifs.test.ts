import { describe, expect, it } from 'vitest'
import {
  NOTIF_ACTIVE_CAP,
  NOTIF_ARCHIVE_TTL,
  NOTIF_FILTERS,
  isVisible,
  parseNotifFilter,
  pruneNotifs,
  snoozedCount,
  unreadCount,
} from '@/lib/notifs'

type N = { id: string; at: number; cat: string; unread: boolean; archived?: boolean }

const make = (n: number, cat = 'pipeline', at = 1_000_000): N[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${cat}-${i}`, at: at - i, cat, unread: true }))

describe('модель уведомлений: retention', () => {
  it('активная лента обрезается по лимиту', () => {
    const out = pruneNotifs(make(NOTIF_ACTIVE_CAP + 50), 1_000_000)
    expect(out).toHaveLength(NOTIF_ACTIVE_CAP)
  })

  it('события приватности не обрезаются потоком конвейера', () => {
    const all = [...make(NOTIF_ACTIVE_CAP + 50), ...make(3, 'privacy', 900_000)]
    const out = pruneNotifs(all, 1_000_000)
    expect(out.filter((n) => n.cat === 'privacy')).toHaveLength(3)
  })

  it('архив старше срока удаляется, свежий остаётся', () => {
    const now = 10 * NOTIF_ARCHIVE_TTL
    const out = pruneNotifs(
      [
        { id: 'old', at: now - NOTIF_ARCHIVE_TTL - 1, cat: 'pipeline', unread: false, archived: true },
        { id: 'fresh', at: now - 1000, cat: 'pipeline', unread: false, archived: true },
      ],
      now,
    )
    expect(out.map((n) => n.id)).toEqual(['fresh'])
  })

  it('счётчик непрочитанных не считает архив', () => {
    expect(
      unreadCount([
        { id: 'a', at: 1, cat: 'pipeline', unread: true },
        { id: 'b', at: 2, cat: 'pipeline', unread: true, archived: true },
        { id: 'c', at: 3, cat: 'pipeline', unread: false },
      ]),
    ).toBe(1)
  })

  it('порядок активной ленты — от новых к старым', () => {
    const out = pruneNotifs(
      [
        { id: 'old', at: 1, cat: 'pipeline', unread: true },
        { id: 'new', at: 5, cat: 'pipeline', unread: true },
      ],
      10,
    )
    expect(out.map((n) => n.id)).toEqual(['new', 'old'])
  })
})

/* UX-3: бейдж колокольчика и счётчики фильтров считает ОДНА функция,
   поэтому отложенные уведомления обязаны выпадать из обеих цифр. */
describe('UX-3 · счётчики и фильтр панели событий', () => {
  const now = 1_000_000

  it('отложенное не попадает ни в бейдж, ни в видимую ленту', () => {
    const all = [
      { id: 'a', at: 1, cat: 'pipeline', unread: true },
      { id: 'b', at: 2, cat: 'pipeline', unread: true, snoozedUntil: now + 60_000 },
      { id: 'c', at: 3, cat: 'privacy', unread: true, snoozedUntil: now - 1 },
      { id: 'd', at: 4, cat: 'system', unread: true, archived: true },
    ]
    expect(unreadCount(all, now)).toBe(2)
    expect(all.filter((n) => isVisible(n, now)).map((n) => n.id)).toEqual(['a', 'c'])
    expect(snoozedCount(all, now)).toBe(1)
    /* Срок вышел — уведомление вернулось само, без действий пользователя. */
    expect(unreadCount(all, now + 120_000)).toBe(3)
    expect(snoozedCount(all, now + 120_000)).toBe(0)
  })

  it('счётчики фильтров складываются в бейдж', () => {
    const all = [
      { id: 'a', at: 1, cat: 'pipeline', unread: true },
      { id: 'b', at: 2, cat: 'privacy', unread: true },
      { id: 'c', at: 3, cat: 'system', unread: true },
      { id: 'd', at: 4, cat: 'pipeline', unread: false },
      { id: 'e', at: 5, cat: 'pipeline', unread: true, snoozedUntil: now + 1 },
    ]
    const visible = all.filter((n) => isVisible(n, now) && n.unread)
    const byCat = ['pipeline', 'privacy', 'system'].map(
      (c) => visible.filter((n) => n.cat === c).length,
    )
    expect(byCat.reduce((a, b) => a + b, 0)).toBe(unreadCount(all, now))
  })

  it('мусор в сохранённом фильтре не ломает панель', () => {
    expect(parseNotifFilter('archive')).toBe('archive')
    expect(parseNotifFilter('privacy')).toBe('privacy')
    expect(parseNotifFilter('чего-то-нет')).toBe('all')
    expect(parseNotifFilter(null)).toBe('all')
    expect(parseNotifFilter(7)).toBe('all')
    expect(NOTIF_FILTERS).toHaveLength(6)
  })
})
