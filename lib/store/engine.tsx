'use client'

/* ============================================================
   СТОР · ПОДКЛЮЧЕНИЕ МОДЕЛИ
   Один источник правды о том, кто способен отвечать: какой способ
   подключения выбран (свой сервер или OpenRouter), какая модель
   пойдёт в запрос и готова ли она. Статус приходит с сервера
   (/ai-api/engine) — браузер не хранит токен провайдера.
   Сюда же складывается скорость последнего ответа.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { buildEngineView, useSettingsStore, type EngineView } from './settings'

export type ProviderInfo = {
  ok: boolean
  kind: 'custom' | 'openrouter'
  kindLabel: string
  /** База API, как её видит сервер. */
  base: string | null
  /** Имя модели, которое реально пойдёт в запрос. */
  model: string | null
  /** Модель для картинок. */
  visionModel: string | null
  code: string | null
  hint: string | null
}

export type EngineMetrics = { tokensPerSec: number | null; model: string | null }

export type EngineCtx = {
  /** Единственная подпись модели на весь интерфейс (UX-1). */
  engineView: EngineView
  /** null — статус ещё не спрашивали. */
  provider: ProviderInfo | null
  ready: boolean
  checking: boolean
  /** Сервер не ответил (нет входа или сети) — честно говорим об этом. */
  error: string | null
  recheck: () => void
  /** Скорость последнего ответа — из ответа адаптера, не из часов. */
  metrics: EngineMetrics
  setMetrics: (m: EngineMetrics) => void
}

const Ctx = createContext<EngineCtx | null>(null)

async function probe(signal: AbortSignal) {
  const r = await fetch('/ai-api/engine', { signal, cache: 'no-store' })
  if (r.status === 401) throw new Error('Нужен вход в приложение: статус модели закрыт сессией.')
  if (!r.ok) throw new Error(`Сервер ответил ${r.status}`)
  return (await r.json()) as { provider: ProviderInfo }
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettingsStore()

  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<EngineMetrics>({ tokensPerSec: null, model: null })
  /** Ручная перепроверка: кнопка «Проверить снова» дёргает счётчик. */
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setChecking(true)
    probe(ac.signal)
      .then((j) => {
        setProvider(j.provider)
        setError(null)
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Статус модели недоступен')
      })
      .finally(() => {
        if (!ac.signal.aborted) setChecking(false)
      })
    return () => ac.abort()
  }, [nonce])

  /* Настройки провайдера меняются в своём разделе — он и просит перепроверку. */
  useEffect(() => {
    const onChanged = () => setNonce((n) => n + 1)
    window.addEventListener('wsx:provider-changed', onChanged)
    return () => window.removeEventListener('wsx:provider-changed', onChanged)
  }, [])

  const recheck = useCallback(() => setNonce((n) => n + 1), [])

  const engineView = useMemo(
    () =>
      buildEngineView(
        settings,
        provider && { ok: provider.ok, model: provider.model, kindLabel: provider.kindLabel },
      ),
    [settings, provider],
  )

  const value = useMemo<EngineCtx>(
    () => ({
      engineView,
      provider,
      ready: provider?.ok === true,
      checking,
      error,
      recheck,
      metrics,
      setMetrics,
    }),
    [engineView, provider, checking, error, recheck, metrics],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useEngineStore(): EngineCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useEngineStore вызван вне EngineProvider')
  return v
}
