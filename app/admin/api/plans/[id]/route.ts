import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { planProblem, type PlanInput } from '@/lib/users'
import { deletePlan, listPlans, updatePlan } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ code: 'NOT_FOUND', error: 'Тариф не найден.' }, { status: 404 })

/** Правка тарифа: любые поля из PlanInput и флаг archived. Уже выданные пользователям функции не меняются. */
export const PATCH = withRoute('/admin/api/plans/[id]', async (req: NextRequest, ctx: Ctx) => {
  requireUser()
  const { id } = await ctx.params
  const b = (await req.json().catch(() => ({}))) as Partial<PlanInput> & { archived?: unknown }
  const current = (await listPlans()).find((p) => p.id === id)
  if (!current) return notFound()
  const merged: PlanInput = {
    name: b.name ?? current.name,
    tagline: b.tagline ?? current.tagline,
    color: b.color ?? current.color,
    days: b.days !== undefined ? Number(b.days) : current.days,
    aiDailyLimit: b.aiDailyLimit !== undefined ? Number(b.aiDailyLimit) : current.aiDailyLimit,
    features: b.features ?? current.features,
  }
  const problem = planProblem(merged)
  if (problem) return NextResponse.json({ code: 'INVALID_ARGS', error: problem }, { status: 400 })
  const p = await updatePlan(id, { ...merged, archived: typeof b.archived === 'boolean' ? b.archived : undefined })
  return p ? NextResponse.json(p) : notFound()
})

export const DELETE = withRoute('/admin/api/plans/[id]', async (_req: NextRequest, ctx: Ctx) => {
  requireUser()
  const r = await deletePlan((await ctx.params).id)
  if (r === 'NOT_FOUND') return notFound()
  if (r === 'IN_USE') return NextResponse.json({ code: 'IN_USE', error: 'На тарифе есть пользователи или ключи — отправьте его в архив.' }, { status: 409 })
  return NextResponse.json({ ok: true })
})
