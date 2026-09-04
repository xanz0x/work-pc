import '@/app/styles/plans.css'
import type { PlanRef } from '@/lib/users'

/** Цветная пилюля тарифа. Без тарифа — пунктирная «нет тарифа». */
export function PlanBadge({ plan, lg, label }: { plan: PlanRef | null; lg?: boolean; label?: string }) {
  if (!plan) {
    return (
      <span className={`plan-badge none${lg ? ' lg' : ''}`} data-testid="plan-badge-none">
        {label ?? 'без тарифа'}
      </span>
    )
  }
  return (
    <span className={`plan-badge plan-${plan.color}${lg ? ' lg' : ''}`} data-testid="plan-badge" data-plan={plan.name}>
      {plan.name}
    </span>
  )
}
