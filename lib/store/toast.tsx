'use client'

/* ============================================================
   СТОР · КОРОТКИЕ СООБЩЕНИЯ (AR-1)
   Тост — самостоятельный домен: он меняется чаще всего и не имеет
   права тащить за собой перерисовку экранов, которым он не нужен.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastCtx = {
  toast: string | null
  flash: (msg: string) => void
}

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const value = useMemo(() => ({ toast, flash }), [flash, toast])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast вызван вне ToastProvider')
  return v
}
