/* ============================================================
   ПОЧТА · шифрование паролей ящиков на сервере
   AES-256-GCM, ключ выводится scrypt из MAIL_SECRET. Без переменной
   модуль выключен: API честно отвечает MAIL_DISABLED.
   ============================================================ */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

let cached: { secret: string; key: Buffer } | null = null

export function mailEnabled(): boolean {
  return (process.env.MAIL_SECRET?.trim().length ?? 0) >= 32
}

function key(): Buffer {
  const secret = process.env.MAIL_SECRET?.trim() ?? ''
  if (secret.length < 32) throw new Error('MAIL_SECRET не задан или короче 32 символов')
  if (!cached || cached.secret !== secret) {
    cached = { secret, key: scryptSync(secret, 'wsx-mail-v1', 32, { N: 16384, r: 8, p: 1 }) }
  }
  return cached.key
}

/** iv:tag:ciphertext, все части base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join(':')
}

export function decryptSecret(enc: string): string {
  const [iv, tag, ct] = enc.split(':').map((s) => Buffer.from(s, 'base64'))
  const d = createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}
