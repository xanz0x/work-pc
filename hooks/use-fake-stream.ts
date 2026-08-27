'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Answer, TraceStage } from '@/components/chat/types'

type Phase = 'idle' | 'trace' | 'stream'

type Done = (result: {
  answer: Answer
  text: string
  stopped: boolean
  ms: number
  stages: TraceStage[]
}) => void

/**
 * Имитация локальной генерации: сначала стадии поиска, потом текст словами.
 * Один самопланирующийся таймер вместо гонки интервалов — поэтому поток можно
 * честно остановить, а при скрытой вкладке он замирает, а не «догоняет».
 * Пользователь с prefers-reduced-motion получает готовый ответ сразу.
 */
export function useFakeStream(onDone: Done) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [stagesShown, setStagesShown] = useState(0)
  const [text, setText] = useState('')

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answer = useRef<Answer | null>(null)
  const stages = useRef<TraceStage[]>([])
  const words = useRef<string[]>([])
  /** Зеркало текста: остановка читает его синхронно, без setState-трюков. */
  const textRef = useRef('')
  const si = useRef(0)
  const wi = useRef(0)
  const startedAt = useRef(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const reset = useCallback(() => {
    clear()
    answer.current = null
    stages.current = []
    words.current = []
    textRef.current = ''
    si.current = 0
    wi.current = 0
    setPhase('idle')
    setStagesShown(0)
    setText('')
  }, [clear])

  useEffect(() => reset, [reset])

  const finish = useCallback(
    (stopped: boolean) => {
      const a = answer.current
      if (!a) return
      const ms = Math.max(1, Math.round(performance.now() - startedAt.current))
      const out = stopped ? textRef.current : a.text
      const st = stages.current
      reset()
      doneRef.current({ answer: a, text: out, stopped, ms, stages: st })
    },
    [reset],
  )

  /** Один шаг машины: стадия поиска, слово ответа или финал. */
  const step = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) {
      timer.current = setTimeout(step, 300)
      return
    }
    if (si.current < stages.current.length) {
      si.current += 1
      setStagesShown(si.current)
      timer.current = setTimeout(step, 250 + Math.random() * 150)
      return
    }
    if (wi.current === 0) setPhase('stream')
    if (wi.current < words.current.length) {
      textRef.current += words.current[wi.current]
      wi.current += 1
      setText(textRef.current)
      timer.current = setTimeout(step, 18 + Math.random() * 22)
      return
    }
    finish(false)
  }, [finish])

  const start = useCallback(
    (next: Answer, nextStages: TraceStage[]) => {
      clear()
      answer.current = next
      stages.current = nextStages
      words.current = next.text.match(/\S+\s*/g) ?? [next.text]
      si.current = 0
      wi.current = 0
      textRef.current = ''
      startedAt.current = performance.now()
      setStagesShown(0)
      setText('')

      const calm =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (calm) {
        setPhase('stream')
        si.current = nextStages.length
        setStagesShown(nextStages.length)
        wi.current = words.current.length
        textRef.current = next.text
        setText(next.text)
        timer.current = setTimeout(() => finish(false), 120)
        return
      }

      setPhase('trace')
      timer.current = setTimeout(step, 120)
    },
    [clear, finish, step],
  )

  /** Остановить генерацию: то, что уже написано, остаётся в переписке. */
  const stop = useCallback(() => {
    if (!answer.current) return
    clear()
    finish(true)
  }, [clear, finish])

  return { phase, stagesShown, text, active: phase !== 'idle', start, stop }
}
