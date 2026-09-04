import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/request-context'
import { withRoute } from '@/lib/route-log'
import { planProblem, type PlanInput } from '@/lib/users'
import { createPlan, listPlans } from '@/lib/users-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Тарифы: список со статистикой и создание. Роль admin проверена в proxy.ts. */

export const GET = withRoute('/admin/api/plans', async () => {
  requireUser()
  return NextResponse.json(await listPlans())
})

export const POST = withRoute('/admin/api/plans', async (req: NextRequest) => {
  requireUser()
  const b = (await req.json().catch(() => ({}))) as Partial<PlanInput>
  const input: Partial<PlanInput> = { ...b, days: Number(b.days), aiDailyLimit: Number(b.aiDailyLimit), tagline: String(b.tagline ?? '') }
  const problem = planProblem(input)
  if (problem) return NextResponse.json({ code: 'INVALID_ARGS', error: problem }, { status: 400 })
  return NextResponse.json(await createPlan(input as PlanInput))
})
