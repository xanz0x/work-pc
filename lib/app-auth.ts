/**
 * Вход в приложение: пароль живёт в окружении, сессия — подписанная
 * httpOnly-cookie. Только WebCrypto, поэтому один и тот же код работает
 * и в middleware, и в серверных маршрутах.
 */

import type { NextResponse } from 'next/server'

export const SESSION_COOKIE = 'wf_session'
/** Открытый id пользователя: нужен интерфейсу до первого запроса, чтобы выбрать локальную базу. */
export const UID_COOKIE = 'wf_uid'

export function setSessionCookies(res: NextResponse, token: string, expires: Date, uid: string): void {
  const secure = process.env.NODE_ENV === 'production'
  res.cookies.set({ name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: 'lax', secure, path: '/', expires })
  res.cookies.set({ name: UID_COOKIE, value: uid, httpOnly: false, sameSite: 'lax', secure, path: '/', expires })
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 })
  res.cookies.set({ name: UID_COOKIE, value: '', path: '/', maxAge: 0 })
}

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

/**
 * Сессия v2: `sid.exp.hmac`. Подпись защищает от подделки, а сам sid
 * сверяется с серверным списком — так сессию можно завершить досрочно.
 */
export async function issueSession(
  secret: string,
  ttlMs: number,
  sid: string,
): Promise<{ token: string; expires: Date }> {
  const exp = Date.now() + ttlMs
  return { token: `${sid}.${exp}.${await hmac(secret, `wf2.${sid}.${exp}`)}`, expires: new Date(exp) }
}

/** Проверка подписи и срока. Возвращает sid или null; жива ли сессия — решает users-server. */
export async function verifySession(secret: string, token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  const [sid, expStr, sig] = token.split('.')
  if (!sid || !expStr || !sig) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp <= Date.now()) return null
  return equalConst(sig, await hmac(secret, `wf2.${sid}.${exp}`)) ? sid : null
}

export function sessionTtlMs(): number {
  const h = Number(process.env.APP_SESSION_TTL_HOURS)
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3_600_000
}
