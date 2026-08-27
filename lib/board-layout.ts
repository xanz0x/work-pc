/* ============================================================
   РАСКЛАДКА ДОСКИ
   Чистая модель мозаики: порядок + размер плиток, без координат.
   Хранить «X/Y на холсте» нельзя — раскладка ломается на узком
   экране. Здесь же число колонок вычисляется из ширины, а на
   одной колонке горизонтальные размеры сворачиваются сами.

   Файл не знает ни React, ни DOM: только типы и функции над
   массивами. Поэтому его поведение можно проверять отдельно от
   вида — что и сделано в lib/board-layout.test-логике ниже
   (см. проверку commitMove на скрытых плитках).
   ============================================================ */

/** Размер плитки: 1×1, 2×1, 1×2, 2×2 в ячейках доски. */
export type TileSize = 'sm' | 'wide' | 'tall' | 'xl'

/**
 * Ключ плитки: один формат для файла и стикера. Именно он позволяет
 * режиму «Всё» быть единой доской из двух слоёв памяти, а не двумя
 * списками, между которыми нельзя перекладывать.
 */
export type TileKey = `file:${string}` | `note:${string}`

export const tileKey = {
  file: (id: string): TileKey => `file:${id}`,
  note: (id: string): TileKey => `note:${id}`,
}

export function parseTileKey(key: TileKey): { kind: 'file' | 'note'; id: string } {
  const at = key.indexOf(':')
  return { kind: key.slice(0, at) as 'file' | 'note', id: key.slice(at + 1) }
}

/* ---------- размеры ---------- */

/** Размах размера в ячейках: [колонок, строк]. */
export const TILE_SPAN: Record<TileSize, readonly [number, number]> = {
  sm: [1, 1],
  wide: [2, 1],
  tall: [1, 2],
  xl: [2, 2],
}

/** Порядок перебора кнопкой размера: маленькая → широкая → высокая → большая. */
export const SIZE_CYCLE: readonly TileSize[] = ['sm', 'wide', 'tall', 'xl'] as const

/** Русские подписи размеров — для aria-label и объявлений. */
export const SIZE_LABEL: Record<TileSize, string> = {
  sm: 'маленькая',
  wide: 'широкая',
  tall: 'высокая',
  xl: 'большая',
}

/* ---------- плотность ---------- */

export type Density = 'cozy' | 'compact'

export const DENSITY_LABEL: Record<Density, string> = {
  cozy: 'свободная',
  compact: 'плотная',
}

/* ---------- состояние ---------- */

/**
 * Раскладка одной доски. Порядок один на всё; закрепление НЕ хранится
 * вторым списком, а выводится из порядка — иначе блок наверху и сетка
 * обязательно разъезжаются.
 */
export type BoardLayout = {
  /** Порядок доски. Пустой массив — сортировка по умолчанию. */
  order: TileKey[]
  /** Размеры по ключу; отсутствующие считаются sm. */
  sizes?: Partial<Record<TileKey, TileSize>>
  /** Прикреплённые кверху ключи (внутри общего порядка они идут первыми). */
  pinned?: TileKey[]
}

/** Три доски: единая, файлов и стикеров. */
export type BoardId = 'all' | 'files' | 'notes'
export type BoardLayouts = Partial<Record<BoardId, BoardLayout>>

export function layoutOf(layouts: BoardLayouts, id: BoardId): BoardLayout {
  return layouts[id] ?? { order: [] }
}

export function putBoard(layouts: BoardLayouts, id: BoardId, next: BoardLayout): BoardLayouts {
  return { ...layouts, [id]: next }
}

/** Есть ли пользовательская настройка — от неё зависит видимость «Сбросить». */
export function isCustom(l: BoardLayout | undefined): boolean {
  if (!l) return false
  return l.order.length > 0 || !!l.pinned?.length || Object.keys(l.sizes ?? {}).length > 0
}

/* ============================================================
   АКТУАЛИЗАЦИЯ ПОРЯДКА
   ============================================================ */

/**
 * Раскладывает актуальный список ключей по сохранённому порядку:
 * закреплённые идут наверху, известные — по order, новые (только что
 * добавленный стикер, свежий файл) встают в конец своей группы —
 * после известных своего слоя и перед чужими, чтобы новый файл не
 * вклинивался между существующими стикерами. Ключи, которых больше
 * нет (сгоревший стикер, удалённый файл), выпадают молча.
 *
 * @param allKeys полный список до фильтров — по нему считается порядок
 * @param layout сохранённая раскладка этой доски
 */
export function arrange(allKeys: readonly TileKey[], layout: BoardLayout): TileKey[] {
  const alive = new Set(allKeys)

  /* Устаревшие записи выбрасываем сразу — они не должны ничего тянуть.
     Порядок задаёт только order: закреплённые читаются из pinned и
     ставятся в начало, но НЕ вырезаются из порядка — их позиция в
     порядке просто игнорируется (иначе перенос при активном фильтре
     потерял бы скрытые ключи). */
  const known = layout.order.filter((k) => alive.has(k))
  const seen = new Set(known)

  /* Новички — то, чего порядок ещё не видел. */
  const freshFiles: TileKey[] = []
  const freshNotes: TileKey[] = []
  for (const k of allKeys) {
    if (seen.has(k)) continue
    ;(k.startsWith('file:') ? freshFiles : freshNotes).push(k)
    seen.add(k)
  }

  /* Последний известный ключ каждого слоя — точка присоединения новичков. */
  let lastFileIdx = -1
  let lastNoteIdx = -1
  const ordered = [...known]
  ordered.forEach((k, i) => {
    if (k.startsWith('file:')) lastFileIdx = i
    else lastNoteIdx = i
  })

  /* Вставляем новичков после последнего своего: файлы за файлами,
     стикеры за стикерами. Заодно поднимаем их выше чужого «хвоста»,
     если свой слой уже закончился. */
  const insertAt = (list: TileKey[], idx: number, items: TileKey[]) =>
    idx < 0 ? [...items, ...list] : [...list.slice(0, idx + 1), ...items, ...list.slice(idx + 1)]

  let out =
    freshFiles.length > 0 ? insertAt(ordered, lastFileIdx, freshFiles) : ordered
  if (freshNotes.length > 0) {
    /* Индекс последнего стикера сдвинулся после первой вставки. */
    let ln = -1
    out.forEach((k, i) => {
      if (k.startsWith('note:')) ln = i
    })
    out = insertAt(out, ln, freshNotes)
  }
  return out
}

