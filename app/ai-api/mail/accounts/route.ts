import { NextResponse, type NextRequest } from 'next/server'
import { mailEnabled } from '@/lib/mail-crypto'
import { splitEmail } from '@/lib/mail-discovery'
import { MailError, createAccount, listAccounts, normalizeConfig } from '@/lib/mail-server'
import { requireUser } from '@/lib/request-context'
import { limitMailAuth } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRoute('/ai-api/mail/accounts', async () =>
  NextResponse.json({ enabled: mailEnabled(), accounts: mailEnabled() ? await listAccounts() : [] }),
)

/**
 * { name, email, password, user?, config? } — без config сервер сам ищет
 * настройки, затем проверяет SMTP (обязательно) и IMAP; сохраняет только
 * при рабочем SMTP. Пароль в ответ не попадает никогда.
 */
export const POST = withRoute('/ai-api/mail/accounts', async (req: NextRequest) => {
  if (!mailEnabled()) {
    return NextResponse.json({ code: 'MAIL_DISABLED', error: 'Модуль почты выключен: на сервере не задан MAIL_SECRET (32+ символа).' }, { status: 503 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!splitEmail(email)) {
    return NextResponse.json({ ok: false, code: 'INVALID_ARGS', error: 'Адрес почты указан неверно.' }, { status: 400 })
  }
  const wait = limitMailAuth(`${requireUser().uid}:${email}`)
  if (wait) {
    return NextResponse.json({ code: 'RATE_LIMITED', error: `Слишком много попыток входа. Повторите через ${wait} с.`, retryAfter: wait }, { status: 429 })
  }
  try {
    const config = body.config ? normalizeConfig(body.config) : null
    const r = await createAccount({
      name: typeof body.name === 'string' ? body.name : '',
      email,
      password: typeof body.password === 'string' ? body.password : '',
      user: typeof body.user === 'string' ? body.user : undefined,
      config,
    })
    if (!r.ok) {
      const status = r.code === 'INVALID_ARGS' ? 400 : 422
      return NextResponse.json(r, { status })
    }
    return NextResponse.json(r, { status: 201 })
  } catch (e) {
    if (e instanceof MailError) return NextResponse.json({ ok: false, code: e.code, error: e.message, hint: e.hint }, { status: 400 })
    throw e
  }
})
