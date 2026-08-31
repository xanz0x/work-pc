'use client'

import { useState } from 'react'
import { IconChevronDown } from '../icons'
import type { TraceStage } from './types'

/** Красакт-строка вместо источника под файловым ключом (п.10.3). */
const REDACTED_LABEL = 'Источник под ключом — откройте файл'

/**
 * Трассировка поиска. Пока модель работает — видно, что именно она делает:
 * стадии появляются по одной, у активной строки бежит линия 2px.
 * Когда ответ готов, трассировка сворачивается в одну строку-сводку —
 * доказательство остаётся доступным, но не занимает место.
 *
 * Источники, лежащие под файловым ключом, в трассировку не попадают:
 * вместо них рисуется красакт-строка тоном (этап 6, п.10.3).
 */
export function RetrievalTrace({
  stages,
  shown,
  running,
  lockedSources = 0,
}: {
  stages: TraceStage[]
  /** Сколько стадий уже показано (во время генерации). */
  shown?: number
  running?: boolean
  /** Сколько источников закрыто файловым ключом — их цитаты не приходят. */
  lockedSources?: number
}) {
  if (running) {
    const visible = stages.slice(0, shown ?? stages.length)
    return (
      <ol className="trace" aria-label="Ход поиска">
        {visible.map((s, i) => {
          const last = i === visible.length - 1
          return (
            <li key={s.label} className={`trace-row${last ? ' is-live' : ''}`}>
              <span className="trace-mark" aria-hidden="true" />
              <span className="trace-label">{s.label}</span>
              {last ? <span className="trace-line" aria-hidden="true" /> : null}
            </li>
          )
        })}
        {Array.from({ length: lockedSources }, (_, i) => (
          <li key={`redacted-${i}`} className="trace-row trace-redacted">
            <span className="trace-mark" aria-hidden="true" />
            <span className="trace-label">{REDACTED_LABEL}</span>
          </li>
        ))}
      </ol>
    )
  }
  return null
}

/** Свёрнутая сводка под готовым ответом. */
export function TraceSummary({
  stages,
  scanned,
  picked,
  cited,
  ms,
  lockedSources = 0,
}: {
  stages: TraceStage[]
  scanned: number
  picked: number
  cited: number
  ms: number
  /** Источники под ключом показываются красакт-строкой при раскрытии. */
  lockedSources?: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tsum">
      <button
        type="button"
        className={`tsum-btn${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown aria-hidden="true" />
        <span className="num">{scanned}</span> файлов · отобрано{' '}
        <span className="num">{picked}</span> · цитат <span className="num">{cited}</span> ·{' '}
        <span className="num">{ms}</span> мс
        {lockedSources > 0 ? (
          <>
            {' '}
            · под ключом <span className="num">{lockedSources}</span>
          </>
        ) : null}
      </button>
      {open ? (
        <ol className="tsum-list">
          {stages.map((s) => (
            <li key={s.label}>
              <span className="trace-mark" aria-hidden="true" />
              {s.label}
            </li>
          ))}
          {lockedSources > 0 &&
            Array.from({ length: lockedSources }, (_, i) => (
              <li key={`redacted-${i}`} className="trace-redacted">
                <span className="trace-mark" aria-hidden="true" />
                {REDACTED_LABEL}
              </li>
            ))}
        </ol>
      ) : null}
    </div>
  )
}
