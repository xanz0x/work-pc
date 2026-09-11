'use client'

/* ============================================================
   НАСТРОЙКИ · ПОДКЛЮЧЕНИЕ МОДЕЛИ
   Локальную модель продукт больше не устанавливает. Есть два
   способа подключить ИИ, и оба говорят на OpenAI-совместимом
   протоколе:
     1. свой сервер — URL + токен + имя модели;
     2. OpenRouter  — ключ и модель из живого списка провайдера
        (с поиском, ценой и отметкой «видит картинки»).
   Токен наружу не отдаётся: сервер присылает только его хвост.
   ============================================================ */

import './ai-provider-section.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconChipAi, IconCheck, IconEye, IconRefresh, IconSearch } from './icons'
import { useEngineStore } from '@/lib/store/engine'
import { useToast } from '@/lib/vault-store'

type Kind = 'custom' | 'openrouter'

type ProviderView = {
  kind: Kind
  baseUrl: string
  model: string
  visionModel: string
  hasKey: boolean
  keyHint: string | null
  ready: boolean
}

type ProviderModel = {
  id: string
  name: string
  context: number | null
  vision: boolean
  promptPrice: number | null
  free: boolean
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const fmtContext = (n: number | null): string =>
  n === null ? '' : n >= 1000 ? `${Math.round(n / 1000)}K контекст` : `${n} контекст`

const fmtPrice = (m: ProviderModel): string =>
  m.free ? 'бесплатно' : m.promptPrice === null ? '' : `$${m.promptPrice.toFixed(2)}/1M`

export function AiProviderSection() {
  const { flash } = useToast()
  const engine = useEngineStore()

  const [kind, setKind] = useState<Kind>('openrouter')
  const [baseUrl, setBaseUrl] = useState(OPENROUTER_BASE)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [saved, setSaved] = useState<ProviderView | null>(null)

  const [models, setModels] = useState<ProviderModel[]>([])
  const [listState, setListState] = useState<'idle' | 'loading' | 'done' | 'fail'>('idle')
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlyVision, setOnlyVision] = useState(false)
  const [onlyFree, setOnlyFree] = useState(false)
  const [busy, setBusy] = useState(false)

  const applyView = useCallback((v: ProviderView) => {
    setSaved(v)
    setKind(v.kind)
    setBaseUrl(v.baseUrl || (v.kind === 'openrouter' ? OPENROUTER_BASE : ''))
    setModel(v.model)
    setVisionModel(v.visionModel)
    setApiKey('')
  }, [])

  useEffect(() => {
    let alive = true
    void fetch('/ai-api/ai/provider', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<ProviderView>) : null))
      .then((v) => {
        if (alive && v) applyView(v)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [applyView])

  const loadModels = useCallback(async () => {
    setListState('loading')
    setListError(null)
    const q = new URLSearchParams({ kind, baseUrl: kind === 'openrouter' ? OPENROUTER_BASE : baseUrl.trim() })
    if (apiKey.trim()) q.set('apiKey', apiKey.trim())
    try {
      const r = await fetch(`/ai-api/ai/provider/models?${q}`, { cache: 'no-store' })
      const j = (await r.json()) as { models?: ProviderModel[]; error?: string }
      if (!r.ok) throw new Error(j.error ?? `Сервер ответил ${r.status}`)
      setModels(j.models ?? [])
      setListState('done')
    } catch (e) {
      setModels([])
      setListState('fail')
      setListError(e instanceof Error ? e.message : 'Список моделей недоступен.')
    }
  }, [apiKey, baseUrl, kind])

  /* Список подтягиваем сам, когда ключ уже сохранён: выбирать модель из
     живого списка удобнее, чем вспоминать её имя. */
  useEffect(() => {
    if (kind === 'openrouter' && saved?.hasKey && saved.kind === 'openrouter' && listState === 'idle') {
      void loadModels()
    }
  }, [kind, listState, loadModels, saved])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models
      .filter((m) => (!onlyVision || m.vision) && (!onlyFree || m.free))
      .filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 300)
  }, [models, onlyFree, onlyVision, query])

  async function save() {
    setBusy(true)
    try {
      const r = await fetch('/ai-api/ai/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          baseUrl: kind === 'openrouter' ? OPENROUTER_BASE : baseUrl.trim(),
          apiKey: apiKey.trim(),
          model: model.trim(),
          visionModel: visionModel.trim(),
        }),
      })
      const j = (await r.json()) as ProviderView & { error?: string }
      if (!r.ok) throw new Error(j.error ?? `Сервер ответил ${r.status}`)
      applyView(j)
      flash(j.ready ? `Модель подключена: ${j.model}` : 'Подключение сохранено, но модель ещё не выбрана')
      window.dispatchEvent(new Event('wsx:provider-changed'))
      engine.recheck()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось сохранить подключение')
    } finally {
      setBusy(false)
    }
  }

  const canSave =
    Boolean(model.trim()) &&
    (kind === 'openrouter' ? Boolean(apiKey.trim() || saved?.hasKey) : Boolean(baseUrl.trim()))

  return (
    <section className="sec panel" id="set-engine" aria-labelledby="settings-engine-title" data-testid="settings-engine-section">
      <div className="sec-head">
        <span className="sec-icon">
          <IconChipAi />
        </span>
        <div className="sec-head-text">
          <h2 className="setting-title" id="settings-engine-title" data-testid="settings-engine-title">
            Подключение модели
          </h2>
          <div className="setting-note" data-testid="settings-engine-description">
            Свой сервер или OpenRouter — программа ничего не устанавливает на компьютер
          </div>
        </div>
        <span className={`badge ${saved?.ready ? 'badge-ok' : 'badge-warn'}`} data-testid="provider-state">
          {saved?.ready ? `подключена · ${saved.model}` : 'не подключена'}
        </span>
      </div>

      <div className="apr-kinds" role="radiogroup" aria-label="Способ подключения модели">
        {(
          [
            { id: 'openrouter' as Kind, name: 'OpenRouter', sub: 'Один ключ — сотни моделей. Список приходит от провайдера.' },
            { id: 'custom' as Kind, name: 'Свой сервер', sub: 'Любой OpenAI-совместимый адрес: URL, токен и имя модели.' },
          ]
        ).map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            className={`apr-kind${kind === k.id ? ' selected' : ''}`}
            onClick={() => {
              setKind(k.id)
              setBaseUrl(k.id === 'openrouter' ? OPENROUTER_BASE : saved?.kind === 'custom' ? saved.baseUrl : '')
              setListState('idle')
              setModels([])
            }}
            data-testid={`provider-kind-${k.id}`}
          >
            <span className="radio-dot" />
            <span>
              <span className="apr-kind-name">{k.name}</span>
              <span className="apr-kind-sub">{k.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="apr-fields">
        {kind === 'custom' && (
          <label className="apr-field">
            <span className="label-mono">Адрес API</span>
            <input
              className="input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://мой-сервер/v1"
              spellCheck={false}
              autoComplete="off"
              data-testid="provider-base-url"
            />
            <span className="apr-hint">Без «/chat/completions» — только база, как у OpenAI API.</span>
          </label>
        )}

        <label className="apr-field">
          <span className="label-mono">{kind === 'openrouter' ? 'Ключ OpenRouter' : 'Токен доступа'}</span>
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={saved?.hasKey ? `сохранён ${saved.keyHint ?? ''} — оставьте пустым, чтобы не менять` : kind === 'openrouter' ? 'sk-or-v1-…' : 'токен вашего сервера'}
            spellCheck={false}
            autoComplete="off"
            data-testid="provider-api-key"
          />
          <span className="apr-hint">
            {kind === 'openrouter'
              ? 'Ключ выдают на openrouter.ai/keys. Он хранится только на этом сервере.'
              : 'Пусто — если сервер не требует авторизации.'}
          </span>
        </label>

        <label className="apr-field">
          <span className="label-mono">Модель по умолчанию</span>
          <input
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={kind === 'openrouter' ? 'выберите из списка ниже' : 'например, qwen2.5-7b-instruct'}
            spellCheck={false}
            autoComplete="off"
            data-testid="provider-model"
          />
        </label>

        <label className="apr-field">
          <span className="label-mono">Модель для картинок</span>
          <input
            className="input"
            value={visionModel}
            onChange={(e) => setVisionModel(e.target.value)}
            placeholder="пусто — та же, что по умолчанию"
            spellCheck={false}
            autoComplete="off"
            data-testid="provider-vision-model"
          />
          <span className="apr-hint">Ей уходят фотографии из библиотеки: она называет, что на снимке.</span>
        </label>
      </div>

      <div className="apr-actions">
        <button type="button" className="btn btn-sm" onClick={() => void loadModels()} disabled={listState === 'loading'} data-testid="provider-load-models">
          <IconRefresh />
          {listState === 'loading' ? 'Спрашиваем провайдера…' : 'Обновить список моделей'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!canSave || busy} data-testid="provider-save">
          <IconCheck />
          {busy ? 'Сохраняем…' : 'Сохранить подключение'}
        </button>
      </div>

      {listError && (
        <p className="apr-error" role="alert" data-testid="provider-models-error">
          {listError}
        </p>
      )}

      {models.length > 0 && (
        <div className="apr-picker" data-testid="provider-model-picker">
          <div className="apr-picker-bar">
            <span className="apr-search">
              <IconSearch width={13} height={13} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Поиск среди ${models.length} моделей`}
                aria-label="Поиск модели"
                data-testid="provider-model-search"
              />
            </span>
            <button
              type="button"
              className={`apr-chip${onlyVision ? ' on' : ''}`}
              onClick={() => setOnlyVision((v) => !v)}
              data-testid="provider-filter-vision"
            >
              <IconEye width={12} height={12} aria-hidden="true" /> видят картинки
            </button>
            <button
              type="button"
              className={`apr-chip${onlyFree ? ' on' : ''}`}
              onClick={() => setOnlyFree((v) => !v)}
              data-testid="provider-filter-free"
            >
              бесплатные
            </button>
          </div>
          <ul className="apr-list">
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`apr-row${model === m.id ? ' selected' : ''}`}
                  onClick={() => setModel(m.id)}
                  data-testid="provider-model-option"
                  title={m.id}
                >
                  <span className="apr-row-main">
                    <span className="apr-row-name">{m.name}</span>
                    <span className="apr-row-id mono">{m.id}</span>
                  </span>
                  <span className="apr-row-meta">
                    {m.vision && <span className="apr-tag">картинки</span>}
                    {fmtPrice(m) && <span className={`apr-tag${m.free ? ' free' : ''}`}>{fmtPrice(m)}</span>}
                    {fmtContext(m.context) && <span className="apr-tag ghost">{fmtContext(m.context)}</span>}
                  </span>
                  {m.vision && (
                    <span
                      className="apr-row-vision"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setVisionModel(m.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setVisionModel(m.id)
                        }
                      }}
                      data-testid="provider-pick-vision"
                    >
                      для фото
                    </span>
                  )}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="apr-empty">Под фильтры не подошла ни одна модель.</li>}
          </ul>
        </div>
      )}

      <div className="sec-note">
        {engine.provider?.ok
          ? `Запросы уходят на ${engine.provider.base}. Фото читает ${engine.provider.visionModel || engine.provider.model}.`
          : 'Пока модель не подключена, чат и разбор файлов честно откажут — выдуманных ответов не будет.'}
      </div>
    </section>
  )
}
