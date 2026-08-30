import { describe, expect, it } from 'vitest'
import {
  NOTIF_ACTIVE_CAP,
  NOTIF_ARCHIVE_TTL,
  pruneNotifs,
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
