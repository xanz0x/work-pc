/* ============================================================
   ОКНО КОНТЕКСТА ДИАЛОГА (LG-1)
   Раньше в модель уезжала вся история: диалог на 200 ходов рос
   линейно в цене и рано или поздно упирался в лимит провайдера.
   Теперь наружу идут последние N ходов, а вытесненное сворачивается
   в одно системное резюме. Модуль без зависимостей от fs и React:
   его используют и серверный маршрут, и тесты.
   ============================================================ */

export type CtxMsg = {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

/** Сколько ходов пользователя уходит в модель целиком. */
export const MAX_TURNS = 12
/** Символьный бюджет переписки (грубо ≈ 4 символа на токен). */
export const CTX_BUDGET_CHARS = 24_000
/** Лимит на один ход пользователя. */
export const MAX_USER_CHARS = 4_000
/** Лимит на результат одного скилла. */
export const MAX_TOOL_CHARS = 4_000
/** Длина резюме вытесненной части. */
export const MAX_SUMMARY_CHARS = 800

function len(m: CtxMsg): number {
  let n = m.content?.length ?? 0
  for (const c of m.tool_calls ?? []) n += c.function.arguments.length + c.function.name.length
  return n
}

export function chars(msgs: CtxMsg[]): number {
  return msgs.reduce((n, m) => n + len(m), 0)
}

/** Резюме вытесненного: только реплики пользователя, обрезанные по одной фразе. */
export function summarize(dropped: CtxMsg[]): string | null {
  const asks = dropped
    .filter((m) => m.role === 'user' && m.content)
    .map((m) => (m.content as string).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (asks.length === 0) return null
  let out = 'Ранее в этом диалоге обсуждали: '
  const parts: string[] = []
  for (const a of asks) {
    const piece = a.length > 120 ? `${a.slice(0, 117)}…` : a
    if (out.length + parts.join('; ').length + piece.length > MAX_SUMMARY_CHARS) break
    parts.push(piece)
  }
  if (parts.length === 0) return null
  const tail = asks.length > parts.length ? ` (и ещё ${asks.length - parts.length} вопросов)` : ''
  return `${out}${parts.join('; ')}${tail}.`
}

export type TrimResult = {
  /** Что уходит в модель (без системного сообщения). */
  msgs: CtxMsg[]
  /** Резюме вытесненного или null. */
  summary: string | null
  /** Сколько сообщений выброшено. */
  dropped: number
  used: number
  limit: number
}

/**
 * Обрезает историю до последних `maxTurns` ходов пользователя и символьного
 * бюджета. Инвариант: результат не начинается с `tool` — иначе провайдер
 * получает результат скилла без вызова и отвечает 400.
 */
export function trimLlm(
  all: CtxMsg[],
  opts: { maxTurns?: number; budget?: number } = {},
): TrimResult {
  const maxTurns = opts.maxTurns ?? MAX_TURNS
  const budget = opts.budget ?? CTX_BUDGET_CHARS

  let start = 0
  let turns = 0
  let acc = 0
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const m = all[i]
    if (m.role === 'user') turns += 1
    acc += len(m)
    if ((turns > maxTurns || acc > budget) && i < all.length - 1) {
      start = i + 1
      break
    }
  }

  // Не начинаем с результата скилла: сдвигаем границу вперёд.
  while (start < all.length && all[start].role === 'tool') start += 1

  const kept = all.slice(start)
  const dropped = all.slice(0, start)
  return {
    msgs: kept,
    summary: summarize(dropped),
    dropped: dropped.length,
    used: chars(kept),
    limit: budget,
  }
}

/** Заполнение окна в процентах — для честного индикатора в интерфейсе. */
export function fillPercent(used: number, limit = CTX_BUDGET_CHARS): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}
