/* ============================================================
   DB · слияние прочитанного с локальной правкой (§1.2 хвоста волны 2)
   Раньше одна запись, случившаяся раньше чтения из IndexedDB, навсегда
   отменяла применение прочитанного: состояние по умолчанию уезжало в
   базу поверх настоящего архива. Теперь прочитанное не отбрасывается,
   а сливается — локальная правка приоритетнее, но данные из базы целы.
   ============================================================ */

export type MergeFn<T> = (stored: T, local: T) => T

type WithId = { id: string }

function isIdArray(x: unknown): x is WithId[] {
  return (
    Array.isArray(x) &&
    x.every((it) => typeof it === 'object' && it !== null && typeof (it as WithId).id === 'string')
  )
}

/**
 * Правило по умолчанию:
 * — массивы объектов с `id` сливаются по id (порядок базы сохраняется,
 *   локальная версия элемента побеждает, новые локальные — в конец);
 * — записи-словари сливаются поверхностно, локальные ключи побеждают;
 * — всё остальное (числа, строки, флаги) — локальное значение.
 */
export function mergeById<T>(stored: T, local: T): T {
  if (isIdArray(stored) && isIdArray(local)) {
    const localById = new Map(local.map((it) => [it.id, it]))
    const out: WithId[] = stored.map((it) => localById.get(it.id) ?? it)
    const seen = new Set(stored.map((it) => it.id))
    for (const it of local) if (!seen.has(it.id)) out.push(it)
    return out as unknown as T
  }
  if (isPlainObject(stored) && isPlainObject(local)) {
    return { ...stored, ...local } as T
  }
  return local
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export type Reconciled<T> = {
  /** Что показывать после гидратации. */
  value: T
  /** Нужно ли записать результат в хранилище. */
  write: boolean
}

/**
 * Решение на момент «пришло прочитанное».
 * dirty=false — берём прочитанное как есть, писать нечего.
 * dirty=true  — сливаем: локальная правка не теряется, архив не затирается.
 * stored=undefined — в базе ничего нет: отложенная запись уходит сейчас.
 */
export function reconcile<T>(
  stored: T | undefined,
  local: T,
  dirty: boolean,
  merge: MergeFn<T> = mergeById,
): Reconciled<T> {
  if (stored === undefined) return { value: local, write: dirty }
  if (!dirty) return { value: stored, write: false }
  return { value: merge(stored, local), write: true }
}
