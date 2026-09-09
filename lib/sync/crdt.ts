/* ============================================================
   NF-11 · CRDT для синхронизации
   LWW по каждому полю с меткой (ts, dev): гибридные логические часы
   и id устройства как арбитр при равенстве. Удаление — tombstone с той же
   меткой; более поздняя запись поля воскрешает объект. Счётчик операций
   на устройство (векторные часы) отсекает повторную доставку.
   Модуль чистый: ни React, ни сети, ни крипто — его можно гонять в тесте
   на двух «устройствах» и проверять сходимость в любом порядке.
   ============================================================ */

export type Col = 'files' | 'notes' | 'notifs'
export const COLS: Col[] = ['files', 'notes', 'notifs']

export type Stamp = { ts: number; dev: string }

export type Op = {
  col: Col
  id: string
  ts: number
  dev: string
  /** Порядковый номер операции на устройстве — векторные часы. */
  n: number
} & ({ set: Record<string, unknown> } | { del: true })

type FieldState = { v: unknown; ts: number; dev: string }
export type ItemState = { f: Record<string, FieldState>; del?: Stamp }

export type CrdtState = {
  v: 1
  items: Record<Col, Record<string, ItemState>>
  /** dev → последний применённый n этого устройства. */
  clock: Record<string, number>
}

export function emptyState(): CrdtState {
  return { v: 1, items: { files: {}, notes: {}, notifs: {} }, clock: {} }
}

/** Строгий порядок меток: при равном времени побеждает большее имя устройства. */
export function newer(a: Stamp, b: Stamp): boolean {
  return a.ts > b.ts || (a.ts === b.ts && a.dev > b.dev)
}

/** Гибридные часы: монотонны даже при откате системного времени. */
export function makeClock(dev: string) {
  let last = 0
  return {
    dev,
    now(): number {
      last = Math.max(Date.now(), last + 1)
      return last
    },
    observe(ts: number): void {
      if (ts > last) last = ts
    },
  }
}

/** Применить операцию. false — уже видели или устарела, состояние не менялось. */
export function applyOp(state: CrdtState, op: Op): boolean {
  const seen = state.clock[op.dev] ?? 0
  if (op.n <= seen) return false
  state.clock[op.dev] = op.n
  const col = state.items[op.col]
  const item = (col[op.id] ??= { f: {} })
  const stamp = { ts: op.ts, dev: op.dev }
  let changed = false
  if ('del' in op) {
    if (!item.del || newer(stamp, item.del)) {
      item.del = stamp
      changed = true
    }
    return changed
  }
  for (const [k, v] of Object.entries(op.set)) {
    const cur = item.f[k]
    if (!cur || newer(stamp, cur)) {
      item.f[k] = { v, ts: op.ts, dev: op.dev }
      changed = true
    }
  }
  return changed
}

function alive(item: ItemState): boolean {
  if (!item.del) return true
  for (const f of Object.values(item.f)) if (newer(f, item.del)) return true
  return false
}

type WithId = { id: string }

/** Материализация коллекции. `order` — текущий локальный порядок id: он сохраняется. */
export function materialize<T extends WithId>(state: CrdtState, col: Col, order: string[] = []): T[] {
  const items = state.items[col]
  const out: T[] = []
  const build = (id: string): T | null => {
    const it = items[id]
    if (!it || !alive(it)) return null
    const obj: Record<string, unknown> = { id }
    for (const [k, f] of Object.entries(it.f)) obj[k] = f.v
    return obj as T
  }
  const seen = new Set<string>()
  for (const id of order) {
    const o = build(id)
    if (o) {
      out.push(o)
      seen.add(id)
    }
  }
  for (const id of Object.keys(items)) if (!seen.has(id)) {
    const o = build(id)
    if (o) out.push(o)
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Разница локального массива и материализованного состояния → операции
 * этого устройства. Поля из `skip` не синхронизируются (например,
 * транзиентный `processing`). Возвращённые операции УЖЕ применены к state.
 */
export function diffLocal<T extends WithId>(
  state: CrdtState,
  col: Col,
  current: T[],
  clock: ReturnType<typeof makeClock>,
  nextN: () => number,
  skip: string[] = [],
): Op[] {
  const ops: Op[] = []
  const items = state.items[col]
  const present = new Set<string>()
  for (const obj of current) {
    present.add(obj.id)
    const it = items[obj.id]
    const wasAlive = it ? alive(it) : false
    const set: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'id' || skip.includes(k)) continue
      const cur = it?.f[k]
      if (v === undefined) continue
      if (!wasAlive || !cur || !same(cur.v, v)) set[k] = v
    }
    if (wasAlive && it) {
      for (const k of Object.keys(it.f)) {
        if (skip.includes(k) || k in obj) continue
        if (it.f[k].v !== null) set[k] = null
      }
    }
    if (Object.keys(set).length === 0) continue
    const op: Op = { col, id: obj.id, ts: clock.now(), dev: clock.dev, n: nextN(), set }
    applyOp(state, op)
    ops.push(op)
  }
  for (const [id, it] of Object.entries(items)) {
    if (present.has(id) || !alive(it)) continue
    const op: Op = { col, id, ts: clock.now(), dev: clock.dev, n: nextN(), del: true }
    applyOp(state, op)
    ops.push(op)
  }
  return ops
}

/** Проверка формы операции на границе (пришла расшифрованной с сервера). */
export function isOp(x: unknown): x is Op {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  if (!COLS.includes(o.col as Col) || typeof o.id !== 'string') return false
  if (typeof o.ts !== 'number' || typeof o.dev !== 'string' || typeof o.n !== 'number') return false
  if ('del' in o) return o.del === true
  return typeof o.set === 'object' && o.set !== null && !Array.isArray(o.set)
}
