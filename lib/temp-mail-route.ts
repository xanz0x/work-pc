/* ВРЕМЕННАЯ ПОЧТА · общий каркас маршрутов: модуль включён, id валиден, лимит 60/мин, ошибки → статусы. */

import { NextResponse } from 'next/server'
import { mailEnabled } from './mail-crypto'
import { limitMailRead } from './rate-limit'
import { requireUser } from './request-context'
import { TempError } from './temp-mail'

const ID_RE = /^[a-f0-9]{8}$/

const STATUS: Record<string, number> = { NO_KEY: 503, PROVIDER: 503, NOT_FOUND: 404, INVALID_ARGS: 400, RATE_LIMITED: 429, NOT_SUPPORTED: 400 }

export function tempGuard(id?: string): NextResponse | null {
  if (!mailEnabled()) return NextResponse.json({ code: 'MAIL_DISABLED', error: 'Модуль почты выключен: не задан MAIL_SECRET.' }, { status: 503 })
  if (id !== undefined && !ID_RE.test(id)) return NextResponse.json({ code: 'NOT_FOUND', error: 'Временный ящик не найден.' }, { status: 404 })
  const wait = limitMailRead(`temp:${requireUser().uid}:${id ?? 'all'}`)
  if (wait) {
    return NextResponse.json({ code: 'RATE_LIMITED', error: `Слишком много запросов. Повторите через ${wait} с.`, retryAfter: wait }, { status: 429, headers: { 'Retry-After': String(wait) } })
  }
  return null
}

export function tempErrorResponse(e: unknown): NextResponse {
  if (!(e instanceof TempError)) throw e
  const headers = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : undefined
  return NextResponse.json({ code: e.code, error: e.message, retryAfter: e.retryAfter }, { status: STATUS[e.code] ?? 503, headers })
}
