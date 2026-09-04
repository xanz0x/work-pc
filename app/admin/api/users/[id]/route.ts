import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { isFeatures, passwordProblem } from '@/lib/users'
import {
  adminDeleteUser,
  adminGrantLicense,
  adminPatchUser,
  adminResetPassword,
  adminSetPlan,
  adminTerminateSessions,
  getUser,
} from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ code: 'NOT_FOUND', error: 'Пользователь не найден.' }, { status: 404 })

export const GET = withRoute('/admin/api/users/[id]', async (_req: NextRequest, ctx: Ctx) => {
  requireUser()
  const u = await getUser((await ctx.params).id)
  return u ? NextResponse.json(u) : notFound()
})

/** Роль, статус, тумблеры, лимит ИИ, имя. */
export const PATCH = withRoute('/admin/api/users/[id]', async (req: NextRequest, ctx: Ctx) => {
  const actor = requireUser()
  const { id } = await ctx.params
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Parameters<typeof adminPatchUser>[2] = {}
  if (typeof b.name === 'string') patch.name = b.name
  if (b.role === 'admin' || b.role === 'user') patch.role = b.role
  if (b.status === 'active' || b.status === 'blocked') patch.status = b.status
  if (isFeatures(b.features)) patch.features = b.features
  if (Number.isFinite(Number(b.aiDailyLimit)) && b.aiDailyLimit !== undefined) patch.aiDailyLimit = Number(b.aiDailyLimit)
  const r = await adminPatchUser(actor.uid, id, patch)
  if (r === 'NOT_FOUND') return notFound()
  if (r === 'LAST_ADMIN') return NextResponse.json({ code: 'LAST_ADMIN', error: 'Нельзя лишить прав последнего администратора.' }, { status: 409 })
  if (r === 'SELF') return NextResponse.json({ code: 'SELF', error: 'Нельзя заблокировать или понизить самого себя.' }, { status: 409 })
  return NextResponse.json(r)
})

/** Действия: reset-password, terminate-sessions, grant-license, revoke-license. */
export const POST = withRoute('/admin/api/users/[id]', async (req: NextRequest, ctx: Ctx) => {
  requireUser()
  const { id } = await ctx.params
  const b = (await req.json().catch(() => ({}))) as { action?: unknown; password?: unknown; days?: unknown; planId?: unknown }
  switch (b.action) {
    case 'reset-password': {
      const pp = passwordProblem(b.password)
      if (pp) return NextResponse.json({ code: 'INVALID_ARGS', error: pp }, { status: 400 })
      return (await adminResetPassword(id, b.password as string)) ? NextResponse.json({ ok: true }) : notFound()
    }
    case 'terminate-sessions':
      return NextResponse.json({ ok: true, ended: await adminTerminateSessions(id) })
    case 'grant-license': {
      const days = Math.floor(Number(b.days))
      if (!Number.isFinite(days) || days <= 0 || days > 3650) {
        return NextResponse.json({ code: 'INVALID_ARGS', error: 'Срок — от 1 до 3650 дней.' }, { status: 400 })
      }
      const u = await adminGrantLicense(id, days)
      return u ? NextResponse.json(u) : notFound()
    }
    case 'revoke-license': {
      const u = await adminGrantLicense(id, null)
      return u ? NextResponse.json(u) : notFound()
    }
    case 'set-plan': {
      const days = b.days === undefined || b.days === null ? null : Math.floor(Number(b.days))
      if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 3650)) {
        return NextResponse.json({ code: 'INVALID_ARGS', error: 'Срок — от 1 до 3650 дней.' }, { status: 400 })
      }
      const r = await adminSetPlan(id, String(b.planId ?? ''), days)
      if (r === 'NOT_FOUND') return notFound()
      if (r === 'NO_PLAN') return NextResponse.json({ code: 'NO_PLAN', error: 'Тариф не найден.' }, { status: 400 })
      return NextResponse.json(r)
    }
    default:
      return NextResponse.json({ code: 'INVALID_ARGS', error: 'Неизвестное действие.' }, { status: 400 })
  }
})

/** Удаление вместе с личными данными на сервере. */
export const DELETE = withRoute('/admin/api/users/[id]', async (_req: NextRequest, ctx: Ctx) => {
  const actor = requireUser()
  const r = await adminDeleteUser(actor.uid, (await ctx.params).id)
  if (r === 'NOT_FOUND') return notFound()
  if (r === 'SELF') return NextResponse.json({ code: 'SELF', error: 'Нельзя удалить самого себя.' }, { status: 409 })
  if (r === 'LEGACY') return NextResponse.json({ code: 'LEGACY', error: 'Первого администратора удалить нельзя.' }, { status: 409 })
  return NextResponse.json({ ok: true })
})