/* ============================================================
   ПЕРЕНОС
   ============================================================ */

/**
 * Переносит ключ на позицию at ВНУТРИ видимого списка и вливает
 * результат обратно в общий порядок, чтобы перенос при активном
 * фильтре или поиске не затирал раскладку скрытых плиток — самая
 * частая ошибка таких досок.
 */
export function commitMove(
  layout: BoardLayout,
  allKeys: readonly TileKey[],
  visibleKeys: readonly TileKey[],
  key: TileKey,
  at: number,
): BoardLayout {
  const full = arrange(allKeys, layout)
  const visibleSet = new Set(visibleKeys)
  const visible = visibleKeys.filter((k) => k !== key)

  /* Позиция вставки с учётом того, что сама плитка ушла из списка. */
  const clampedAt = Math.max(0, Math.min(visible.length - 1, Math.max(0, at)))
  const before = visible.slice(0, clampedAt)
  const after = visible.slice(clampedAt)
  const movedVisible = [...before, key, ...after]

  /* Сшиваем: идём по полному порядку, на месте каждого видимого ключа
     берём следующий из перестроенного видимого списка, скрытые
     проносим как стояли. Так ни один скрытый ключ не теряется. */
  const queue = [...movedVisible]
  const merged = full.map((k) => (visibleSet.has(k) ? (queue.shift() ?? k) : k))

  /* Если перетаскивали последний скрытый… не бывает: movedVisible всегда
     покрывает все видимые. Осталось убрать дубликаты на всякий случай. */
  const result = merged.filter((k, i) => merged.indexOf(k) === i)

  const prevSizes = layout.sizes ?? {}
  const prevPinned = layout.pinned ?? []
  return {
    order: result,
    /* Размеры и закрепления чистим от исчезнувших ключей, но не трогаем
       остальное: пользовательская настройка переживает фильтры.
       Перенесённая плитка выходит из закрепления: пользователь явно
       указал ей место в общем порядке. */
    sizes: Object.fromEntries(
      Object.entries(prevSizes).filter(([k]) => result.includes(k as TileKey)),
    ) as BoardLayout['sizes'],
    pinned: prevPinned.filter((k) => k !== key && result.includes(k)),
  }
}

/* ============================================================
   РАЗМЕР И ЗАКРЕПЛЕНИЕ
   ============================================================ */

export function setSize(
  layout: BoardLayout,
  key: TileKey,
  size: TileSize,
  allKeys: readonly TileKey[],
): BoardLayout {
  const sizes: Partial<Record<TileKey, TileSize>> = { ...(layout.sizes ?? {}), [key]: size }
  if (size === 'sm') delete sizes[key]
  return normalize({ ...layout, sizes }, allKeys)
}

export function cycleSize(layout: BoardLayout, key: TileKey, allKeys: readonly TileKey[]): {
  layout: BoardLayout
  size: TileSize
} {
  const current = layout.sizes?.[key] ?? 'sm'
  const next = SIZE_CYCLE[(SIZE_CYCLE.indexOf(current) + 1) % SIZE_CYCLE.length]
  return { layout: setSize(layout, key, next, allKeys), size: next }
}

/**
 * Закрепление выводится из порядка при чтении: arrange ставит pinned
 * наверх, поэтому отдельного «блока наверху» не существует — рассинхрон
 * невозможен по построению.
 */
export function pinnedOf(layout: BoardLayout): TileKey[] {
  return layout.pinned ?? []
}

export function togglePin(
  layout: BoardLayout,
  key: TileKey,
  allKeys: readonly TileKey[],
): { layout: BoardLayout; pinned: boolean } {
  const cur = new Set(layout.pinned ?? [])
  if (cur.has(key)) cur.delete(key)
  else cur.add(key)
  /* Ключ уходит из order, когда становится pinned: иначе arrange
     увидит его дважды — и в закреплении, и в порядке. */
  const order = cur.has(key) ? (layout.order ?? []).filter((k) => k !== key) : layout.order ?? []
  return {
    layout: normalize({ ...layout, order, pinned: [...cur] }, allKeys),
    pinned: cur.has(key),
  }
}

/** Сброс доски к сортировке по умолчанию. */
export function resetBoard(): BoardLayout {
  return { order: [] }
}

/* ============================================================
   СЛУЖЕБНОЕ
   ============================================================ */

/** Убирает из раскладки ключи, которых нет в актуальном списке. */
function normalize(layout: BoardLayout, allKeys: readonly TileKey[]): BoardLayout {
  const alive = new Set(arrange(allKeys, layout))
  const sizes = Object.fromEntries(
    Object.entries(layout.sizes ?? {}).filter(([k]) => alive.has(k as TileKey)),
  ) as BoardLayout['sizes']
  return {
    order: layout.order,
    sizes,
    pinned: (layout.pinned ?? []).filter((k) => alive.has(k)),
  }
}
