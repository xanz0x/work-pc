/* ============================================================
   МЕТРИКИ (AR-5, шаг 4)
   Четыре числа: ходы, ошибки, латентность, расход токенов. Живут в
   памяти процесса — базы у продукта нет, а цифры нужны честные:
   токены пишутся только если провайдер их прислал (иначе null).
   Здесь же локальный трекинг ошибок: последние записи без PII.
   ============================================================ */

import { log } from './log'

const MAX_ERRORS = 50

type ErrorRec = {
  at: number
  rid: string
  where: string
  code: string
  /** Машинная причина: сообщение ошибки, обрезанное; без имён файлов и текста запроса. */
  reason: string
}

const state = {
  turns: 0,
  errors: 0,
  latency: [] as number[],
  tokensIn: 0,
  tokensOut: 0,
  /** Сколько ходов пришло с реальным usage от провайдера. */
  tokenSamples: 0,
  recent: [] as ErrorRec[],
  since: Date.now(),
}

export function countTurn(): void {
  state.turns += 1
}

export function countLatency(ms: number): void {
  state.latency.push(ms)
  if (state.latency.length > 500) state.latency.shift()
}

export function countTokens(inTok: number | null, outTok: number | null): void {
  if (inTok === null && outTok === null) return
  state.tokensIn += inTok ?? 0
  state.tokensOut += outTok ?? 0
  state.tokenSamples += 1
}

export function trackError(rec: Omit<ErrorRec, 'at'>): void {
  state.errors += 1
  state.recent.unshift({ ...rec, at: Date.now(), reason: rec.reason.slice(0, 200) })
  if (state.recent.length > MAX_ERRORS) state.recent.pop()
  log('error', 'tracked', { rid: rec.rid, where: rec.where, code: rec.code, reason: rec.reason })
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i]
}

export function metricsSnapshot() {
  const sorted = [...state.latency].sort((a, b) => a - b)
  return {
    since: state.since,
    turns: state.turns,
    errors: state.errors,
    latency: {
      samples: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    },
    tokens:
      state.tokenSamples > 0
        ? { input: state.tokensIn, output: state.tokensOut, samples: state.tokenSamples }
        : null,
    recentErrors: state.recent,
  }
}

/** Только для тестов. */
export function resetMetrics(): void {
  state.turns = 0
  state.errors = 0
  state.latency = []
  state.tokensIn = 0
  state.tokensOut = 0
  state.tokenSamples = 0
  state.recent = []
  state.since = Date.now()
}
