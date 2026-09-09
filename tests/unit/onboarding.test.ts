import { describe, expect, it } from 'vitest'
import {
  NO_ONBOARDING,
  needsOnboarding,
  resolveOnboarding,
  shouldMarkOnboarded,
} from '@/lib/onboarding'
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@/lib/store/settings'

describe('NF-4 · политика онбординга', () => {
  it('новому профилю три шага нужны, пройденному — нет', () => {
    expect(needsOnboarding(NO_ONBOARDING, false)).toBe(true)
    expect(needsOnboarding({ ...NO_ONBOARDING, at: 1 }, false)).toBe(false)
  })

  it('профиль с настроенным замком онбординг не видит, но помечается пройденным', () => {
    expect(needsOnboarding(NO_ONBOARDING, true)).toBe(false)
    expect(shouldMarkOnboarded(NO_ONBOARDING, true)).toBe(true)
    expect(shouldMarkOnboarded({ ...NO_ONBOARDING, at: 1 }, true)).toBe(false)
  })

  it('ключ, созданный внутри онбординга, не выбивает человека с третьего шага', () => {
    const midway = { ...NO_ONBOARDING, mode: 'hybrid' as const, keyChoice: 'created' as const }
    expect(needsOnboarding(midway, true)).toBe(true)
    expect(shouldMarkOnboarded(midway, true)).toBe(false)
  })

  it('гибридный режим с ключом даёт согласие на облако', () => {
    const r = resolveOnboarding({ mode: 'hybrid', keyChoice: 'created', start: 'folder' }, 1000)
    expect(r.engine).toBe('hybrid')
    expect(r.cloudConsent).toBe(true)
    expect(r.downgraded).toBe(false)
    expect(r.onboarding).toEqual({
      at: 1000,
      mode: 'hybrid',
      keyChoice: 'created',
      start: 'folder',
    })
  })

  it('отказ от ключа не оставляет полудоверенного состояния: облако отрезано', () => {
    const r = resolveOnboarding({ mode: 'hybrid', keyChoice: 'declined', start: 'demo' }, 7)
    expect(r.engine).toBe('local')
    expect(r.cloudConsent).toBe(false)
    expect(r.downgraded).toBe(true)
    expect(r.onboarding.keyChoice).toBe('declined')
    expect(r.onboarding.at).toBe(7)
  })

  it('локальный режим без ключа остаётся локальным и молчит про понижение', () => {
    const r = resolveOnboarding({ mode: 'local', keyChoice: 'declined', start: 'demo' }, 5)
    expect(r.engine).toBe('local')
    expect(r.downgraded).toBe(false)
  })

  it('профиль старой сборки добирает поле онбординга', () => {
    const old = { ...DEFAULT_SETTINGS } as Partial<Settings>
    delete old.onboarding
    expect(normalizeSettings(old as Settings).onboarding).toEqual(NO_ONBOARDING)
  })
})
