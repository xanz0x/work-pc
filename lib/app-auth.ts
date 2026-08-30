/**
 * Вход в приложение: пароль живёт в окружении, сессия — подписанная
 * httpOnly-cookie. Только WebCrypto, поэтому один и тот же код работает
 * и в middleware, и в серверных маршрутах.
 */

export const SESSION_COOKIE = 'wf_session'

const enc = new TextEncoder()

function toB64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toB64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))))
}

/** Сравнение без утечки времени: длина строк здесь всегда одинаковая (хеши). */
export function equalConst(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function sha256(text: string): Promise<string> {
  return toB64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))))
}

export async function issueSession(
  secret: string,
  ttlMs: number,
): Promise<{ token: string; expires: Date }> {
  const exp = Date.now() + ttlMs
  return { token: `${exp}.${await hmac(secret, `wf1.${exp}`)}`, expires: new Date(exp) }
}

export async function verifySession(
  secret: string,
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const exp = Number(token.slice(0, dot))
  if (!Number.isFinite(exp) || exp <= Date.now()) return false
  return equalConst(token.slice(dot + 1), await hmac(secret, `wf1.${exp}`))
}

export function sessionTtlMs(): number {
  const h = Number(process.env.APP_SESSION_TTL_HOURS)
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3_600_000
}
