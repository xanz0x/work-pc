import { NextResponse, type NextRequest } from 'next/server'
import { mailEnabled } from '@/lib/mail-crypto'
import { MailError, normalizeConfig, removeAccount, updateAccount } from '@/lib/mail-server'
import { requireUser } from '@/lib/request-context'
import { limitMailAuth } from '@/lib/rate-limit'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const ID_RE = /^[a-f0-9]{8}$/

const notFound = () => NextResponse.json({ code: 'NOT_FOUND', error: 'Ящик не найден.' }, { status: 404 })
const disabled = () => NextResponse.json({ code: 'MAIL_DISABLED', error: 'Модуль почты выключен: не задан MAIL_SECRET.' }, { status: 503 })

/** Переименовать, поправить хосты, сменить пароль — после правки соединение перепроверяется. */
export const PUT = withRoute('/ai-api/mail/accounts/[id]', async (req: NextRequest, ctx: Ctx) => {
  if (!mailEnabled()) return disabled()
  const { id } = await ctx.params
  if (!ID_RE.test(id)) return notFound()
  const wait = limitMailAuth(`${requireUser().uid}:${id}`)
  if (wait) return NextResponse.json({ code: 'RATE_LIMITED', error: `Слишком много попыток. Повторите через ${wait} с.`, retryAfter: wait }, { status: 429 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const r = await updateAccount(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      user: typeof body.user === 'string' && body.user.trim() ? body.user : undefined,
      password: typeof body.password === 'string' && body.password ? body.password : undefined,
      config: body.config ? normalizeConfig(body.config) : undefined,
    })
    if (!r) return notFound()
    if (!r.saved) {
      return NextResponse.json({ code: r.checks.code ?? 'CONNECT_FAILED', error: `Изменения не сохранены: ${r.checks.error ?? 'SMTP не отвечает'}`, hint: r.checks.hint, checks: r.checks, account: r.account }, { status: 422 })
    }
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof MailError) return NextResponse.json({ code: e.code, error: e.message, hint: e.hint }, { status: 400 })
    throw e
  }
})

export const DELETE = withRoute('/ai-api/mail/accounts/[id]', async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!ID_RE.test(id) || !(await removeAccount(id))) return notFound()
  return NextResponse.json({ ok: true })
})
