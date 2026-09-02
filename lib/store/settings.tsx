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
import {
  NO_ONBOARDING,
  resolveOnboarding,
  type OnboardingResult,
  type OnboardingState,
} from '@/lib/onboarding'
import { logJournal } from '@/lib/journal'
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
  /** NF-4: пройден ли онбординг и что человек в нём выбрал. */
  onboarding: OnboardingState
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
  onboarding: NO_ONBOARDING,
}

/** Профиль мог быть записан старой сборкой — добираем поля. */
export function normalizeSettings(s: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    toggles: { ...DEFAULT_SETTINGS.toggles, ...s.toggles },
    onboarding: { ...NO_ONBOARDING, ...s.onboarding },
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

/**
 * NF-2: готовность локального движка приходит снаружи — от домена движка,
 * который спросил сервер, запущена ли Ollama и стоит ли модель. Без этих
 * данных (второй аргумент не передан) продукт по-прежнему честно пишет
 * «локальный движок не подключён», а не выдумывает готовность.
 */
export function buildEngineView(
  s: Settings,
  local?: { ok: boolean; model: string | null } | null,
): EngineView {
  const e = engineOf(s.engine)
  const isCloud = !e.offline
  const localReady = local?.ok ?? LOCAL_ENGINE_READY
  return {
    mode: s.engine,
    label: e.short,
    model: isCloud
      ? CLOUD_MODEL_LABEL
      : localReady && local?.model
        ? local.model
        : modelOf(s.model).short,
    isCloud,
    ready: isCloud || localReady,
    statusLabel: isCloud
      ? s.engine === 'cloud'
        ? 'ВНЕШНЯЯ МОДЕЛЬ'
        : 'ГИБРИДНЫЙ РЕЖИМ'
      : localReady
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
  /** NF-4: онбординг пройден — режим и согласие выставляются одним действием. */
  finishOnboarding: (r: OnboardingResult) => void
  /** NF-4: промежуточный выбор (ключ создан/отклонён) — чтобы перезагрузка не потеряла шаг. */
  noteOnboarding: (patch: Partial<OnboardingState>) => void
  /** NF-4: у профиля уже есть мастер-ключ — три шага ему не нужны. */
  markOnboarded: () => void
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
    void logJournal(
      'cloud-consent',
      'Согласие на облачные запросы выдано',
      'С этого момента вопросы и подобранные фрагменты файлов могут уходить внешнему провайдеру модели.',
    )
  }, [setRaw])

  const revokeCloudConsent = useCallback(() => {
    setRaw((s) => ({ ...normalizeSettings(s), cloudConsentAt: null }))
    void logJournal(
      'cloud-consent',
      'Согласие на облачные запросы отозвано',
      'Перед следующим внешним ходом продукт спросит согласие заново.',
    )
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

  const finishOnboarding = useCallback(
    (r: OnboardingResult) => {
      const res = resolveOnboarding(r, Date.now())
      setRaw((s) => ({
        ...normalizeSettings(s),
        engine: res.engine,
        cloudConsentAt: res.cloudConsent ? Date.now() : null,
        onboarding: res.onboarding,
      }))
      /* Черновик держим в курсе, иначе экран настроек решит, что есть
         несохранённые изменения, хотя пользователь ничего не правил. */
      setDraftState((s) => ({ ...s, engine: res.engine, onboarding: res.onboarding }))
      if (res.cloudConsent) {
        void logJournal(
          'cloud-consent',
          'Согласие на облачные запросы выдано при первом запуске',
          'Владелец выбрал гибридный режим и подтвердил, что вопрос и фрагменты файлов уходят внешнему провайдеру.',
        )
      }
      if (res.downgraded) {
        flash('Без мастер-ключа гибридный режим недоступен — оставили локальный.')
      }
    },
    [flash, setRaw],
  )

  const noteOnboarding = useCallback(
    (patch: Partial<OnboardingState>) => {
      setRaw((s) => {
        const base = normalizeSettings(s)
        if (base.onboarding.at !== null) return s
        return { ...base, onboarding: { ...base.onboarding, ...patch, at: null } }
      })
      setDraftState((s) => ({ ...s, onboarding: { ...s.onboarding, ...patch, at: null } }))
    },
    [setRaw],
  )

  const markOnboarded = useCallback(() => {
    const at = Date.now()
    setRaw((s) => {
      const base = normalizeSettings(s)
      if (base.onboarding.at !== null) return s
      return { ...base, onboarding: { ...base.onboarding, at } }
    })
    setDraftState((s) => (s.onboarding.at === null ? { ...s, onboarding: { ...s.onboarding, at } } : s))
  }, [setRaw])

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
      finishOnboarding,
      noteOnboarding,
      markOnboarded,
    }),
    [
      dirty, draftSettings, finishOnboarding, grantCloudConsent, markOnboarded, noteOnboarding,
      ready, revertSettings, revokeCloudConsent, saveSettings, setDraftSettings, setFolder,
      setToggle, settings,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettingsStore(): SettingsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettingsStore вызван вне SettingsProvider')
  return v
}
