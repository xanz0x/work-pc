/* ============================================================
   NF-9 · ТЕЛЕМЕТРИЯ ПО СОГЛАСИЮ
   Обещание «уходят только счётчики» проверяется здесь, а не на слово:
   произвольное имя события не попадает в агрегат, payload не содержит
   ничего, кроме чисел и границ периода, а без согласия отправки нет.
   ============================================================ */

import { describe, expect, it } from 'vitest'
import {
  buildPayload,
  emptyTelemetry,
  sendTelemetry,
  totalEvents,
  track,
} from '@/lib/telemetry'

const T0 = 1_700_000_000_000

describe('NF-9 · агрегат телеметрии', () => {
  it('считает только известные имена — содержимое сюда не попадёт', () => {
    let s = emptyTelemetry(T0)
    s = track(s, 'screen', 'library')
    s = track(s, 'screen', 'library')
    s = track(s, 'action', 'search.run')
    s = track(s, 'drop', 'search.empty')

    /* Имя файла, текст запроса, id записи — всё это не события. */
    const before = s
    s = track(s, 'action', 'договор_аренды_2026.pdf')
    s = track(s, 'screen', 'секретный экран')
    s = track(s, 'drop', 'user@example.com')
    expect(s).toBe(before)

    expect(s.screens).toEqual({ library: 2 })
    expect(s.actions).toEqual({ 'search.run': 1 })
    expect(s.drops).toEqual({ 'search.empty': 1 })
    expect(totalEvents(s)).toBe(4)
  })

  it('payload состоит из чисел и периода — ничего уникального', () => {
    let s = emptyTelemetry(T0)
    s = track(s, 'screen', 'chat')
    s = track(s, 'action', 'chat.turn')
    const p = buildPayload(s, T0 + 60_000)

    expect(Object.keys(p).sort()).toEqual([
      'actions',
      'app',
      'drops',
      'from',
      'screens',
      'to',
      'totals',
      'v',
    ])
    expect(p.from).toBe(new Date(T0).toISOString())
    expect(p.totals).toEqual({ screens: 1, actions: 1, drops: 0 })

    /* Ни одной строки, кроме имён из словаря и дат. */
    const values = [
      ...Object.values(p.screens),
      ...Object.values(p.actions),
      ...Object.values(p.drops),
    ]
    expect(values.every((v) => typeof v === 'number')).toBe(true)
    expect(JSON.stringify(p)).not.toContain('id')
  })

  it('без согласия отправка не происходит', async () => {
    const r = await sendTelemetry(false)
    expect(r).toEqual({ ok: false, error: 'Нет согласия на отправку.' })
  })

  it('пустой агрегат не отправляется даже с согласием', async () => {
    const r = await sendTelemetry(true)
    expect(r.ok).toBe(false)
  })
})
