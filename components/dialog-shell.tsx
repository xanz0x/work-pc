'use client'

/* UX-4 · оболочка модалки: role/aria-modal, ловушка фокуса, Escape и
   возврат фокуса берутся из общего хука. Нужна там, где разметка диалога
   собирается в выражении и своих хуков иметь не может. */

import type { ReactNode } from 'react'
import { useDialog } from '@/hooks/use-dialog'

export function DialogShell({
  className,
  label,
  onClose,
  testId,
  children,
}: {
  className: string
  label: string
  onClose: () => void
  testId?: string
  children: ReactNode
}) {
  const { dialogProps } = useDialog<HTMLDivElement>({ onClose, label })
  return (
    <div className={className} {...dialogProps} data-testid={testId}>
      {children}
    </div>
  )
}
