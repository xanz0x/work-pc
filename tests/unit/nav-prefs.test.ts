import { describe, expect, it } from 'vitest'
import {
  NAV_DEFAULT_ORDER,
  isDefaultNav,
  normalizeNavPrefs,
  placeNav,
  toggleHidden,
} from '@/lib/nav-prefs'

describe('настройки бокового меню', () => {
  it('нормализует мусор к дефолту и дополняет пропущенные пункты', () => {
    const p = normalizeNavPrefs({ order: ['map', 'bogus', 'map'], hidden: ['chat', 'oops'] })
    expect(p.order).toEqual(['map', ...NAV_DEFAULT_ORDER.filter((x) => x !== 'map')])
    expect(p.hidden).toEqual(['chat'])
    expect(new Set(p.order).size).toBe(p.order.length)
  })

  it('пустой вход даёт полный дефолтный порядок без скрытых', () => {
    const p = normalizeNavPrefs({})
    expect(p.order).toEqual(NAV_DEFAULT_ORDER)
    expect(p.hidden).toEqual([])
    expect(isDefaultNav(p)).toBe(true)
  })

  it('«Настройки» скрыть нельзя', () => {
    expect(normalizeNavPrefs({ hidden: ['settings'] }).hidden).toEqual([])
    expect(toggleHidden(normalizeNavPrefs({}), 'settings').hidden).toEqual([])
  })

  it('placeNav переставляет пункт до и после цели', () => {
    const before = placeNav(NAV_DEFAULT_ORDER, 'vault', 'library', false)
    expect(before.indexOf('vault')).toBe(before.indexOf('library') - 1)
    const after = placeNav(NAV_DEFAULT_ORDER, 'library', 'vault', true)
    expect(after.indexOf('library')).toBe(after.indexOf('vault') + 1)
  })

  it('toggleHidden добавляет и снимает пункт', () => {
    const base = normalizeNavPrefs({})
    const hid = toggleHidden(base, 'chat')
    expect(hid.hidden).toContain('chat')
    expect(isDefaultNav(hid)).toBe(false)
    expect(toggleHidden(hid, 'chat').hidden).not.toContain('chat')
  })
})
