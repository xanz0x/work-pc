import { beforeEach, describe, expect, it } from 'vitest'
import {
  FILE_KEY_PREFIX,
  aesEncrypt,
  b64ToBytes,
  bytesToB64,
  deriveMasterKey,
  randomBytesOf,
} from '@/lib/crypto-vault'
import { rewrapAll } from '@/lib/lock-migrate'
import { SECRETS_SEK_KEY } from '@/lib/secrets-crypto'

const IT = 1_000

describe('переупаковка под новый мастер-ключ (rewrapAll)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('файловый ключ, секрет стикера и SEK открываются новым ключом', async () => {
    const salt = randomBytesOf(16)
    const oldKey = await deriveMasterKey('старый', salt, IT)
    const newKey = await deriveMasterKey('новый', salt, IT)

    const fileKey = await aesEncrypt(oldKey, 'file-key-material')
    localStorage.setItem(
      `${FILE_KEY_PREFIX}f1`,
      JSON.stringify({ wct: fileKey.ctB64, wiv: fileKey.ivB64 }),
    )
    const sek = await aesEncrypt(oldKey, 'sek-material')
    localStorage.setItem(SECRETS_SEK_KEY, JSON.stringify({ wct: sek.ctB64, wiv: sek.ivB64 }))
    const noteSecret = await aesEncrypt(oldKey, 'note-secret')

    const patched: Record<string, string> = {}
    const report = await rewrapAll(
      oldKey,
      newKey,
      [{ id: 'n1', locked: true, secret: `${noteSecret.ctB64}:${noteSecret.ivB64}` }],
      (id, secret) => {
        patched[id] = secret
      },
    )

    expect(report).toMatchObject({ files: 1, notes: 1, sek: true, broken: 0 })

    // Инвариант: то, что переупаковано, читается новым ключом и только им.
    const { aesDecrypt } = await import('@/lib/crypto-vault')
    const fk = JSON.parse(localStorage.getItem(`${FILE_KEY_PREFIX}f1`) as string)
    expect(await aesDecrypt(newKey, fk.wct, fk.wiv)).toBe('file-key-material')
    expect(await aesDecrypt(oldKey, fk.wct, fk.wiv)).toBeNull()

    const [ct, iv] = patched.n1.split(':')
    expect(await aesDecrypt(newKey, ct, iv)).toBe('note-secret')

    const sekBlob = JSON.parse(localStorage.getItem(SECRETS_SEK_KEY) as string)
    expect(await aesDecrypt(newKey, sekBlob.wct, sekBlob.wiv)).toBe('sek-material')
  }, 60_000)

  it('чужой шифртекст не теряется молча: он считается сломанным', async () => {
    const oldKey = await deriveMasterKey('старый', randomBytesOf(16), IT)
    const newKey = await deriveMasterKey('новый', randomBytesOf(16), IT)
    const alien = await aesEncrypt(newKey, 'не наш блоб')
    const bytes = b64ToBytes(alien.ctB64)
    bytes[0] ^= 0x7f
    localStorage.setItem(
      `${FILE_KEY_PREFIX}f2`,
      JSON.stringify({ wct: bytesToB64(bytes), wiv: alien.ivB64 }),
    )
    const report = await rewrapAll(oldKey, newKey, [], () => {})
    expect(report.files).toBe(0)
    expect(report.broken).toBe(1)
  }, 60_000)
})
