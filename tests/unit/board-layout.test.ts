import { describe, expect, it } from 'vitest'
import {
  arrange,
  commitMove,
  cycleSize,
  isCustom,
  layoutOf,
  putBoard,
  resetBoard,
  setSize,
  togglePin,
  tileKey,
  type TileKey,
} from '@/lib/board-layout'

const keys: TileKey[] = ['file:a', 'file:b', 'note:c', 'file:d']

describe('раскладка доски', () => {
  it('свежая доска не считается пользовательской', () => {
    expect(isCustom(resetBoard())).toBe(false)
  })

  it('arrange сохраняет состав плиток без потерь и дублей', () => {
    const out = arrange(keys, resetBoard())
    expect([...out].sort()).toEqual([...keys].sort())
  })

  it('перенос плитки меняет порядок и запоминается', () => {
    const moved = commitMove(resetBoard(), keys, keys, 'file:d', 0)
    const out = arrange(keys, moved)
    expect(out[0]).toBe('file:d')
    expect(out).toHaveLength(keys.length)
    expect(isCustom(moved)).toBe(true)
  })

  it('размер плитки перебирается по кругу', () => {
    const first = cycleSize(resetBoard(), 'file:a', keys)
    const second = cycleSize(first.layout, 'file:a', keys)
    expect(first.size).not.toBe(second.size)
    expect(setSize(resetBoard(), 'file:a', 'xl', keys).sizes?.['file:a']).toBe('xl')
  })

  it('закрепление плитки переключается и попадает в раскладку', () => {
    const pinned = togglePin(resetBoard(), 'note:c', keys)
    expect(arrange(keys, pinned.layout)[0]).toBe('note:c')
    const unpinned = togglePin(pinned.layout, 'note:c', keys)
    expect(unpinned.pinned).toBe(false)
  })

  it('раскладки живут по доскам независимо', () => {
    const layouts = putBoard({}, 'files', setSize(resetBoard(), 'file:a', 'wide', keys))
    expect(layoutOf(layouts, 'files').sizes?.['file:a']).toBe('wide')
    expect(layoutOf(layouts, 'notes').sizes?.['file:a']).toBeUndefined()
  })

  it('ключ плитки строится и разбирается симметрично', () => {
    expect(tileKey.file('x')).toBe('file:x')
    expect(tileKey.note('y')).toBe('note:y')
  })
})
