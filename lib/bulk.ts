'use client'

/* ============================================================
   NF-5 · МАССОВЫЕ ОПЕРАЦИИ
   Пятьсот объектов нельзя обработать одним синхронным проходом:
   пока цикл идёт, браузер не рисует кадры и интерфейс «залипает».
   Поэтому операция режется на порции, между порциями поток
   отдаётся интерфейсу (requestIdleCallback → rAF → таймер), а
   прогресс и отмена читаются из настоящего счётчика, а не из
   таймера-имитатора.

   Отмена прерывает выполнение на границе порции: уже применённые
   объекты остаются применёнными, и на них распространяется окно
   отмены — тост «Вернуть» живёт 10 секунд.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Размер порции по умолчанию: 25 объектов — примерно один кадр работы. */
export const BULK_CHUNK = 25
/** Сколько живёт окно отмены после завершения операции. */
export const BULK_UNDO_MS = 10_000

export type BulkState = {
  running: boolean
  /** Что именно идёт — показывается в панели. */
  label: string
  done: number
  total: number
  /** Операцию прервали кнопкой «Отмена». */
  cancelled: boolean
}

export const EMPTY_BULK: BulkState = {
  running: false,
  label: '',
  done: 0,
  total: 0,
  cancelled: false,
}

export type BulkUndo = { label: string; until: number; run: () => void } | null

export type BulkTask = {
  /** Человеческая подпись: «Метка “срочно” · 500 объектов». */
  label: string
  ids: string[]
  chunk?: number
  /** Применить порцию. Может быть асинхронным (крипто-операции). */
  step: (batch: string[]) => void | Promise<void>
  /** Что предложить в окне отмены. Без него окна не будет. */
  undo?: { label: string; run: () => void }
  onDone?: (applied: number, cancelled: boolean) => void
}

export function chunkIds(ids: readonly string[], size = BULK_CHUNK): string[][] {
  const step = Math.max(1, Math.floor(size))
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += step) out.push(ids.slice(i, i + step) as string[])
  return out
}

type IdleWindow = {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

/** Отдать поток интерфейсу: кадр успевает нарисоваться между порциями. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      setTimeout(resolve, 0)
      return
    }
    const idle = (window as unknown as IdleWindow).requestIdleCallback
    if (typeof idle === 'function') idle(() => resolve(), { timeout: 48 })
    else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

/**
 * Чистое ядро: прогоняет порции, спрашивая перед каждой, не отменили ли.
 * Возвращает, сколько объектов успело примениться и была ли отмена.
 */
export async function runChunked(
  ids: readonly string[],
  step: (batch: string[]) => void | Promise<void>,
  opts: {
    chunk?: number
    shouldCancel?: () => boolean
    onProgress?: (done: number, total: number) => void
    yieldFn?: () => Promise<void>
  } = {},
): Promise<{ applied: number; cancelled: boolean }> {
  const batches = chunkIds(ids, opts.chunk ?? BULK_CHUNK)
  const total = ids.length
  const wait = opts.yieldFn ?? yieldToUi
  let applied = 0
  for (const batch of batches) {
    if (opts.shouldCancel?.()) return { applied, cancelled: true }
    await step(batch)
    applied += batch.length
    opts.onProgress?.(applied, total)
    await wait()
  }
  return { applied, cancelled: false }
}

/**
 * Состояние одной массовой операции на экран: прогресс, отмена и окно
 * возврата. Второй запуск, пока первый идёт, игнорируется — так двойной
 * клик по действию не превращается в две операции.
 */
export function useBulkRunner() {
  const [state, setState] = useState<BulkState>(EMPTY_BULK)
  const [undo, setUndo] = useState<BulkUndo>(null)
  const cancelRef = useRef(false)
  const runningRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const dismissUndo = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setUndo(null)
  }, [])

  const start = useCallback(
    async (task: BulkTask) => {
      if (runningRef.current || task.ids.length === 0) return
      runningRef.current = true
      cancelRef.current = false
      dismissUndo()
      setState({ running: true, label: task.label, done: 0, total: task.ids.length, cancelled: false })

      const res = await runChunked(task.ids, task.step, {
        chunk: task.chunk,
        shouldCancel: () => cancelRef.current,
        onProgress: (done, total) =>
          setState((s) => (s.running ? { ...s, done, total } : s)),
      })

      runningRef.current = false
      setState({
        running: false,
        label: task.label,
        done: res.applied,
        total: task.ids.length,
        cancelled: res.cancelled,
      })

      if (task.undo && res.applied > 0) {
        const undoTask = task.undo
        setUndo({ label: undoTask.label, until: Date.now() + BULK_UNDO_MS, run: undoTask.run })
        timerRef.current = setTimeout(() => setUndo(null), BULK_UNDO_MS)
      }
      task.onDone?.(res.applied, res.cancelled)
    },
    [dismissUndo],
  )

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  const runUndo = useCallback(() => {
    setUndo((cur) => {
      cur?.run()
      return null
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  return { state, undo, start, cancel, runUndo, dismissUndo }
}

export type BulkRunner = ReturnType<typeof useBulkRunner>
