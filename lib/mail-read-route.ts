/* ПОЧТА · общий каркас маршрутов чтения: модуль включён, id и папка валидны, лимит 60/мин, ошибки → статусы. */

import { NextResponse } from 'next/server'
import { mailEnabled } from './mail-crypto'
import { FOLDER_RE } from './mail-read'
import { getAccountRaw, MailError, noteImapError, type MailAccount, type MailErrorCode } from './mail-server'
import { limitMailRead } from './rate-limit'
import { requireUser } from './request-context'

const ID_RE = /^[a-f0-9]{8}$/

export const notFound = () => NextResponse.json({ code: 'NOT_FOUND', error: 'Ящик не найден.' }, { status: 404 })

export async function readGuard(id: string): Promise<{ acc: MailAccount } | NextResponse> {
  if (!mailEnabled()) return NextResponse.json({ code: 'MAIL_DISABLED', error: 'Модуль почты выключен: не задан MAIL_SECRET.' }, { status: 503 })
  if (!ID_RE.test(id)) return notFound()
  const wait = limitMailRead(`${requireUser().uid}:${id}`)
  if (wait) return NextResponse.json({ code: 'RATE_LIMITED', error: `Слишком много запросов к ящику. Повторите через ${wait} с.`, retryAfter: wait }, { status: 429 })
  const acc = await getAccountRaw(id)
  if (!acc) return notFound()
  return { acc }
}

export function folderParam(raw: string | null): string | NextResponse {
  const f = (raw ?? 'INBOX').trim()
  if (!FOLDER_RE.test(f)) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Имя папки указано неверно.' }, { status: 400 })
  return f
}

export function uidParam(raw: string): number | NextResponse {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 4294967295) return NextResponse.json({ code: 'INVALID_ARGS', error: 'UID письма указан неверно.' }, { status: 400 })
  return n
}

const STATUS: Partial<Record<MailErrorCode, number>> = { NO_IMAP: 400, INVALID_ARGS: 400, NOT_FOUND: 404 }

/** MailError → ответ; ошибки соединения записываются в статус ящика, чтобы карточка была честной.
 *  Сбои IMAP отдаём как 503, а не 502: 502/504 от origin прокси превью подменяет своей страницей, и JSON теряется. */
export async function mailErrorResponse(e: unknown, acc: MailAccount): Promise<NextResponse> {
  if (!(e instanceof MailError)) throw e
  if (e.code === 'AUTH_FAILED' || e.code === 'NEEDS_APP_PASSWORD' || e.code === 'CONNECT_FAILED' || e.code === 'TLS_FAILED') await noteImapError(acc.id, e.message)
  return NextResponse.json({ code: e.code, error: e.message, hint: e.hint }, { status: STATUS[e.code] ?? 503 })
}
