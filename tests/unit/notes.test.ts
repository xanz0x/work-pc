import { describe, expect, it } from 'vitest'
import {
  DAY,
  HOUR,
  fmtLeft,
  isAlive,
  type Note,
} from '@/lib/notes'
import { demoNotes } from '@/lib/demo-seed'

const base: Note = {
  id: 'n1',
  title: 'Стикер',
  body: 'тело',
  tags: [],
  expiresAt: null,
  lifeSpan: null,
  locked: false,
  secret: null,
  createdAt: 0,
}

describe('стикеры: срок жизни', () => {
  it('постоянный стикер жив всегда', () => {
    expect(isAlive(base, Date.now() + 10 * DAY)).toBe(true)
  })

  it('стикер с истёкшим сроком мёртв ровно после срока', () => {
    const n = { ...base, expiresAt: 1_000, lifeSpan: HOUR }
    expect(isAlive(n, 999)).toBe(true)
    expect(isAlive(n, 1_001)).toBe(false)
  })

  it('остаток времени печатается без выдуманных значений', () => {
    expect(fmtLeft(0)).toBeTypeOf('string')
    expect(fmtLeft(2 * HOUR)).toMatch(/\d/)
  })

  it('демо-стикеры первого запуска помечены и имеют осмысленные сроки', () => {
    const seeded = demoNotes(1_000_000)
    expect(seeded.length).toBeGreaterThan(0)
    for (const n of seeded) {
      expect(n.demo).toBe(true)
      if (n.expiresAt !== null) expect(n.expiresAt).toBeGreaterThan(1_000_000)
    }
  })
})
