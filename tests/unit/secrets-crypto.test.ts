import { describe, expect, it } from 'vitest'
import {
  isPortableBlob,
  isSealed,
  openPortable,
  sealPortable,
} from '@/lib/secrets-crypto'

describe('крипто-слой менеджера секретов', () => {
  it('портируемый снимок открывается своим паролем', async () => {
    const blob = await sealPortable('пароль-снимка', '{"a":1}')
    expect(isPortableBlob(blob)).toBe(true)
    expect(await openPortable('пароль-снимка', blob)).toBe('{"a":1}')
  }, 120_000)

  it('портируемый снимок не открывается чужим паролем', async () => {
    const blob = await sealPortable('пароль-снимка', '{"a":1}')
    expect(await openPortable('другой-пароль', blob)).toBeNull()
  }, 120_000)

  it('isSealed отличает упакованное поле от обычного текста', () => {
    expect(isSealed('AAAA:BBBB')).toBe(true)
    expect(isSealed('обычный пароль')).toBe(false)
    expect(isSealed(null)).toBe(false)
  })
})
