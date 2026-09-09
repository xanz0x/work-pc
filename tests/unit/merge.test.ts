import { describe, expect, it } from 'vitest'
import { mergeById, reconcile } from '@/lib/db/merge'

/**
 * §1.2 хвоста волны 2: запись, случившаяся раньше чтения из IndexedDB,
 * больше не отменяет прочитанное. Проверяется именно правило слияния —
 * его использует usePersistedState в момент гидратации.
 */
describe('слияние прочитанного с локальной правкой', () => {
  it('массивы сливаются по id: порядок базы, локальная версия побеждает', () => {
    const stored = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }]
    const local = [{ id: 'b', n: 20 }, { id: 'd', n: 4 }]
    expect(mergeById(stored, local)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 20 },
      { id: 'c', n: 3 },
      { id: 'd', n: 4 },
    ])
  })

  it('запись на первом кадре не затирает архив из базы', () => {
    /* Пользователь (или эффект) добавил один файл до гидратации. */
    const local = [{ id: 'new', name: 'только что добавлен' }]
    const stored = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: `файл ${i}` }))
    const r = reconcile(stored, local, true)
    expect(r.write).toBe(true)
    expect(r.value).toHaveLength(51)
    expect(r.value.map((f) => f.id)).toContain('f49')
    expect(r.value.map((f) => f.id)).toContain('new')
  })

  it('без локальной правки прочитанное применяется как есть и не пишется обратно', () => {
    const stored = [{ id: 'a' }]
    const r = reconcile(stored, [], false)
    expect(r).toEqual({ value: stored, write: false })
  })

  it('в базе пусто: отложенная локальная запись уходит после гидратации', () => {
    const r = reconcile(undefined, [{ id: 'a' }], true)
    expect(r.write).toBe(true)
    expect(r.value).toEqual([{ id: 'a' }])
    expect(reconcile(undefined, [], false).write).toBe(false)
  })

  it('словари сливаются поверхностно, скаляры берутся локальные', () => {
    expect(mergeById({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 })
    expect(mergeById(5, 7)).toBe(7)
    expect(mergeById('да', 'нет')).toBe('нет')
    expect(mergeById(['x'], ['y'])).toEqual(['y'])
  })

  it('правило слияния можно задать на ключ', () => {
    const sum = (s: number, l: number) => s + l
    expect(reconcile(10, 5, true, sum)).toEqual({ value: 15, write: true })
  })
})
