/* ============================================================
   ДВИЖОК ПЕРЕТАСКИВАНИЯ
   Pointer Events: одна ветка кода на мышь, тач и стилус.

   Ничего не мутирует: движок сообщает наружу «плитку X положили
   в Y» / «файл уронили на кластер Z» / «стикер бросили на файл F»,
   а кто и как это хранит — его не касается.

   Порог срыва обязателен дважды: без смещения мыши каждый клик по
   карточке дёргал бы сетку (перенос против выбора), а без долгого
   нажатия палец отобрал бы у страницы вертикальную прокрутку
   (тач против скролла).
   ============================================================ */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TileKey } from '@/lib/board-layout'

/** Что собирается сделать пользователь с плиткой. */
export type DragIntent = 'reorder' | 'cluster' | 'pin' | 'none'

export type DragState = {
  key: TileKey
  /** Экранная позиция указателя — под ним рисуется плавающая копия. */
  x: number
  y: number
  /** Смещение курсора внутри плитки: копия не прыгает под палец. */
  dx: number
  dy: number
  intent: DragIntent
  /** Ключ плитки-цели для reorder — вставка до/после неё. */
  overKey: TileKey | null
  /** Вставка перед целью (иначе — после её середины). */
  before: boolean
  /** id кластера для intent=cluster или id файла для intent=pin. */
  targetId: string | null
}

export type BoardDndOptions = {
  /** Плитку положили на позицию at видимого списка. */
  onMove: (key: TileKey, at: number) => void
  /** Файл уронили на чип кластера. */
  onCluster: (fileId: string, clusterId: string) => void
  /** Стикер уронили на карточку файла. */
  onPinTo: (noteId: string, fileId: string) => void
  /** Озвучивание для скринридеров. */
  announce?: (msg: string) => void
  /** Контейнер доски: от него ищется прокручиваемый предок автопрокрутки. */
  gridRef?: { current: HTMLElement | null }
}

/** Мышь срывает плитку смещением, палец — долгим нажатием. */
const MOUSE_THRESHOLD_PX = 6
const TOUCH_HOLD_MS = 450
/** Насколько далеко может уехать палец за время долгого нажатия. */
const TOUCH_HOLD_SLOP_PX = 12
const EDGE_ZONE_PX = 56
const EDGE_SPEED_PX = 14

function isTouch(e: { pointerType: string }): boolean {
  return e.pointerType !== 'mouse'
}

/**
 * Кто под указателем. Плитки помечены data-tile-key; чипы кластеров
 * (в тулбаре, вне доски) — data-drop-cluster; карточки файлов, готовые
 * принять стикер, — data-drop-pin.
 */
function hitTest(x: number, y: number): {
  tileEl: HTMLElement | null
  clusterId: string | null
  pinFileId: string | null
} {
  const el = document.elementFromPoint(x, y)
  if (!el) return { tileEl: null, clusterId: null, pinFileId: null }
  return {
    tileEl: el.closest<HTMLElement>('[data-tile-key]'),
    clusterId: el.closest<HTMLElement>('[data-drop-cluster]')?.dataset.dropCluster ?? null,
    pinFileId: el.closest<HTMLElement>('[data-drop-pin]')?.dataset.dropPin ?? null,
  }
}

/** Цель переноса из точки: приоритет — кластер, затем прикол, затем сетка. */
function resolveTarget(
  x: number,
  y: number,
): Pick<DragState, 'intent' | 'overKey' | 'before' | 'targetId'> {
  const hit = hitTest(x, y)
  const tileKind = hit.tileEl?.dataset.tileKey?.slice(0, 'file:'.length - 1)

  if (hit.clusterId && tileKind === 'file') {
    return { intent: 'cluster', targetId: hit.clusterId, overKey: null, before: true }
  }
  /* Стикер поверх собственного файла ничего не делает. */
  if (hit.pinFileId && tileKind === 'note') {
    const noteId = (hit.tileEl!.dataset.tileKey as string).slice('note:'.length)
    if (noteId !== hit.pinFileId) {
      return { intent: 'pin', targetId: hit.pinFileId, overKey: null, before: true }
    }
  }
  if (hit.tileEl) {
    const rect = hit.tileEl.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    return {
      intent: 'reorder',
      overKey: hit.tileEl.dataset.tileKey as TileKey,
      before: y < midY,
      targetId: null,
    }
  }
  return { intent: 'none', overKey: null, before: true, targetId: null }
}

