import { beforeEach, describe, expect, it } from 'vitest'
import {
  FILE_KEY_PREFIX,
  LOCK_CONFIG_KEY,
  LOCK_MIGRATED_KEY,
  LOCK_STATE_KEY,
  auditLockState,
  brokenLockedNoteIds,
  countFileKeys,
  readLockConfig,
  validateSecret,
} from '@/lib/lock-store'

/**
 * P0-3 «Осторожно»: обёртки файловых ключей и SEK остались в localStorage
 * (крипто-ядро читает их синхронно в bootstrap), поэтому инвариант
 * «locked ⇒ шифртекст существует» обязан выполняться и после переезда
 * стикеров и файлов в IndexedDB.
 */
describe('аудит целостности замка', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('включённый конфиг без верификатора честно выключается', () => {
    localStorage.setItem(
      LOCK_CONFIG_KEY,
      JSON.stringify({ enabled: true, method: 'password', autoLockMin: 5, createdAt: 1 }),
    )
    const r = auditLockState()
    expect(r.ok).toBe(false)
    expect(readLockConfig()?.enabled).toBe(false)
  })

  it('осиротевшие файловые ключи стираются, а не остаются мусором', () => {
    localStorage.setItem(`${FILE_KEY_PREFIX}f1`, JSON.stringify({ wct: 'x', wiv: 'y' }))
    expect(countFileKeys()).toBe(1)
    const r = auditLockState()
    expect(r.ok).toBe(false)
    expect(countFileKeys()).toBe(0)
  })

  it('locked без шифртекста ловится только после миграции ключей', () => {
    const notes = [{ id: 'n1', locked: true, secret: null }]
    expect(brokenLockedNoteIds(notes)).toEqual([])
    localStorage.setItem(LOCK_MIGRATED_KEY, '1')
    expect(brokenLockedNoteIds(notes)).toEqual(['n1'])
    expect(brokenLockedNoteIds([{ id: 'n2', locked: true, secret: 'ct:iv' }])).toEqual([])
  })

  it('чистое состояние проходит аудит', () => {
    localStorage.setItem(LOCK_STATE_KEY, JSON.stringify({ v: 1 }))
    expect(auditLockState([]).ok).toBe(true)
  })

  it('слабый мастер-пароль и короткий PIN не принимаются', () => {
    expect(validateSecret('1234567', 'password')).not.toBeNull()
    expect(validateSecret('длинный-пароль', 'password')).toBeNull()
    expect(validateSecret('12', 'pin')).not.toBeNull()
  })
})
