'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Состояние, которое живёт между перезагрузками. Первый рендер всегда отдаёт
 * значение по умолчанию — иначе разъедется гидратация; localStorage читается
 * в эффекте. В приватном режиме хук просто работает как useState.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)
  const keyRef = useRef(key)

  useEffect(() => {
    keyRef.current = key
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      /* приватный режим или битый JSON — остаёмся на значении по умолчанию */
    }
    setHydrated(true)
  }, [key])

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      try {
        localStorage.setItem(keyRef.current, JSON.stringify(resolved))
      } catch {
        /* игнорируем: интерфейс продолжает работать без сохранения */
      }
      return resolved
    })
  }, [])

  return [value, set, hydrated]
}
