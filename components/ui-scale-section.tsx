'use client'

/* Раздел «Интерфейс»: масштаб каркаса 80–150%. Применяется сразу, без
   черновика настроек — человек видит результат под пальцем и решает по нему. */

import { useSyncExternalStore } from 'react'
import {
  SCALE_DEFAULT,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  getScale,
  resetScale,
  setScale,
  stepScale,
  subscribeScale,
} from '@/lib/ui-scale'
import { IconMinus, IconPlus, IconScale } from './icons'

const PRESETS = [80, 100, 125, 150]

export function UiScaleSection() {
  const scale = useSyncExternalStore(subscribeScale, getScale, () => SCALE_DEFAULT)

  return (
    <section className="sec panel" id="set-ui" data-testid="settings-ui-section">
      <div className="sec-head">
        <span className="sec-icon">
          <IconScale />
        </span>
        <div className="sec-head-text">
          <h2 className="setting-title" data-testid="settings-ui-title">Интерфейс</h2>
          <div className="setting-note" data-testid="settings-ui-description">
            Масштаб текста и элементов. Применяется сразу на этом устройстве.
          </div>
        </div>
        <span className="sec-meta label-mono num" data-testid="ui-scale-value">
          {scale}%
        </span>
      </div>

      <div className="uis-row">
        <button
          className="icon-btn uis-step"
          onClick={() => stepScale(-1)}
          disabled={scale <= SCALE_MIN}
          aria-label="Уменьшить масштаб"
          data-testid="ui-scale-minus"
        >
          <IconMinus />
        </button>

        <input
          className="uis-slider"
          type="range"
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={SCALE_STEP}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          aria-label="Масштаб интерфейса"
          data-testid="ui-scale-slider"
        />

        <button
          className="icon-btn uis-step"
          onClick={() => stepScale(1)}
          disabled={scale >= SCALE_MAX}
          aria-label="Увеличить масштаб"
          data-testid="ui-scale-plus"
        >
          <IconPlus />
        </button>
      </div>

      <div className="uis-presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            className={`f-chip num${scale === p ? ' on' : ''}`}
            aria-pressed={scale === p}
            onClick={() => setScale(p)}
            data-testid={`ui-scale-preset-${p}`}
          >
            {p}%
          </button>
        ))}
        <button
          className="btn btn-ghost btn-sm uis-reset"
          onClick={resetScale}
          disabled={scale === SCALE_DEFAULT}
          data-testid="ui-scale-reset"
        >
          Сбросить
        </button>
      </div>

      <div className="sec-note" data-testid="settings-ui-shortcuts">
        Горячие клавиши: <b className="mono">Ctrl +</b> и <b className="mono">Ctrl −</b> меняют
        масштаб шагом {SCALE_STEP}%, <b className="mono">Ctrl 0</b> возвращает 100%.
      </div>
    </section>
  )
}
