'use client'

/* ============================================================
   ОНБОРДИНГ · ШАГ «ПОДКЛЮЧЕНИЕ МОДЕЛИ»
   Ничего скачивать не нужно: человек либо вставляет ключ
   OpenRouter и выбирает модель из живого списка, либо указывает
   адрес своего OpenAI-совместимого сервера. Можно отложить —
   тогда чат и разбор файлов честно скажут, что модель не
   подключена, вместо выдуманных ответов.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconCheck, IconRefresh, IconSearch } from './icons'

type Kind = 'custom' | 'openrouter'
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

type ProviderModel = { id: string; name: string; vision: boolean; free: boolean }

export function OnboardingModelStep({
  connected,
  onConnected,
}: {
  connected: boolean
  onConnected: (model: string) => void
}) {
  const [kind, setKind] = useState<Kind>('openrouter')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<ProviderModel[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/ai-api/ai/provider', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ ready?: boolean; model?: string; kind?: Kind; baseUrl?: string }>) : null))
      .then((v) => {
        if (!v) return
        if (v.kind) setKind(v.kind)
        if (v.baseUrl && v.kind === 'custom') setBaseUrl(v.baseUrl)
        if (v.model) setModel(v.model)
        if (v.ready && v.model) onConnected(v.model)
      })
      .catch(() => {})
    /* Один раз на монтирование: дальше состояние ведёт человек. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadModels = useCallback(async () => {
    setBusy(true)
    setError(null)
    const q = new URLSearchParams({ kind, baseUrl: kind === 'openrouter' ? OPENROUTER_BASE : baseUrl.trim() })
    if (apiKey.trim()) q.set('apiKey', apiKey.trim())
    try {
      const r = await fetch(`/ai-api/ai/provider/models?${q}`, { cache: 'no-store' })
      const j = (await r.json()) as { models?: ProviderModel[]; error?: string }
      if (!r.ok) throw new Error(j.error ?? `Сервер ответил ${r.status}`)
      setModels(j.models ?? [])
      if (!j.models?.length) setError('Провайдер вернул пустой список моделей.')
    } catch (e) {
      setModels([])
      setError(e instanceof Error ? e.message : 'Список моделей недоступен.')
    } finally {
      setBusy(false)
    }
  }, [apiKey, baseUrl, kind])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 60)
  }, [models, query])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/ai-api/ai/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          baseUrl: kind === 'openrouter' ? OPENROUTER_BASE : baseUrl.trim(),
          apiKey: apiKey.trim(),
          model: model.trim(),
          visionModel: '',
        }),
      })
      const j = (await r.json()) as { ready?: boolean; model?: string; error?: string }
      if (!r.ok) throw new Error(j.error ?? `Сервер ответил ${r.status}`)
      window.dispatchEvent(new Event('wsx:provider-changed'))
      if (j.ready && j.model) onConnected(j.model)
      else setError('Подключение сохранено, но модель не выбрана.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить подключение.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onb-model" data-testid="onb-model-step">
      <div className="onb-model-kinds" role="radiogroup" aria-label="Способ подключения">
        {(
          [
            { id: 'openrouter' as Kind, name: 'OpenRouter', sub: 'один ключ — сотни моделей' },
            { id: 'custom' as Kind, name: 'Свой сервер', sub: 'OpenAI-совместимый адрес' },
          ]
        ).map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            className={`onb-tab${kind === k.id ? ' is-on' : ''}`}
            onClick={() => {
              setKind(k.id)
              setModels([])
              setError(null)
            }}
            data-testid={`onb-provider-${k.id}`}
          >
            <b>{k.name}</b>
            <span>{k.sub}</span>
          </button>
        ))}
      </div>

      {kind === 'custom' && (
        <label className="onb-model-field">
          <span className="onb-kicker">Адрес API</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://мой-сервер/v1"
            spellCheck={false}
            autoComplete="off"
            data-testid="onb-provider-base"
          />
        </label>
      )}

      <label className="onb-model-field">
        <span className="onb-kicker">{kind === 'openrouter' ? 'Ключ OpenRouter' : 'Токен (если нужен)'}</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={kind === 'openrouter' ? 'sk-or-v1-…' : 'оставьте пустым, если сервер открыт'}
          spellCheck={false}
          autoComplete="off"
          data-testid="onb-provider-key"
        />
      </label>

      <label className="onb-model-field">
        <span className="onb-kicker">Модель</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={kind === 'openrouter' ? 'выберите ниже или впишите вручную' : 'имя модели на вашем сервере'}
          spellCheck={false}
          autoComplete="off"
          data-testid="onb-provider-model"
        />
      </label>

      <div className="onb-model-acts">
        <button type="button" className="onb-btn" onClick={() => void loadModels()} disabled={busy} data-testid="onb-provider-list">
          <IconRefresh width={13} height={13} aria-hidden="true" />
          {busy ? 'Спрашиваем…' : 'Показать модели'}
        </button>
        <button
          type="button"
          className="onb-btn primary"
          onClick={() => void save()}
          disabled={busy || !model.trim() || (kind === 'custom' && !baseUrl.trim()) || (kind === 'openrouter' && !apiKey.trim())}
          data-testid="onb-provider-save"
        >
          <IconCheck width={13} height={13} aria-hidden="true" />
          Подключить
        </button>
        {connected && (
          <span className="onb-model-ok" data-testid="onb-provider-connected">
            <IconCheck width={13} height={13} aria-hidden="true" /> подключено
          </span>
        )}
      </div>

      {error && (
        <p className="onb-model-err" role="alert" data-testid="onb-provider-error">
          {error}
        </p>
      )}

      {models.length > 0 && (
        <div className="onb-model-list" data-testid="onb-provider-models">
          <span className="onb-model-search">
            <IconSearch width={12} height={12} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Поиск среди ${models.length}`} aria-label="Поиск модели" />
          </span>
          <ul>
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={model === m.id ? 'is-on' : ''}
                  onClick={() => setModel(m.id)}
                  title={m.id}
                  data-testid="onb-provider-model-option"
                >
                  <span className="ellipsis">{m.name}</span>
                  {m.vision && <i>картинки</i>}
                  {m.free && <i className="free">бесплатно</i>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
