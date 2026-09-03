'use client'

/* ============================================================
   UX-4 · ОБЩИЙ ХУК ДИАЛОГА
   Одна реализация на все панели и модалки продукта:
   — ловушка фокуса (Tab и Shift+Tab не выпускают из диалога);
   — Escape закрывает ВЕРХНИЙ диалог, а не все сразу;
   — фокус возвращается туда, откуда диалог открыли;
   — role/aria-modal/aria-label проставляются одним объектом props.

   Второй хук — стрелочная навигация по спискам: контейнер слушает
   ArrowUp/ArrowDown (Home/End) и переносит фокус между элементами
   с атрибутом data-nav-item. Списку не нужно хранить «активный
   индекс»: источник истины — сам DOM-фокус.
   ============================================================ */

import { useCallback, useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Видимые фокусируемые элементы внутри диалога, в порядке обхода. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true',
  )
}

/** Стек открытых диалогов: клавиатуру обслуживает только верхний. */
const stack: HTMLElement[] = []

export type DialogOptions = {
  /** Закрыть диалог: Escape и потеря фокуса зовут именно её. */
  onClose: () => void
  /** Доступное имя: без него скринридер объявит «диалог» и замолчит. */
  label: string
  /** false — диалог смонтирован, но не активен (эффекты не вешаются). */
  open?: boolean
  /**
   * Модальный диалог перекрывает интерфейс: aria-modal + ловушка фокуса.
   * Поповер (панель уведомлений, меню) — false: фокус можно увести Tab'ом.
   */
  modal?: boolean
  /** Куда встать фокусу при открытии; по умолчанию — первый элемент. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Не переводить фокус внутрь при открытии. */
  autoFocus?: boolean
}

export function useDialog<T extends HTMLElement = HTMLDivElement>({
  onClose,
  label,
  open = true,
  modal = true,
  initialFocus,
  autoFocus = true,
}: DialogOptions) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return

    const returnTo = document.activeElement as HTMLElement | null
    stack.push(node)

    if (autoFocus) {
      const target = initialFocus?.current ?? focusables(node)[0] ?? node
      /* Фокус ставим после кадра: содержимое модалки часто дорисовывается. */
      requestAnimationFrame(() => target.focus({ preventScroll: true }))
    }

    function onKey(e: KeyboardEvent) {
      const top = stack[stack.length - 1]
      if (top !== node || !node) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !modal) return

      const list = focusables(node)
      if (list.length === 0) {
        e.preventDefault()
        node.focus({ preventScroll: true })
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      const inside = node.contains(active)
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const i = stack.indexOf(node)
      if (i >= 0) stack.splice(i, 1)
      /* Возврат фокуса: человек продолжает с той же кнопки, с которой ушёл. */
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modal, autoFocus])

  return {
    ref,
    dialogProps: {
      ref,
      role: 'dialog' as const,
      'aria-modal': modal ? (true as const) : undefined,
      'aria-label': label,
      tabIndex: -1,
    },
  }
}

/**
 * Стрелочная навигация по списку. Вешается на контейнер, элементы списка
 * помечаются `data-nav-item`. Home/End прыгают к краям, обход зациклен.
 */
export function useListNav<T extends HTMLElement = HTMLDivElement>({
  selector = '[data-nav-item]',
  orientation = 'vertical',
  loop = true,
}: {
  selector?: string
  orientation?: 'vertical' | 'horizontal' | 'both'
  loop?: boolean
} = {}) {
  const ref = useRef<T>(null)

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const root = ref.current
      if (!root) return
      const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
      const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
      const both = orientation === 'both'
      const isNext = e.key === next || (both && e.key === 'ArrowRight')
      const isPrev = e.key === prev || (both && e.key === 'ArrowLeft')
      if (!isNext && !isPrev && e.key !== 'Home' && e.key !== 'End') return

      const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => el.getClientRects().length > 0 && !el.hasAttribute('disabled'),
      )
      if (items.length === 0) return

      const at = items.indexOf(document.activeElement as HTMLElement)
      let to: number
      if (e.key === 'Home') to = 0
      else if (e.key === 'End') to = items.length - 1
      else if (at < 0) to = isNext ? 0 : items.length - 1
      else {
        to = at + (isNext ? 1 : -1)
        if (to < 0) to = loop ? items.length - 1 : 0
        if (to >= items.length) to = loop ? 0 : items.length - 1
      }
      e.preventDefault()
      items[to]?.focus({ preventScroll: true })
    },
    [loop, orientation, selector],
  )

  return { ref, listProps: { ref, onKeyDown } }
}
