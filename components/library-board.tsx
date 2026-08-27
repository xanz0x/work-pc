'use client'

/* ============================================================
   ДОСКА БИБЛИОТЕКИ
   Контролируемый компонент размещения: получает список плиток и
   сохранённую раскладку, отдаёт наружу решения пользователя. Сам
   он не рисует содержимое карточек — этим ведает renderTile из
   экрана библиотеки, поэтому существующая вёрстка карточек
   (ncard/fcard, замки, счётчики, выбор) остаётся нетронутой.

   Слоёв вью у доски два: сетка и плавающая копия перетаскиваемой
   плитки. Призрак посадки — обычный ребёнок сетки на месте, куда
   плитка ляжет при отпускании.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  arrange,
  commitMove,
  cycleSize,
  pinnedOf,
  parseTileKey,
  SIZE_LABEL,
  togglePin,
  type BoardId,
  type BoardLayout,
  type BoardLayouts,
  type Density,
  type TileKey,
  type TileSize,
} from '@/lib/board-layout'
import { useBoardDnd } from '@/hooks/use-board-dnd'
import { IconGrip, IconPinTop, IconResize } from './icons'

export type BoardItem = {
  key: TileKey
  /** Что рендерить внутри плитки — решает экран. */
  content: React.ReactNode
}

export type LibraryBoardProps = {
  boardId: BoardId
  items: BoardItem[]
  /** Полный список ключей до фильтров — порядок живёт по нему. */
  allKeys: readonly TileKey[]
  layouts: BoardLayouts
  density: Density
  onLayouts: (next: BoardLayouts) => void
  /** Стикер бросили на карточку файла. */
  onPinNote: (noteId: string, fileId: string) => void
  /** Файл бросили на чип кластера. */
  onDropCluster: (fileId: string, clusterId: string) => void
  /** Подпись для объявлений: «файл …» / «стикер …». */
  labelOf?: (key: TileKey) => string
}

/** Колонок должно хватать на любую ширину, но не больше числа плиток. */
function colsForWidth(w: number): number {
  if (w >= 1280) return 4
  if (w >= 900) return 3
  if (w >= 560) return 2
  return 1
}

