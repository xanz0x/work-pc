'use client'

/* ============================================================
   СТОР · МУТАЦИИ (LG-5)
   Тонкая обёртка над `createExclusiveRunner`: сторож живёт вне React
   (dedup обязан быть синхронным — второй клик приходит раньше рендера),
   а компоненты подписываются на список «что сейчас идёт», чтобы гасить
   кнопку и показывать «Идёт…».
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createExclusiveRunner, type RunOptions, type RunResult } from '@/lib/exclusive'
import { useToast } from './toast'

export type MutationsCtx = {
  /** Ключи операций, которые идут прямо сейчас. */
  pending: readonly string[]
  isPending: (id: string) => boolean
  /**
   * Выполнить мутацию ровно один раз на ключ.
   * Повтор во время работы возвращает `{ ok: false, reason: 'busy' }`,
   * повтор внутри `dedupMs` после успеха — `'duplicate'`.
   */
  runExclusive: <T>(
    id: string,
    fn: () => T | Promise<T>,
    opts?: RunOptions & { errorMessage?: string },
  ) => Promise<RunResult<T>>
}

const Ctx = createContext<MutationsCtx | null>(null)

export function MutationsProvider({ children }: { children: ReactNode }) {
  const { flash } = useToast()
  const runner = useRef(createExclusiveRunner()).current

  const pending = useSyncExternalStore(
    runner.subscribe,
    runner.getSnapshot,
    runner.getSnapshot,
  )

  const runExclusive = useCallback<MutationsCtx['runExclusive']>(
    async (id, fn, opts) => {
      const res = await runner.run(id, fn, opts)
      /* Молчаливая ошибка мутации — худшее, что может быть: человек уверен,
         что действие прошло. Тост говорит правду, откат уже сделан. */
      if (!res.ok && res.reason === 'error' && opts?.errorMessage) flash(opts.errorMessage)
      return res
    },
    [flash, runner],
  )

  const value = useMemo<MutationsCtx>(
    () => ({ pending, isPending: (id) => pending.includes(id), runExclusive }),
    [pending, runExclusive],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMutations(): MutationsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMutations вызван вне MutationsProvider')
  return v
}
