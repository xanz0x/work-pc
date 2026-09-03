/* ============================================================
   LG-5 · ИДЕМПОТЕНТНОСТЬ МУТАЦИЙ
   Двойной клик по «Добавить файл», «Переиндексировать» или «Импортировать»
   раньше запускал операцию дважды: React успевает отдать второй клик до
   того, как состояние кнопки доедет до DOM. Здесь — один сторож на всё
   приложение, без React, поэтому его можно проверить тестом:

   — dedup по ключу операции: пока ключ в работе, повтор не выполняется;
   — «уже сделано»: ключ с `dedupMs` помнит успешный запуск и не повторяет
     его (скилл модели, который может прийти дважды за один ход);
   — откат при ошибке: `rollback` зовётся до того, как ошибка вернётся
     вызывающему, и сам сторож всегда освобождает ключ.

   Результат — объект, а не исключение: вызывающему важно РАЗЛИЧАТЬ
   «не сделали, потому что уже идёт» и «сделали, но упало».
   ============================================================ */

export type RunReason = 'busy' | 'duplicate' | 'error'

export type RunResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: RunReason; error?: unknown }

export type RunOptions = {
  /** Вернуть мир в исходное состояние, если операция упала. */
  rollback?: () => void | Promise<void>
  /** Сколько помнить успешный запуск этого ключа и отвергать повтор. */
  dedupMs?: number
}

export type ExclusiveRunner = {
  run: <T>(id: string, fn: () => T | Promise<T>, opts?: RunOptions) => Promise<RunResult<T>>
  isPending: (id: string) => boolean
  /** Список ключей в работе. Ссылка меняется только при смене состава. */
  getSnapshot: () => readonly string[]
  subscribe: (fn: () => void) => () => void
  /** Забыть память об успешных запусках (тесты и «сброс профиля»). */
  reset: () => void
}

const EMPTY: readonly string[] = []

export function createExclusiveRunner(now: () => number = Date.now): ExclusiveRunner {
  const inflight = new Set<string>()
  /** Ключ → момент успешного завершения (для dedupMs). */
  const finished = new Map<string, number>()
  const listeners = new Set<() => void>()
  let snapshot: readonly string[] = EMPTY

  function publish() {
    snapshot = inflight.size === 0 ? EMPTY : Array.from(inflight)
    for (const fn of listeners) fn()
  }

  async function run<T>(
    id: string,
    fn: () => T | Promise<T>,
    opts: RunOptions = {},
  ): Promise<RunResult<T>> {
    if (inflight.has(id)) return { ok: false, reason: 'busy' }
    if (opts.dedupMs) {
      const at = finished.get(id)
      if (at !== undefined && now() - at < opts.dedupMs) return { ok: false, reason: 'duplicate' }
    }

    inflight.add(id)
    publish()
    try {
      const value = await fn()
      if (opts.dedupMs) finished.set(id, now())
      return { ok: true, value }
    } catch (error) {
      try {
        await opts.rollback?.()
      } catch {
        /* Откат не должен подменять исходную ошибку. */
      }
      return { ok: false, reason: 'error', error }
    } finally {
      inflight.delete(id)
      publish()
    }
  }

  return {
    run,
    isPending: (id) => inflight.has(id),
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    reset: () => {
      finished.clear()
      inflight.clear()
      publish()
    },
  }
}
