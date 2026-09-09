import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { issueLicenses, listLicenses, revokeLicense } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Ключи лицензий: список (маски), выдача под тариф (полные ключи — один раз), отзыв. */

export const GET = withRoute('/admin/api/licenses', async () => {
  requireUser()
  return NextResponse.json(await listLicenses())
})

export const POST = withRoute('/admin/api/licenses', async (req: NextRequest) => {
  requireUser()
  const b = (await req.json().catch(() => ({}))) as { planId?: unknown; days?: unknown; note?: unknown; count?: unknown }
  const days = Math.floor(Number(b.days))
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Срок — от 1 до 3650 дней.' }, { status: 400 })
  }
  const count = b.count === undefined ? 1 : Math.floor(Number(b.count))
  if (!Number.isFinite(count) || count < 1 || count > 25) {
    return NextResponse.json({ code: 'INVALID_ARGS', error: 'Можно выдать от 1 до 25 ключей за раз.' }, { status: 400 })
  }
  const r = await issueLicenses(String(b.planId ?? ''), days, String(b.note ?? ''), count)
  if (r === 'NO_PLAN') return NextResponse.json({ code: 'NO_PLAN', error: 'Выберите тариф.' }, { status: 400 })
  return NextResponse.json(r)
})

export const DELETE = withRoute('/admin/api/licenses', async (req: NextRequest) => {
  requireUser()
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!(await revokeLicense(id))) return NextResponse.json({ code: 'NOT_FOUND', error: 'Ключ не найден или уже отозван.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})
