'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPersisted, savePersisted } from '@/lib/db/persist'
import { mergeById, type MergeFn } from '@/lib/db/merge'
import { subscribeDocChange } from '@/lib/db/sync'

/**
 * Состояние, которое живёт между перезагрузками. Первый рендер всегда отдаёт
 * значение по умолчанию — иначе разъедется гидратация; хранилище читается в
 * эффекте (IndexedDB асинхронный, мелочь — синхронно из localStorage).
 * Третий элемент кортежа — признак «данные прочитаны».
 *
 * §1.2: запись до окончания гидратации не отбрасывает прочитанное и не тащит
 * в него значение по умолчанию. Ранние записи запоминаются КАК ОПЕРАЦИИ и
 * переигрываются поверх прочитанного: `setFiles(all => [новый, ...all])`,
 * случившийся до чтения, добавляет один файл к архиву из базы, а не
 * подмешивает к нему демо-набор из initial. Запись готовым значением
 * (без функции) сливается по правилу `merge` — прочитанное не теряется.
 * §1.5: изменение документа в другой вкладке приходит через BroadcastChannel.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
  merge: MergeFn<T> = mergeById as MergeFn<T>,
): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)
  const keyRef = useRef(key)
  /** До гидратации записи не уходят в хранилище: иначе затрут архив. */
  const hydratedRef = useRef(false)
  const pendingRef = useRef<T>(initial)
  /** Ранние записи как операции — переигрываются на прочитанном. */
  const opsRef = useRef<((prev: T) => T)[]>([])
  /* Правило слияния берётся при монтировании: оно про ключ, а не про рендер. */
  const mergeRef = useRef(merge)

  useEffect(() => {
    keyRef.current = key
    hydratedRef.current = false
    opsRef.current = []
    let alive = true

    const apply = (stored: T | undefined) => {
      const ops = opsRef.current
      opsRef.current = []
      const local = pendingRef.current
      let next: T
      if (stored === undefined) {
        next = local
        if (ops.length > 0) savePersisted(keyRef.current, next)
      } else if (ops.length === 0) {
        next = stored
      } else {
        let acc = stored as T
        for (const op of ops) acc = op(acc)
        next = acc
        savePersisted(keyRef.current, next)
      }
      pendingRef.current = next
      setValue(next)
      hydratedRef.current = true
      setHydrated(true)
    }

    void loadPersisted<T>(key).then((stored) => {
      if (alive) apply(stored)
    })

    /* Другая вкладка изменила этот документ — перечитываем его. */
    const off = subscribeDocChange(key, () => {
      void loadPersisted<T>(key).then((stored) => {
        if (!alive || stored === undefined) return
        pendingRef.current = stored
        setValue(stored)
      })
    })

    return () => {
      alive = false
      off()
    }
  }, [key])

  const set = useCallback((next: T | ((prev: T) => T)) => {
    if (!hydratedRef.current) {
      opsRef.current.push(
        typeof next === 'function'
          ? (next as (p: T) => T)
          : (prev: T) => mergeRef.current(prev, next),
      )
    }
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      pendingRef.current = resolved
      if (hydratedRef.current) savePersisted(keyRef.current, resolved)
      return resolved
    })
  }, [])

  return [value, set, hydrated]
}
