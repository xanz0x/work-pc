'use client'

/* ============================================================
   VtSelect · кастомный выпадающий список в стиле «Графит»
   Кнопка-инпут + абсолютное меню, закрытие по клику вне и Esc.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconChevronDown } from '@/components/icons'

export type VtOption = { value: string; label: string }

export function VtSelect({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
  className,
}: {
  value: string
  options: VtOption[]
  onChange: (v: string) => void
  ariaLabel: string
  testId?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = options.find((o) => o.value === value)

  return (
    <div className={`vts${open ? ' open' : ''}${className ? ` ${className}` : ''}`} ref={ref}>
      <button
        type="button"
        className="vts-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        <span className="ellipsis">{cur?.label ?? '—'}</span>
        <IconChevronDown />
      </button>
      {open && (
        <div className="vts-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={o.value || '·'}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`vts-item${o.value === value ? ' on' : ''}`}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              data-testid={testId ? `${testId}-opt-${o.value || 'none'}` : undefined}
            >
              <span className="ellipsis">{o.label}</span>
              {o.value === value && <IconCheck />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
