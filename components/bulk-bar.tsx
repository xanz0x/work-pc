'use client'

/* ============================================================
   NF-5 · ПАНЕЛЬ МАССОВЫХ ДЕЙСТВИЙ
   Одна панель на два экрана: библиотека (файлы и стикеры) и
   менеджер секретов (записи). Панель не знает, что именно делают
   действия — она показывает, сколько выбрано, даёт кнопки, честный
   прогресс с отменой и окно возврата на 10 секунд.
   ============================================================ */

import { useEffect, useState, type ReactNode } from 'react'
import { BULK_UNDO_MS, type BulkRunner } from '@/lib/bulk'
import { IconCheck, IconClose, IconRefresh } from './icons'

export type BulkAction = {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  onRun: () => void
}

export function BulkBar({
  count,
  totalInFilter,
  noun,
  actions,
  form,
  runner,
  onSelectAll,
  onClear,
  testid,
}: {
  count: number
  /** Сколько объектов сейчас в фильтре — для «выбрать всё в фильтре». */
  totalInFilter: number
  noun: string
  actions: BulkAction[]
  /** Подстрока действия: ввод метки, выбор кластера или папки. */
  form?: ReactNode
  runner: BulkRunner
  onSelectAll: () => void
  onClear: () => void
  testid: string
}) {
  const { state, undo } = runner
  const busy = state.running
  const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0

  if (count === 0 && !busy && !undo) return null

  return (
    <div className="bulk-bar panel" role="group" aria-label="Массовые действия" data-testid={`${testid}-bar`}>
      <div className="bulk-row">
        <span className="bulk-count label-mono" data-testid={`${testid}-count`}>
          Выбрано <b className="num">{count}</b> из <b className="num">{totalInFilter}</b> · {noun}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onSelectAll}
          disabled={busy || count >= totalInFilter}
          data-testid={`${testid}-select-all`}
          title="Выбрать всё, что попало в текущий фильтр"
        >
          <IconCheck />
          Выбрать всё в фильтре
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onClear}
          disabled={busy || count === 0}
          data-testid={`${testid}-clear`}
        >
          <IconClose />
          Снять выделение
        </button>
      </div>

      <div className="bulk-actions">
        {actions.map((a) => (
          <button
            key={a.id}
            className={`btn btn-ghost btn-sm${a.danger ? ' btn-danger' : ''}`}
            onClick={a.onRun}
            disabled={busy || a.disabled || count === 0}
            title={a.hint}
            data-testid={`${testid}-action-${a.id}`}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>

      {form ? <div className="bulk-form">{form}</div> : null}

      {busy && (
        <div className="bulk-progress" role="status" aria-live="polite" data-testid={`${testid}-progress`}>
          <span className="bulk-progress-text mono num">
            {state.label} · {state.done} из {state.total}
          </span>
          <span className="bulk-track" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={runner.cancel}
            data-testid={`${testid}-cancel`}
          >
            <IconClose />
            Отмена
          </button>
        </div>
      )}

      {!busy && state.total > 0 && state.cancelled && (
        <span className="bulk-note mono" data-testid={`${testid}-cancelled`}>
          Операция прервана: применено {state.done} из {state.total}. Остальные объекты не тронуты.
        </span>
      )}

      {undo && <UndoRow runner={runner} testid={testid} />}
    </div>
  )
}

/** Окно возврата: 10 секунд обратного отсчёта и кнопка «Вернуть». */
function UndoRow({ runner, testid }: { runner: BulkRunner; testid: string }) {
  const undo = runner.undo
  const [left, setLeft] = useState(Math.ceil(BULK_UNDO_MS / 1000))

  useEffect(() => {
    if (!undo) return
    const tick = () => setLeft(Math.max(0, Math.ceil((undo.until - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [undo])

  if (!undo) return null

  return (
    <div className="bulk-undo" role="status" aria-live="polite" data-testid={`${testid}-undo`}>
      <span className="mono">{undo.label}</span>
      <span className="grow" />
      <span className="label-mono num">вернуть можно ещё {left} с</span>
      <button
        className="btn btn-ghost btn-sm"
        onClick={runner.runUndo}
        data-testid={`${testid}-undo-run`}
      >
        <IconRefresh />
        Вернуть
      </button>
    </div>
  )
}
