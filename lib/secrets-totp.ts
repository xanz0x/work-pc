/* ============================================================
   TOTP · RFC 6238 поверх HMAC (RFC 4226) на WebCrypto
   Zero-dependency: Base32-декодер, dynamic truncation, 6/8 цифр,
   period/algorithm настраиваются, поддержан импорт otpauth://.
   ============================================================ */

import type { TotpConfig } from './secrets'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Uint8Array | null {
  const s = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  if (!s || /[^A-Z2-7]/.test(s)) return null
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += B32[(value >>> bits) & 31]
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export const DEFAULT_TOTP: Omit<TotpConfig, 'secret'> = {
  issuer: '',
  account: '',
  period: 30,
  digits: 6,
  algorithm: 'SHA1',
}

const HASH: Record<TotpConfig['algorithm'], string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
}

/** Код TOTP на момент `atMs`; null — если секрет не Base32. */
export async function totpCode(
  secretB32: string,
  cfg: Pick<TotpConfig, 'period' | 'digits' | 'algorithm'>,
  atMs: number = Date.now(),
): Promise<string | null> {
  const key = base32Decode(secretB32)
  if (!key || key.length === 0) return null
  const period = cfg.period > 0 ? cfg.period : 30
  const counter = Math.floor(atMs / 1000 / period)

  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff
    c = Math.floor(c / 256)
  }

  const ck = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: HASH[cfg.algorithm] ?? 'SHA-1' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', ck, msg as BufferSource))
  const offset = mac[mac.length - 1] & 0x0f
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff)
  const digits = cfg.digits === 8 ? 8 : 6
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export function totpRemaining(period: number, atMs: number = Date.now()): number {
  const p = period > 0 ? period : 30
  return p - Math.floor((atMs / 1000) % p)
}

/** otpauth://totp/Issuer:account?secret=...&issuer=...&digits=6&period=30&algorithm=SHA1 */
export function parseOtpauth(uri: string): TotpConfig | null {
  const trimmed = uri.trim()
  if (!/^otpauth:\/\/totp\//i.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    const secret = url.searchParams.get('secret')
    if (!secret || !base32Decode(secret)) return null
    const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const [labelIssuer, labelAccount] = label.includes(':')
      ? [label.split(':')[0], label.split(':').slice(1).join(':')]
      : ['', label]
    const algoRaw = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
    const algorithm: TotpConfig['algorithm'] =
      algoRaw === 'SHA256' ? 'SHA256' : algoRaw === 'SHA512' ? 'SHA512' : 'SHA1'
    return {
      secret: secret.toUpperCase(),
      issuer: url.searchParams.get('issuer') ?? labelIssuer,
      account: labelAccount.trim(),
      period: Number(url.searchParams.get('period') ?? 30) || 30,
      digits: Number(url.searchParams.get('digits') ?? 6) === 8 ? 8 : 6,
      algorithm,
    }
  } catch {
    return null
  }
}