/** Живая подсветка цели броска: атрибут ставится на чип или плитку. */
function markDropTarget(next: DragState | null) {
  document.querySelectorAll('[data-drop-active]').forEach((el) => {
    el.removeAttribute('data-drop-active')
  })
  if (!next) return
  if (next.intent === 'cluster' && next.targetId) {
    document
      .querySelector(`[data-drop-cluster="${CSS.escape(next.targetId)}"]`)
      ?.setAttribute('data-drop-active', '')
  } else if (next.intent === 'pin' && next.targetId) {
    document
      .querySelector(`[data-tile-key="note:${CSS.escape(next.targetId)}"] article`)
      ?.setAttribute('data-drop-active', '')
  }
}

export function useBoardDnd(opts: BoardDndOptions) {
  const [drag, setDrag] = useState<DragState | null>(null)

  const optsRef = useRef(opts)
  optsRef.current = opts

  /* Живое состояние жеста. Листенеры ставятся один раз, React не
     перерисовывается на каждый пиксель: вид обновляет rAF-батчинг. */
  const g = useRef({
    pointerId: -1,
    key: null as TileKey | null,
    /** Исходный элемент плитки — к нему цепляется pointer capture. */
    el: null as HTMLElement | null,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    lastX: 0,
    lastY: 0,
    active: false,
    holdTimer: null as ReturnType<typeof setTimeout> | null,
    edgeRaf: 0,
    paintRaf: 0,
    /** Видимый список на момент срыва — по нему считается позиция вставки. */
    visibleKeys: [] as TileKey[],
  })

  const stateRef = useRef<DragState | null>(null)

  const paint = useCallback((next: DragState) => {
    stateRef.current = next
    cancelAnimationFrame(g.current.paintRaf)
    g.current.paintRaf = requestAnimationFrame(() => setDrag(next))
  }, [])

  const clearHold = useCallback(() => {
    if (g.current.holdTimer) {
      clearTimeout(g.current.holdTimer)
      g.current.holdTimer = null
    }
  }, [])

  /** Срыв плитки: активный жест, захват указателя, автопрокрутка. */
  const lift = useCallback(() => {
    const s = g.current
    if (s.active || !s.key || !s.el) return
    s.active = true
    try {
      s.el.setPointerCapture(s.pointerId)
    } catch {
      /* элемент мог исчезнуть — жест всё равно продолжается по окну */
    }
    document.body.classList.add('board-dragging')
    optsRef.current.announce?.('Перетаскивание начато')
    cancelAnimationFrame(s.edgeRaf)
    s.edgeRaf = requestAnimationFrame(edgeLoopRef.current)
  }, [])

  /* Автопрокрутка у краёв. Скроллится ближайший прокручиваемый предок
     плитки (в библиотеке это .scroll-col, а не окно), окно — запасной
     вариант для доски на всю высоту страницы. */
  const scrollableAncestor = useCallback((): HTMLElement => {
    let el: HTMLElement | null = optsRef.current.gridRef?.current ?? null
    while (el) {
      const oy = getComputedStyle(el).overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el
      el = el.parentElement
    }
    return document.scrollingElement as HTMLElement
  }, [])

  /* Автопрокрутка окна у краёв — отдельными кадрами, чтобы работала и
     когда указатель замирает у границы. Доступ через ref: lift живёт
     выше по коду, а объявлен ниже. */
  const edgeLoopRef = useRef<() => void>(() => {})
  const edgeLoop = useCallback(() => {
    const s = g.current
    if (!s.active) return
    const margin = EDGE_ZONE_PX
    const scroller: HTMLElement | Window = scrollableAncestor()
    const isWindow = scroller === (document.scrollingElement as HTMLElement)
    const top = isWindow ? window.scrollY : (scroller as HTMLElement).scrollTop
    const maxTop = isWindow
      ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      : (scroller as HTMLElement).scrollHeight - (scroller as HTMLElement).clientHeight
    const atStart = top <= 0
    const atEnd = top >= maxTop - 1
    if (!atStart && s.lastY < margin) {
      if (isWindow) window.scrollBy(0, -EDGE_SPEED_PX)
      else (scroller as HTMLElement).scrollTop -= EDGE_SPEED_PX
    } else if (!atEnd && s.lastY > window.innerHeight - margin) {
      if (isWindow) window.scrollBy(0, EDGE_SPEED_PX)
      else (scroller as HTMLElement).scrollTop += EDGE_SPEED_PX
    }
    s.edgeRaf = requestAnimationFrame(edgeLoopRef.current)
  }, [scrollableAncestor])
  edgeLoopRef.current = edgeLoop

  const finish = useCallback(
    (commit: boolean, cancelled?: boolean) => {
      const s = g.current
      clearHold()
      cancelAnimationFrame(s.edgeRaf)
      cancelAnimationFrame(s.paintRaf)
      markDropTarget(null)
      if (s.el) {
        try {
          s.el.releasePointerCapture(s.pointerId)
        } catch {
          /* захват уже снят браузером — не страшно */
        }
      }
      const cur = stateRef.current
      if (s.active) document.body.classList.remove('board-dragging')
      const wasActive = s.active
      const movedKey = s.key
      const visibleKeys = s.visibleKeys
      s.key = null
      s.el = null
      s.active = false
      s.holdTimer = null
      stateRef.current = null

      if (wasActive && cur && commit && movedKey) {
        if (cur.intent === 'reorder' && cur.overKey && cur.overKey !== movedKey) {
          /* Позиция вставки — индекс цели в видимом списке БЕЗ самой
             перетаскиваемой плитки; «после цели» сдвигает на один. */
          const rest = visibleKeys.filter((k) => k !== movedKey)
          let at = rest.indexOf(cur.overKey)
          if (at >= 0) {
            if (!cur.before) at += 1
            optsRef.current.onMove(movedKey, at)
          }
        } else if (cur.intent === 'cluster' && cur.targetId) {
          optsRef.current.onCluster(movedKey.slice('file:'.length), cur.targetId)
        } else if (cur.intent === 'pin' && cur.targetId) {
          optsRef.current.onPinTo(movedKey.slice('note:'.length), cur.targetId)
        }
        optsRef.current.announce?.(cancelled ? 'Перенос отменён' : 'Плитка перемещена')
      }
      setDrag(null)
    },
    [clearHold],
  )

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const s = g.current
      if (!s.key || e.pointerId !== s.pointerId) return

      if (!s.active) {
        const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY)
        if (isTouch(e)) {
          /* Палец уехал раньше, чем истёк таймер, — это прокрутка. */
          if (dist > TOUCH_HOLD_SLOP_PX) {
            clearHold()
            s.key = null
            s.el = null
            stateRef.current = null
          }
          return
        }
        if (dist <= MOUSE_THRESHOLD_PX) return
        lift()
      }

      s.lastX = e.clientX
      s.lastY = e.clientY
      /* Пока тащим — страница не должна скроллиться под пальцем. */
      if (s.active && isTouch(e)) e.preventDefault()

      const base = stateRef.current
      if (!base) return
      const next: DragState = {
        ...base,
        x: e.clientX,
        y: e.clientY,
        ...resolveTarget(e.clientX, e.clientY),
      }
      if (
        next.intent !== base.intent ||
        next.overKey !== base.overKey ||
        next.before !== base.before ||
        next.targetId !== base.targetId ||
        next.x !== base.x ||
        next.y !== base.y
      ) {
        /* Подсветка цели: чип кластера или плитка-приёмник. */
        markDropTarget(next)
        paint(next)
      }
    }

    function onPointerUp() {
      if (!g.current.key) return
      finish(true)
    }

    function onPointerCancel() {
      if (!g.current.key) return
      finish(false, true)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && g.current.key) {
        e.preventDefault()
        finish(false, true)
        optsRef.current.announce?.('Перенос отменён')
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
      const s = g.current
      clearHold()
      cancelAnimationFrame(s.edgeRaf)
      cancelAnimationFrame(s.paintRaf)
      if (s.active) document.body.classList.remove('board-dragging')
    }
  }, [clearHold, edgeLoop, finish, lift, paint])

  /** Начало жеста: плитка запоминается сразу, подъём — по порогу/таймеру. */
  const startDrag = useCallback(
    (e: React.PointerEvent, key: TileKey, visibleKeys: readonly TileKey[]) => {
      if (e.button !== 0 && !isTouch(e.nativeEvent)) return
      /* Кнопки и поля внутри плитки живут своей жизнью. */
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, button, a')) return

      const s = g.current
      s.pointerId = e.pointerId
      s.key = key
      s.el =
        ((e.currentTarget as HTMLElement).closest('[data-tile-key]') as HTMLElement | null) ??
        (e.currentTarget as HTMLElement)
      s.startX = e.clientX
      s.startY = e.clientY
      s.dx = e.clientX - (s.el?.getBoundingClientRect().left ?? e.clientX)
      s.dy = e.clientY - (s.el?.getBoundingClientRect().top ?? e.clientY)
      s.lastX = e.clientX
      s.lastY = e.clientY
      s.visibleKeys = [...visibleKeys]

      const initial: DragState = {
        key,
        x: e.clientX,
        y: e.clientY,
        dx: s.dx,
        dy: s.dy,
        intent: 'reorder',
        overKey: null,
        before: true,
        targetId: null,
      }
      stateRef.current = initial

      if (isTouch(e.nativeEvent)) {
        /* Прокрутка остаётся прокруткой: подъём только по таймеру. */
        clearHold()
        s.holdTimer = setTimeout(() => {
          if (g.current.key && !g.current.active) {
            liftRef.current()
            const cur = stateRef.current
            if (cur) paint(cur)
          }
        }, TOUCH_HOLD_MS)
      }
    },
    [clearHold, paint],
  )

  /* ---------- Клавиатурный перенос ---------- */

  const kb = useRef<{ key: TileKey | null; index: number }>({ key: null, index: -1 })
  const [kbDragging, setKbDragging] = useState<TileKey | null>(null)

  /* Доступ к lift из таймера startDrag: объявлён выше по коду. */
  const liftRef = useRef<() => void>(() => {})
  liftRef.current = lift

  const kbPick = useCallback((key: TileKey, index: number, total: number) => {
    kb.current = { key, index }
    setKbDragging(key)
    optsRef.current.announce?.(
      `Плитка взята, позиция ${index + 1} из ${total}. Стрелки — перенос, пробел — положить, Escape — отмена.`,
    )
  }, [])

  const kbMove = useCallback(
    (delta: number, total: number): boolean => {
      const k = kb.current
      if (!k.key) return false
      const next = Math.max(0, Math.min(total - 1, k.index + delta))
      if (next === k.index) {
        optsRef.current.announce?.(delta < 0 ? 'Уже первая позиция' : 'Уже последняя позиция')
        return false
      }
      k.index = next
      optsRef.current.announce?.(`Позиция ${next + 1} из ${total}`)
      return true
    },
    [],
  )

  const kbDrop = useCallback(() => {
    const k = kb.current
    if (!k.key) return
    const key = k.key
    const at = k.index
    kb.current = { key: null, index: -1 }
    setKbDragging(null)
    optsRef.current.onMove(key, at)
    optsRef.current.announce?.(`Плитка положена на позицию ${at + 1}`)
  }, [])

  const kbCancel = useCallback(() => {
    if (!kb.current.key) return
    kb.current = { key: null, index: -1 }
    setKbDragging(null)
    optsRef.current.announce?.('Перенос отменён')
  }, [])

  return {
    /** Состояние жеста для плавающей копии и слота призрака. */
    drag,
    /** Ключ плитки в клавиатурном переносе. */
    kbDragging,
    startDrag,
    keyboard: { pick: kbPick, move: kbMove, drop: kbDrop, cancel: kbCancel },
    isActive: !!drag || !!kbDragging,
  }
}
