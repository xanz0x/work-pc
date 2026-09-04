import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { loginProblem, passwordProblem, type Role } from '@/lib/users'
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
  const lp = loginProblem(b.login)
  if (lp) return NextResponse.json({ code: 'INVALID_ARGS', error: lp }, { status: 400 })
  const pp = passwordProblem(b.password)
  if (pp) return NextResponse.json({ code: 'INVALID_ARGS', error: pp }, { status: 400 })
  const role: Role = b.role === 'admin' ? 'admin' : 'user'
  const licenseDays = Number(b.licenseDays)
  const r = await adminCreateUser({
    login: String(b.login),
    name: String(b.name ?? ''),
    password: b.password as string,
    role,
    planId: typeof b.planId === 'string' && b.planId ? b.planId : null,
    licenseDays: Number.isFinite(licenseDays) && licenseDays > 0 ? Math.floor(licenseDays) : undefined,
  })
  if (r === 'LOGIN_TAKEN') return NextResponse.json({ code: 'LOGIN_TAKEN', error: 'Такой логин уже есть.' }, { status: 409 })
  if (r === 'NO_PLAN') return NextResponse.json({ code: 'NO_PLAN', error: 'Тариф не найден.' }, { status: 400 })
  return NextResponse.json(r)
})
