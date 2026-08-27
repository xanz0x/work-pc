'use client'

/* Логотип WORKFLO_W_ для экрана блокировки: тот же приём, что в сайдбаре —
   последняя W акцентная. Отдельный компонент, чтобы не тянуть каркас app-shell. */

export function LogoWord({ className }: { className?: string }) {
  return (
    <span className={className ? `logo-word ${className}` : 'logo-word'}>
      WORKFLO<b>W</b>
    </span>
  )
}
