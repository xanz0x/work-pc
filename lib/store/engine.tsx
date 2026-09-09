'use client'

/* ============================================================
   СТОР · ДВИЖОК ИИ (NF-2)
   Один источник правды о том, кто способен отвечать: запущен ли Ollama
   на устройстве, стоит ли выбранная модель, настроено ли облако. Статус
   приходит с сервера (/ai-api/engine) — браузер не стучится в localhost
   сам. Сюда же складывается настоящая скорость последнего локального
   ответа: интерфейс перестаёт показывать прочерк, как только движок
   действительно посчитал токены.
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
import type { ModelId } from '@/lib/data'
import { buildEngineView, useSettingsStore, type EngineView } from './settings'

export type LocalEngine = {
  ok: boolean
  /** Адрес движка, как его видит сервер. */
  base: string | null
  /** Тег модели, который реально пойдёт в запрос. */
  model: string | null
  /** Что установлено на устройстве. */
  models: string[]
  code: string | null
  hint: string | null
  /** Готовая команда «ollama pull …». */
  pull: string | null
}

export type EngineMetrics = { tokensPerSec: number | null; model: string | null }

export type EngineCtx = {
  /** Единственная подпись движка и модели на весь интерфейс (UX-1). */
  engineView: EngineView
  /** null — статус ещё не спрашивали. */
  local: LocalEngine | null
  cloudOk: boolean
  checking: boolean
  /** Сервер не ответил (нет входа или сети) — честно говорим об этом. */
  error: string | null
  recheck: () => void
  /** Скорость последнего локального ответа — из ответа адаптера, не из часов. */
  metrics: EngineMetrics
  setMetrics: (m: EngineMetrics) => void
}

const Ctx = createContext<EngineCtx | null>(null)

async function probe(model: ModelId, signal: AbortSignal) {
  const r = await fetch(`/ai-api/engine?model=${encodeURIComponent(model)}`, { signal })
  if (r.status === 401) throw new Error('Нужен вход в приложение: статус движка закрыт сессией.')
  if (!r.ok) throw new Error(`Сервер ответил ${r.status}`)
  return (await r.json()) as { local: LocalEngine; cloud: { ok: boolean; model: string | null } }
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettingsStore()
  const model = settings.model

  const [local, setLocal] = useState<LocalEngine | null>(null)
  const [cloudOk, setCloudOk] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<EngineMetrics>({ tokensPerSec: null, model: null })
  /** Ручная перепроверка: кнопка «Проверить снова» дёргает счётчик. */
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setChecking(true)
    probe(model, ac.signal)
      .then((j) => {
        setLocal(j.local)
        setCloudOk(j.cloud.ok)
        setError(null)
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Статус движка недоступен')
      })
      .finally(() => {
        if (!ac.signal.aborted) setChecking(false)
      })
    return () => ac.abort()
  }, [model, nonce])

  const recheck = useCallback(() => setNonce((n) => n + 1), [])

  const engineView = useMemo(
    () => buildEngineView(settings, local && { ok: local.ok, model: local.model }),
    [settings, local],
  )

  const value = useMemo<EngineCtx>(
    () => ({ engineView, local, cloudOk, checking, error, recheck, metrics, setMetrics }),
    [engineView, local, cloudOk, checking, error, recheck, metrics],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useEngineStore(): EngineCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useEngineStore вызван вне EngineProvider')
  return v
}
