'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react'
import { IconCheck, IconChevronDown } from './icons'

export type DropdownOption = {
  value: string
  /** Основная подпись пункта. */
  label: string
  /** Вторая строка: чем этот вариант отличается от других. */
  note?: string
  /** Правая метка-константа: размер модели, счётчик, статус. */
  meta?: string
  group?: string
  disabled?: boolean
}

/**
 * Единый выпадающий список системы «Графит».
 * Никаких нативных <select>: список рисуется как панель на тон выше
 * триггера, с волосяной рамкой, акцентной чертой у выбранного пункта
 * и полной клавиатурной навигацией (роль listbox).
 *
 * variant='field' — под инпут 36px, растягивается по контейнеру.
 * variant='chip'  — моноширинный чип 26px для тулбаров и заголовков.
 */
export function Dropdown({
  value,
  options,
  onChange,
  variant = 'field',
  align = 'left',
  placement = 'down',
  label,
  prefix,
  icon: Icon,
  menuWidth,
  className,
  testId,
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  variant?: 'field' | 'chip'
  align?: 'left' | 'right'
  placement?: 'down' | 'up'
  /** Доступное имя для скринридера. */
  label: string
  /** Короткая приставка в триггере, например «Сортировка». */
  prefix?: string
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  menuWidth?: number
  className?: string
  /** data-testid на триггер списка (все интерактивные элементы адресуемы). */
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  /* UX-4: скринридер обязан слышать, на каком пункте курсор — иначе список
     «молчит» при стрелочной навигации, потому что фокус остаётся на триггере. */
  const optionId = (i: number) => `${listId}-opt-${i}`

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const selected = options[selectedIndex]

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onScroll(e: Event) {
      // прокрутка вне меню закрывает список: панель позиционируется у триггера
      if (!listRef.current?.contains(e.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  function openMenu(startAt = selectedIndex) {
    setActive(startAt)
    setOpen(true)
  }

  function pick(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  function step(delta: number) {
    setActive((current) => {
      let next = current
      for (let i = 0; i < options.length; i += 1) {
        next = (next + delta + options.length) % options.length
        if (!options[next].disabled) break
      }
      return next
    })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
    }
  }

  let lastGroup: string | undefined

  return (
    <div
      className={`dd${open ? ' dd-open' : ''}${className ? ` ${className}` : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`dd-trigger dd-${variant}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        {Icon && <Icon className="dd-lead" />}
        {prefix && <span className="dd-prefix">{prefix}</span>}
        <span className="dd-value ellipsis">{selected?.label ?? '—'}</span>
        {selected?.meta && <span className="dd-trigger-meta num">{selected.meta}</span>}
        <IconChevronDown className="dd-caret" />
      </button>

      {open && (
        <div
          className={`dd-menu dd-${placement} dd-align-${align}`}
          role="listbox"
          id={listId}
          aria-label={label}
          ref={listRef}
          data-testid={testId ? `${testId}-menu` : undefined}
          style={menuWidth ? { width: menuWidth } : undefined}
        >
          <div className="dd-menu-head label-mono">{label}</div>
          <div className="dd-list">
            {options.map((option, index) => {
              const groupBreak = option.group && option.group !== lastGroup
              lastGroup = option.group
              return (
                <div key={option.value} className="dd-slot">
                  {groupBreak && <div className="dd-group label-mono">{option.group}</div>}
                  <button
                    type="button"
                    role="option"
                    id={optionId(index)}
                    data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                    aria-selected={option.value === value}
                    tabIndex={-1}
                    disabled={option.disabled}
                    className={`dd-item${option.value === value ? ' sel' : ''}${
                      index === active ? ' cursor' : ''
                    }`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(index)}
                  >
                    <span className="dd-check">
                      {option.value === value && <IconCheck />}
                    </span>
                    <span className="dd-text">
                      <span className="dd-label">{option.label}</span>
                      {option.note && <span className="dd-note">{option.note}</span>}
                    </span>
                    {option.meta && <span className="dd-meta num">{option.meta}</span>}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
