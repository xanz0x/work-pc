'use client'

/* ============================================================
   ПАНЕЛЬ ПОДКЛЮЧЕНИЯ МОДЕЛИ
   Одна честная плашка на два места — настройки и чат. Пишет ровно
   то, что известно серверу: способ подключения, адрес API и имя
   модели. Модель не подключена — говорит это прямо и ведёт в
   раздел настроек, а не притворяется, что что-то «загружается».
   ============================================================ */

import { useEngineStore } from '@/lib/store/engine'

export function EnginePanel({ compact = false }: { compact?: boolean }) {
  const { provider, checking, error, recheck, metrics } = useEngineStore()

  const state: 'checking' | 'ok' | 'off' | 'error' = checking
    ? 'checking'
    : error
      ? 'error'
      : provider?.ok
        ? 'ok'
        : 'off'
  const code = provider?.code ?? null
  const badge = state === 'ok' ? 'badge-ok' : state === 'checking' ? '' : 'badge-warn'

  const title =
    state === 'checking'
      ? 'Проверяем подключение…'
      : state === 'error'
        ? 'Статус модели недоступен'
        : state === 'ok'
          ? `${provider?.kindLabel ?? 'модель'} · ${provider?.model ?? ''}`
          : 'Модель не подключена'

  return (
    <div
      className={`engine-panel${compact ? ' engine-panel-compact' : ''}`}
      data-state={state}
      data-code={code ?? undefined}
      data-testid="engine-panel"
    >
      <div className="engine-panel-head">
        <span
          className={`badge ${badge}`}
          data-testid="engine-status"
          data-state={state}
          data-code={code ?? undefined}
        >
          <i className={`net-dot${state === 'ok' ? '' : ' warn'}`} />
          {title}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={recheck}
          disabled={checking}
          data-testid="engine-recheck"
        >
          {checking ? 'Проверяем…' : 'Проверить снова'}
        </button>
        {state === 'ok' && metrics.tokensPerSec !== null && (
          <span className="label-mono num" data-testid="engine-speed">
            {metrics.tokensPerSec} токенов/с в последнем ответе
          </span>
        )}
      </div>

      {state === 'error' && <p>{error}</p>}

      {state === 'off' && (
        <div data-testid="engine-howto">
          <p data-testid="engine-setup-hint">
            {provider?.hint ?? 'Откройте «Настройки → Подключение модели» и подключите свой сервер или OpenRouter.'}
          </p>
        </div>
      )}

      {state === 'ok' && !compact && (
        <p data-testid="engine-location-info">
          Запросы уходят на <span className="mono">{provider?.base}</span>. Картинки читает{' '}
          <span className="mono">{provider?.visionModel || provider?.model}</span>.
        </p>
      )}
    </div>
  )
}
