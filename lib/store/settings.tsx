'use client'

/* ============================================================
   СТОР · КОНФИГУРАЦИЯ (AR-1)
   Домен настроек: профиль, черновик экрана настроек, режим движка и
   согласие на облачные ходы. Никто, кроме этого файла, не пишет
   `wf.settings.v1`, поэтому «сохранить» и «откатить» имеют смысл.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePersistedState } from '@/hooks/use-persisted-state'
import {
  CLOUD_MODEL_LABEL,
  LOCAL_ENGINE_READY,
  engineOf,
  modelOf,
  type EngineId,
  type ModelId,
} from '@/lib/data'
import { useToast } from './toast'

export type ToggleId =
  | 'ocr'
  | 'autotag'
  | 'watch'
  | 'redact'
  | 'telemetry'
  | 'sendIndex'
  | 'ntfPipeline'
  | 'ntfPrivacy'
  | 'ntfDigest'

export type Settings = {
  engine: EngineId
  model: ModelId
  folder: string
  toggles: Record<ToggleId, boolean>
  /** Когда пользователь согласился отправлять запросы во внешнюю модель. */
  cloudConsentAt: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'local',
  model: 'qwen-7b',
  folder: '',
  toggles: {
    ocr: true,
    autotag: true,
    watch: true,
    redact: true,
    telemetry: false,
    sendIndex: true,
    ntfPipeline: true,
    ntfPrivacy: true,
    ntfDigest: false,
  },
  cloudConsentAt: null,
}

/** Профиль мог быть записан старой сборкой — добираем поля. */
export function normalizeSettings(s: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    toggles: { ...DEFAULT_SETTINGS.toggles, ...s.toggles },
  }
}

/**
 * Единый срез режима (UX-1). Все подписи — статус-бар, топбар, автор ответа,
 * футер композера — читают только его, поэтому расходиться им негде.
 */
export type EngineView = {
  mode: EngineId
  label: string
  model: string
  isCloud: boolean
  ready: boolean
  statusLabel: string
  netLabel: string
  consented: boolean
}

export function buildEngineView(s: Settings): EngineView {
  const e = engineOf(s.engine)
  const isCloud = !e.offline
  return {
    mode: s.engine,
    label: e.short,
    model: isCloud ? CLOUD_MODEL_LABEL : modelOf(s.model).short,
    isCloud,
    ready: isCloud || LOCAL_ENGINE_READY,
    statusLabel: isCloud
      ? s.engine === 'cloud'
        ? 'ВНЕШНЯЯ МОДЕЛЬ'
        : 'ГИБРИДНЫЙ РЕЖИМ'
      : LOCAL_ENGINE_READY
        ? 'ЛОКАЛЬНЫЙ РЕЖИМ'
        : 'ЛОКАЛЬНЫЙ ДВИЖОК НЕ ПОДКЛЮЧЁН',
    netLabel: isCloud ? 'ВНИМАНИЕ · ЕСТЬ ИСХОДЯЩИЕ' : 'НЕТ ИСХОДЯЩИХ ЗАПРОСОВ',
    consented: s.cloudConsentAt !== null,
  }
}

export type SettingsCtx = {
  settings: Settings
  ready: boolean
  draftSettings: Settings
  setDraftSettings: (fn: (s: Settings) => Settings) => void
  dirty: boolean
  saveSettings: () => void
  revertSettings: () => void
  setToggle: (id: ToggleId, value: boolean) => void
  grantCloudConsent: () => void
  revokeCloudConsent: () => void
  /** Источник индексации: пишет indexer-провайдер после выбора папки. */
  setFolder: (path: string) => void
  engineView: EngineView
}

const Ctx = createContext<SettingsCtx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { flash } = useToast()
  const [raw, setRaw, ready] = usePersistedState<Settings>('wf.settings.v1', DEFAULT_SETTINGS)
  const settings = useMemo(() => normalizeSettings(raw), [raw])
  const [draftSettings, setDraftState] = useState<Settings>(DEFAULT_SETTINGS)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (ready) setDraftState(settingsRef.current)
  }, [ready])

  const setDraftSettings = useCallback(
    (fn: (s: Settings) => Settings) => setDraftState((s) => fn(s)),
    [],
  )

  const dirty = useMemo(
    () =>
      JSON.stringify({ ...draftSettings, cloudConsentAt: null }) !==
      JSON.stringify({ ...settings, cloudConsentAt: null }),
    [draftSettings, settings],
  )

  const saveSettings = useCallback(() => {
    const next: Settings = { ...draftSettings, cloudConsentAt: settingsRef.current.cloudConsentAt }
    setRaw(next)
    settingsRef.current = next
    flash('Конфигурация записана в локальный профиль. Индекс не тронут.')
  }, [draftSettings, flash, setRaw])

  const revertSettings = useCallback(() => setDraftState(settingsRef.current), [])

  const setToggle = useCallback(
    (id: ToggleId, value: boolean) => {
      setRaw((s) => {
        const base = normalizeSettings(s)
        return { ...base, toggles: { ...base.toggles, [id]: value } }
      })
      setDraftState((s) => ({ ...s, toggles: { ...s.toggles, [id]: value } }))
    },
    [setRaw],
  )

  const grantCloudConsent = useCallback(() => {
    setRaw((s) => ({ ...normalizeSettings(s), cloudConsentAt: Date.now() }))
  }, [setRaw])

  const revokeCloudConsent = useCallback(() => {
    setRaw((s) => ({ ...normalizeSettings(s), cloudConsentAt: null }))
    flash('Согласие на облачные запросы отозвано — спросим снова перед следующим ходом.')
  }, [flash, setRaw])

  const setFolder = useCallback(
    (path: string) => {
      if (!path) return
      setRaw((s) => ({ ...normalizeSettings(s), folder: path }))
      setDraftState((s) => ({ ...s, folder: path }))
    },
    [setRaw],
  )

  const engineView = useMemo(() => buildEngineView(settings), [settings])

  const value = useMemo<SettingsCtx>(
    () => ({
      settings,
      ready,
      draftSettings,
      setDraftSettings,
      dirty,
      saveSettings,
      revertSettings,
      setToggle,
      grantCloudConsent,
      revokeCloudConsent,
      setFolder,
      engineView,
    }),
    [
      dirty, draftSettings, engineView, grantCloudConsent, ready, revertSettings,
      revokeCloudConsent, saveSettings, setDraftSettings, setFolder, setToggle, settings,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettingsStore(): SettingsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettingsStore вызван вне SettingsProvider')
  return v
}
