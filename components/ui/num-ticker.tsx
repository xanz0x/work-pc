'use client'

import { useEffect, useRef } from 'react'

const fmt = new Intl.NumberFormat('ru-RU')

const prefersReduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Живое число — порт идеи Magic UI NumberTicker без внешних зависимостей.
 * При смене значения цифры докручиваются до новой величины за короткий
 * твист: счётчики сейфа отвечают на действие, а не перерисовываются
 * скачком. prefers-reduced-motion отключает докрутку — число меняется сразу.
 */
export function NumTicker({
  value,
  className,
  duration = 620,
}: {
  value: number
  className?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!Number.isFinite(value)) {
      el.textContent = '—'
      return
    }
    const from = shown.current
    shown.current = value
    if (prefersReduced() || from === value) {
      el.textContent = fmt.format(value)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - (1 - p) ** 4
      el.textContent = fmt.format(Math.round(from + (value - from) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return (
    <span
      ref={ref}
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {fmt.format(Number.isFinite(value) ? value : 0)}
    </span>
  )
}
