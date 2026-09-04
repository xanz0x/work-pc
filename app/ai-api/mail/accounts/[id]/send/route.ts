import { NextResponse, type NextRequest } from 'next/server'
import { mailEnabled } from '@/lib/mail-crypto'
import { EMAIL_RE } from '@/lib/mail-discovery'
import { MAX_ATTACH_BYTES, MailError, sendMail, type Attachment } from '@/lib/mail-server'
import { withRoute } from '@/lib/route-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const bad = (error: string) => NextResponse.json({ code: 'INVALID_ARGS', error }, { status: 400 })

function addresses(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;\s]+/) : []
  const out = list.map((s) => String(s).trim()).filter(Boolean)
  return out.every((a) => EMAIL_RE.test(a)) ? out : null
}

/** { to, cc?, subject, text, html?, attachments? } — отправка через SMTP ящика. */
export const POST = withRoute('/ai-api/mail/accounts/[id]/send', async (req: NextRequest, ctx: Ctx) => {
  if (!mailEnabled()) return NextResponse.json({ code: 'MAIL_DISABLED', error: 'Модуль почты выключен: не задан MAIL_SECRET.' }, { status: 503 })
  const { id } = await ctx.params
  if (!/^[a-f0-9]{8}$/.test(id)) return NextResponse.json({ code: 'NOT_FOUND', error: 'Ящик не найден.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return bad('Тело запроса не JSON.')

  const to = addresses(body.to)
  if (!to || to.length === 0) return bad('Укажите хотя бы одного получателя с корректным адресом.')
  const cc = addresses(body.cc ?? [])
  if (!cc) return bad('В копии есть некорректный адрес.')
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 500) : ''
  const text = typeof body.text === 'string' ? body.text : ''
  const html = typeof body.html === 'string' && body.html ? body.html : undefined
  if (!subject && !text && !html) return bad('Письмо пустое: добавьте тему или текст.')

  const attachments: Attachment[] = []
  let total = 0
  for (const a of Array.isArray(body.attachments) ? body.attachments : []) {
    const o = (a ?? {}) as Record<string, unknown>
    if (typeof o.name !== 'string' || typeof o.dataBase64 !== 'string') return bad('Вложение задано неверно.')
    total += Math.floor((o.dataBase64.length * 3) / 4)
    if (total > MAX_ATTACH_BYTES) return bad('Вложения больше 15 МБ — почтовые серверы такое не принимают.')
    attachments.push({ name: o.name.slice(0, 200), type: typeof o.type === 'string' ? o.type : undefined, dataBase64: o.dataBase64 })
  }

  try {
    const r = await sendMail(id, { to, cc, subject, text, html, attachments })
    if (!r) return NextResponse.json({ code: 'NOT_FOUND', error: 'Ящик не найден.' }, { status: 404 })
    return NextResponse.json({ ok: true, messageId: r.messageId, account: r.account, recipients: r.accepted })
  } catch (e) {
    if (e instanceof MailError) return NextResponse.json({ code: e.code, error: e.message, hint: e.hint }, { status: 502 })
    throw e
  }
})
