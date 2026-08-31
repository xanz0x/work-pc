'use client'

/* ============================================================
   СТОР · ЧАСЫ (AR-1, шаг 1)
   Секундный тик жил в общем сейфе, и раз в секунду перерисовывалось
   всё дерево. Теперь часы — отдельный провайдер: их подписывают
   только те, кто показывает время (тающие стикеры, «5 мин назад»).
   ============================================================ */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

/** 0 до первого клиентского тика — совпадает с SSR. */
const NowCtx = createContext<number>(0)

export function ClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <NowCtx.Provider value={now}>{children}</NowCtx.Provider>
}

/** Общие часы приложения. */
export function useNow(): number {
  return useContext(NowCtx)
}

/**
 * Грубый тик для тех, кому не нужна секунда: состав живых стикеров,
 * например, спокойно обновляется раз в пять секунд, зато сейф не
 * пересобирает производные шестьдесят раз в минуту.
 */
export function useCoarseTick(ms = 5000): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return tick
}
