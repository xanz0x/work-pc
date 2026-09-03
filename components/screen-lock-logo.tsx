'use client'

/* Логотип WORKSPACE_X_ для экрана блокировки и сплэша: тот же приём, что в
   сайдбаре — последняя литера акцентная. Отдельный компонент, чтобы не тянуть
   каркас app-shell. */

export function LogoWord({ className }: { className?: string }) {
  return (
    <span className={className ? `logo-word ${className}` : 'logo-word'}>
      WORKSPACE<b>X</b>
    </span>
  )
}
