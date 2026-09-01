'use client'

/* ============================================================
   ПАНЕЛЬ ЛОКАЛЬНОГО ДВИЖКА (NF-2)
   Одна честная плашка на два места — настройки и чат. Пишет ровно то,
   что известно: адрес движка, тег модели, что установлено на устройстве.
   Если движка нет — показывает команды, которые нужно выполнить, и не
   притворяется, будто модель «загружается».
   ============================================================ */

import { useState } from 'react'
import { useEngineStore } from '@/lib/store/engine'

export function EnginePanel({ compact = false }: { compact?: boolean }) {
  const { local, checking, error, recheck, metrics } = useEngineStore()
  const [copied, setCopied] = useState(false)

  /* Контракт data-атрибутов: четыре состояния интерфейса, а код ошибки —
     отдельно. Так селекторы тестов и стили не зависят от каталога кодов. */
  const state: 'checking' | 'ok' | 'off' | 'error' = checking
    ? 'checking'
    : error
      ? 'error'
      : local?.ok
        ? 'ok'
        : 'off'
  const code = local?.code ?? null

  const badge = state === 'ok' ? 'badge-ok' : state === 'checking' ? '' : 'badge-warn'

  const title =
    state === 'checking'
      ? 'Проверяем движок…'
      : state === 'error'
        ? 'Статус движка недоступен'
        : state === 'ok'
          ? `Движок отвечает · ${local?.model ?? ''}`
          : code === 'MODEL_NOT_PULLED'
            ? 'Движок запущен, модели нет'
            : 'Локальный движок не запущен'

  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setCopied(false))
  }

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
          <p>{local?.hint}</p>
          {!compact && (
            <ul>
              <li>
                Скачайте Ollama с ollama.com и запустите её — движок слушает{' '}
                <span className="mono">{local?.base ?? 'localhost:11434'}</span>.
              </li>
              <li>
                Модель для этого профиля: <span className="mono">{local?.model}</span>.
              </li>
            </ul>
          )}
          {local?.pull && (
            <div className="engine-panel-cmd">
              <code className="mono" data-testid="engine-pull-cmd">
                {local.pull}
              </code>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => copy(local.pull!)}
                data-testid="engine-copy-pull"
              >
                {copied ? 'Скопировано' : 'Скопировать команду'}
              </button>
            </div>
          )}
        </div>
      )}

      {state === 'ok' && !compact && (
        <p>
          Установлено моделей на устройстве: <b className="num">{local?.models.length ?? 0}</b>. Ни
          один запрос в локальном режиме не уходит в сеть: движок отвечает по адресу{' '}
          <span className="mono">{local?.base}</span>.
        </p>
      )}
    </div>
  )
}
