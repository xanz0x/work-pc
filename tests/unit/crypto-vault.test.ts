import { describe, expect, it, beforeEach } from 'vitest'
import {
  aesDecrypt,
  aesEncrypt,
  b64ToBytes,
  bytesToB64,
  cryptoSelfTest,
  decryptSecret,
  deriveMasterKey,
  encryptSecret,
  failDelayMs,
  randomBytesOf,
  readLockState,
  registerFailure,
  removeLockState,
  resetFailures,
  writeLockState,
  LOCK_ITERATIONS,
} from '@/lib/crypto-vault'

/** Итерации в тестах занижены намеренно: проверяется математика, не стойкость. */
const IT = 1_000

describe('крипто-ядро замка', () => {
  beforeEach(() => {
    removeLockState()
  })

  it('base64 туда-обратно без потерь', () => {
    const bytes = randomBytesOf(32)
    expect([...b64ToBytes(bytesToB64(bytes))]).toEqual([...bytes])
  })

  it('AES-GCM: шифртекст открывается своим ключом', async () => {
    const key = await deriveMasterKey('пароль-1', randomBytesOf(16), IT)
    const { ctB64, ivB64 } = await aesEncrypt(key, 'секретная строка')
    expect(await aesDecrypt(key, ctB64, ivB64)).toBe('секретная строка')
  })

  it('AES-GCM: чужой ключ не открывает', async () => {
    const salt = randomBytesOf(16)
    const a = await deriveMasterKey('пароль-1', salt, IT)
    const b = await deriveMasterKey('пароль-2', salt, IT)
    const { ctB64, ivB64 } = await aesEncrypt(a, 'секрет')
    expect(await aesDecrypt(b, ctB64, ivB64)).toBeNull()
  })

  it('AES-GCM: подмена шифртекста отвергается тегом', async () => {
    const key = await deriveMasterKey('пароль-1', randomBytesOf(16), IT)
    const { ctB64, ivB64 } = await aesEncrypt(key, 'секрет')
    const bytes = b64ToBytes(ctB64)
    bytes[0] ^= 0x01
    expect(await aesDecrypt(key, bytesToB64(bytes), ivB64)).toBeNull()
  })

  it('файловый секрет не открывается другим мастером', async () => {
    const pack = await encryptSecret('мастер-A', 'file-1', 'данные')
    expect(await decryptSecret('мастер-A', 'file-1', pack)).toBe('данные')
    expect(await decryptSecret('мастер-B', 'file-1', pack)).toBeNull()
  }, 30_000)

  it('анти-брутфорс: задержка растёт и упирается в потолок', () => {
    expect(failDelayMs(0)).toBe(0)
    expect(failDelayMs(1)).toBe(1000)
    expect(failDelayMs(2)).toBe(2000)
    expect(failDelayMs(6)).toBe(30_000)
    expect(failDelayMs(60)).toBe(30_000)
  })

  it('счётчик неудач пишется и сбрасывается', async () => {
    const key = await deriveMasterKey('пароль-1', randomBytesOf(16), IT)
    const v = await aesEncrypt(key, 'x')
    writeLockState({
      v: 1,
      saltB64: bytesToB64(randomBytesOf(16)),
      verifierB64: v.ctB64,
      ivB64: v.ivB64,
      iterations: IT,
      failCount: 0,
      lastFailAt: 0,
      cooldownUntil: 0,
    })
    expect(registerFailure()?.failCount).toBe(1)
    expect(registerFailure()?.failCount).toBe(2)
    resetFailures()
    expect(readLockState()?.failCount).toBe(0)
  })

  it('политика KDF не откатывается ниже 600 000', () => {
    expect(LOCK_ITERATIONS).toBeGreaterThanOrEqual(600_000)
  })

  it('встроенный самотест ядра зелёный', async () => {
    const r = await cryptoSelfTest()
    expect(r.checks.filter((c) => !c.ok)).toEqual([])
    expect(r.ok).toBe(true)
  }, 60_000)
})