export function LibraryBoard({
  boardId,
  items,
  allKeys,
  layouts,
  density,
  onLayouts,
  onPinNote,
  onDropCluster,
  labelOf,
}: LibraryBoardProps) {
  const layout: BoardLayout = layouts[boardId] ?? { order: [] }

  const [cols, setCols] = useState(3)
  const gridRef = useRef<HTMLDivElement | null>(null)

  /* Число колонок — из ширины контейнера, а не окна: доска живёт в
     колонке рядом с инспектором. */
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth
      setCols(colsForWidth(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const orderedKeys = useMemo(() => arrange(allKeys, layout), [allKeys, layout])
  const byKey = useMemo(() => new Map(items.map((it) => [it.key, it])), [items])
  const pinnedSet = useMemo(() => new Set(pinnedOf(layout)), [layout])

  /* Видимый список в актуальном порядке — его знает движок переноса. */
  const visibleKeys = useMemo(
    () => orderedKeys.filter((k) => byKey.has(k)),
    [orderedKeys, byKey],
  )

  const announce = useCallback((msg: string) => {
    const el = document.getElementById('board-live')
    if (el) {
      el.textContent = ''
      requestAnimationFrame(() => {
        el.textContent = msg
      })
    }
    if (process.env.NODE_ENV !== 'production') console.info(`[доска] ${msg}`)
  }, [])

  const dnd = useBoardDnd({
    onMove: (key, at) => {
      const cur = layouts[boardId] ?? { order: [] }
      /* commitMove сам вольёт перенос видимых в общий порядок. */
      onLayouts({
        ...layouts,
        [boardId]: commitMove(cur, allKeys, visibleKeys, key, at),
      })
      announce(`${labelOf?.(key) ?? key} → позиция ${at + 1}`)
    },
    onCluster: (fileId, clusterId) => onDropCluster(fileId, clusterId),
    onPinTo: (noteId, fileId) => onPinNote(noteId, fileId),
    announce,
    gridRef,
  })

  const setSizeOf = useCallback(
    (key: TileKey, current: TileSize) => {
      const { layout: next, size } = cycleSize(layout, key, allKeys)
      onLayouts({ ...layouts, [boardId]: next })
      announce(`Размер плитки «${labelOf?.(key) ?? key}» — ${SIZE_LABEL[size]}`)
      void current
    },
    [layout, allKeys, layouts, boardId, onLayouts, announce, labelOf],
  )

  const pinOf = useCallback(
    (key: TileKey) => {
      const { layout: next, pinned } = togglePin(layout, key, allKeys)
      onLayouts({ ...layouts, [boardId]: next })
      const name = labelOf?.(key) ?? key
      announce(pinned ? `${name} закреплена наверху` : `${name} откреплена`)
    },
    [layout, allKeys, layouts, boardId, onLayouts, announce, labelOf],
  )

  /* ---------- Клавиатурный перенос ---------- */

  const onTileKeyDown = useCallback(
    (e: React.KeyboardEvent, key: TileKey) => {
      const grip = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-tile-grip]')
      const total = visibleKeys.length

      if (!dnd.kbDragging) {
        if ((e.key === ' ' || e.key === 'Enter') && e.target === e.currentTarget && grip) {
          e.preventDefault()
          grip.focus()
          dnd.keyboard.pick(key, visibleKeys.indexOf(key), total)
          return
        }
        if (e.key === 'Escape') dnd.keyboard.cancel()
        return
      }

      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault()
        dnd.keyboard.cancel()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!dnd.keyboard.move(-1, total)) return
        /* Визуально переставляем сразу: доска отвечает на каждый шаг. */
        const idx = visibleKeys.indexOf(key)
        const target = visibleKeys[Math.max(0, idx - 1)]
        if (target && target !== key) {
          applyMovePreview(target, true)
        }
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (!dnd.keyboard.move(-0 + 1, total)) return
        const idx = visibleKeys.indexOf(key)
        const target = visibleKeys[Math.min(total - 1, idx + 1)]
        if (target && target !== key) {
          applyMovePreview(target, false)
        }
        return
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        dnd.keyboard.drop()
        return
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dnd.kbDragging, dnd.keyboard, visibleKeys],
  )

  /** Промежуточная перестановка на каждый шаг стрелки — до финального drop. */
  const applyMovePreview = useCallback(
    (targetKey: TileKey, beforeTarget: boolean) => {
      const moving = dnd.kbDragging
      if (!moving || targetKey === moving) return
      const rest = visibleKeys.filter((k) => k !== moving)
      let at = rest.indexOf(targetKey)
      if (at < 0) return
      if (!beforeTarget) at += 1
      const preview = [...rest.slice(0, at), moving, ...rest.slice(at)]
      kbPreviewRef.current = preview
    },
    [dnd.kbDragging, visibleKeys],
  )

  const kbPreviewRef = useRef<TileKey[] | null>(null)

  /* Порядок показа: клавиатурный предпросмотр перекрывает сохранённый. */
  const shownOrder = kbPreviewRef.current && dnd.kbDragging ? kbPreviewRef.current : visibleKeys

  /* ---------- Геометрия призрака ---------- */

  const dragKey = dnd.drag?.key ?? null
  const ghostIndex = useMemo(() => {
    if (!dragKey || !dnd.drag || dnd.drag.intent !== 'reorder') return -1
    const base = shownOrder.filter((k) => k !== dragKey)
    if (!dnd.drag.overKey || dnd.drag.overKey === dragKey) return base.length
    let at = base.indexOf(dnd.drag.overKey)
    if (at < 0) at = base.length
    if (!dnd.drag.before) at += 1
    return at
  }, [dragKey, dnd.drag, shownOrder])

  const spanFor = useCallback(
    (key: TileKey): readonly [number, number] => {
      const size = layout.sizes?.[key] ?? 'sm'
      const map: Record<TileSize, readonly [number, number]> = {
        sm: [1, 1],
        wide: [2, 1],
        tall: [1, 2],
        xl: [2, 2],
      }
      const [cx, cy] = map[size]
      if (cols <= 1) return [1, cy]
      if (cols === 2) return [Math.min(cx, 2), cy]
      return [cx, cy]
    },
    [cols, layout],
  )

  /* ---------- Рендер ---------- */

  const singleCol = cols <= 1

  return (
    <>
      <div
        className={`board${singleCol ? ' one-col' : ''}${density === 'compact' ? ' compact' : ''}`}
        data-cols={cols}
        style={{ ['--board-cols' as string]: String(cols) }}
      >
        <div className="board-grid" ref={gridRef}>
          {shownOrder.map((key, i) => {
            const item = byKey.get(key)
            if (!item) return null
            const isDrag = key === dragKey && !!dnd.drag
            const isKbDrag = key === dnd.kbDragging
            const [cx, cy] = spanFor(key)
            const kind = parseTileKey(key).kind
            const pinnedNow = pinnedSet.has(key)
            return (
              <div
                key={key}
                data-tile-key={key}
                className={`tile${isDrag ? ' dragging' : ''}${isKbDrag ? ' kb-dragging' : ''}${
                  pinnedNow ? ' pinned' : ''
                }`}
                data-cx={cx}
                data-cy={cy}
                style={{
                  gridColumnEnd: `span ${cx}`,
                  gridRowEnd: `span ${cy}`,
                  animationDelay: `${Math.min(i * 40, 400)}ms`,
                }}
                onPointerDown={(e) => dnd.startDrag(e, key, visibleKeys)}
                onKeyDown={(e) => onTileKeyDown(e, key)}
              >
                <span
                  className="tile-grip"
                  data-tile-grip
                  tabIndex={-1}
                  aria-hidden="true"
                  title="Перетащить"
                >
                  <IconGrip width={12} height={12} stroke="currentColor" strokeWidth={1.6} />
                </span>
                <div className="tile-tools">
                  <button
                    type="button"
                    className="tile-size"
                    tabIndex={-1}
                    onClick={() => setSizeOf(key, layout.sizes?.[key] ?? 'sm')}
                    aria-label={`Изменить размер плитки «${labelOf?.(key) ?? key}», сейчас ${SIZE_LABEL[layout.sizes?.[key] ?? 'sm']}`}
                    title="Размер"
                  >
                    <IconResize width={12} height={12} stroke="currentColor" strokeWidth={1.6} />
                  </button>
                  {kind === 'note' && (
                    <button
                      type="button"
                      className="tile-pin"
                      tabIndex={-1}
                      onClick={() => pinOf(key)}
                      aria-label={`${pinnedNow ? 'Открепить' : 'Закрепить'} плитку «${labelOf?.(key) ?? key}»`}
                      title={pinnedNow ? 'Открепить' : 'Наверх'}
                    >
                      <IconPinTop width={12} height={12} stroke="currentColor" strokeWidth={1.6} />
                    </button>
                  )}
                </div>
                {item.content}
              </div>
            )
          })}

          {/* Призрак посадки: встаёт между плитками на место приземления. */}
          {ghostIndex >= 0 && (
            <div
              className="tile-slot"
              data-slot={
                dnd.drag?.intent === 'cluster'
                  ? 'cluster'
                  : dnd.drag?.intent === 'pin'
                    ? 'pin'
                    : 'move'
              }
              aria-hidden="true"
              style={{
                gridColumnEnd: `span ${spanFor(dragKey as TileKey)[0]}`,
                gridRowEnd: `span ${spanFor(dragKey as TileKey)[1]}`,
              }}
            />
          )}
        </div>
      </div>

      {/* Плавающая копия плитки под указателем. */}
      {dnd.drag && dragKey && byKey.get(dragKey) && (
        <div
          className="tile-ghost"
          data-ghost={
            dnd.drag.intent === 'cluster'
              ? 'cluster'
              : dnd.drag.intent === 'pin'
                ? 'pin'
                : 'move'
          }
          style={{ transform: `translate(${dnd.drag.x - dnd.drag.dx}px, ${dnd.drag.y - dnd.drag.dy}px)` }}
        >
          <div
            className={`tile ghost-tile${dnd.drag.intent !== 'reorder' ? ' alt-target' : ''}`}
            style={{
              width: ghostW(gridRef.current, cols, spanFor(dragKey)[0]),
            }}
          >
            {byKey.get(dragKey)?.content}
          </div>
        </div>
      )}
    </>
  )
}

/** Ширина плавающей копии: как у плитки такого размаха в текущей сетке. */
function ghostW(grid: HTMLElement | null, cols: number, cx: number): number | undefined {
  if (!grid) return undefined
  const gap = parseFloat(getComputedStyle(grid).columnGap || '14') || 14
  const w = grid.clientWidth
  return Math.floor((w - gap * (cols - 1)) / cols) * cx + gap * (cx - 1)
}

/** Реэкспорт для экрана: собрать ключи плиток без знания внутренностей. */
export { tileKey as makeTileKey } from '@/lib/board-layout'
