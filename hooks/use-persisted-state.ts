'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPersisted, savePersisted } from '@/lib/db/persist'

/**
 * Состояние, которое живёт между перезагрузками. Первый рендер всегда отдаёт
 * значение по умолчанию — иначе разъедется гидратация; хранилище читается в
 * эффекте (IndexedDB асинхронный, мелочь — синхронно из localStorage).
 * Третий элемент кортежа — признак «данные прочитаны».
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)
  const keyRef = useRef(key)
  /** Пользователь успел записать раньше, чем пришло прочитанное — его значение важнее. */
  const dirtyRef = useRef(false)

  useEffect(() => {
    keyRef.current = key
    dirtyRef.current = false
    let alive = true
    void loadPersisted<T>(key).then((stored) => {
      if (!alive) return
      if (stored !== undefined && !dirtyRef.current) setValue(stored)
      setHydrated(true)
    })
    return () => {
      alive = false
    }
  }, [key])

  const set = useCallback((next: T | ((prev: T) => T)) => {
    dirtyRef.current = true
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      savePersisted(keyRef.current, resolved)
      return resolved
    })
  }, [])

  return [value, set, hydrated]
}
