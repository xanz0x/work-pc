'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPersisted, savePersisted } from '@/lib/db/persist'
import { mergeById, reconcile, type MergeFn } from '@/lib/db/merge'
import { subscribeDocChange } from '@/lib/db/sync'

/**
 * Состояние, которое живёт между перезагрузками. Первый рендер всегда отдаёт
 * значение по умолчанию — иначе разъедется гидратация; хранилище читается в
 * эффекте (IndexedDB асинхронный, мелочь — синхронно из localStorage).
 * Третий элемент кортежа — признак «данные прочитаны».
 *
 * §1.2: запись до окончания гидратации больше не отбрасывает прочитанное.
 * До `hydrated` записи в хранилище не уходят (складываются в памяти), а когда
 * чтение пришло — сливаются с ним (`merge`, по умолчанию по `id`).
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
  /** Пользователь успел записать раньше, чем пришло прочитанное. */
  const dirtyRef = useRef(false)
  /** До гидратации записи не уходят в хранилище: иначе затрут архив. */
  const hydratedRef = useRef(false)
  const pendingRef = useRef<T>(initial)
  /* Правило слияния берётся при монтировании: оно про ключ, а не про рендер. */
  const mergeRef = useRef(merge)

  useEffect(() => {
    keyRef.current = key
    dirtyRef.current = false
    hydratedRef.current = false
    let alive = true

    const apply = (stored: T | undefined) => {
      setValue((local) => {
        const r = reconcile(stored, local, dirtyRef.current, mergeRef.current)
        if (r.write) savePersisted(keyRef.current, r.value)
        pendingRef.current = r.value
        return r.value
      })
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
    dirtyRef.current = true
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      pendingRef.current = resolved
      if (hydratedRef.current) savePersisted(keyRef.current, resolved)
      return resolved
    })
  }, [])

  return [value, set, hydrated]
}
