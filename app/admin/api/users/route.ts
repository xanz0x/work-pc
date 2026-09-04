import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { isEmail, isFeatures, passwordProblem, type Role } from '@/lib/users'
import { adminCreateUser, listUsers } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Список и создание пользователей. Роль admin проверена в proxy.ts. */

export const GET = withRoute('/admin/api/users', async () => {
  requireUser()
  return NextResponse.json(await listUsers())
})

export const POST = withRoute('/admin/api/users', async (req: NextRequest) => {
  requireUser()
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (!isEmail(b.email)) return NextResponse.json({ code: 'INVALID_ARGS', error: 'Введите корректный email.' }, { status: 400 })
  const pp = passwordProblem(b.password)
  if (pp) return NextResponse.json({ code: 'INVALID_ARGS', error: pp }, { status: 400 })
  const role: Role = b.role === 'admin' ? 'admin' : 'user'
  const licenseDays = Number(b.licenseDays)
  const r = await adminCreateUser({
    email: b.email,
    name: String(b.name ?? ''),
    password: b.password as string,
    role,
    features: isFeatures(b.features) ? b.features : undefined,
    aiDailyLimit: Number.isFinite(Number(b.aiDailyLimit)) ? Number(b.aiDailyLimit) : undefined,
    licenseDays: Number.isFinite(licenseDays) && licenseDays > 0 ? Math.floor(licenseDays) : undefined,
  })
  if (r === 'EMAIL_TAKEN') return NextResponse.json({ code: 'EMAIL_TAKEN', error: 'Такой email уже есть.' }, { status: 409 })
  return NextResponse.json(r)
})
