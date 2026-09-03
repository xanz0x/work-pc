'use client'

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { IndexedRecord } from '@/lib/indexer/types'
import type { OnboardingResult, OnboardingState } from './onboarding'
import {
  CLUSTERS,
  fmtBytes,
  modelOf,
  totalBytes,
  viewOf,
  type ClusterId,
  type FileView,
  type VaultFile,
} from './data'
import type { Focus, ScreenId } from './store/nav'
import { buildGraph, clusterLoad, neighborsOf, type Graph } from './graph'
import { DAY, HOUR, type Note } from './notes'
import type { Hit, ScopeId, SecretIndexItem } from './search'
import type { Session } from '@/components/chat/types'
import type { clusterMix } from './data'

/* ============================================================
   ФАСАД СЕЙФА (AR-1)
   Раньше здесь лежали 1 550 строк одного контекста: корпус, стикеры,
   разговоры, настройки, лента, замок и секундные часы в одном значении —
   тик обновлял всё дерево. Теперь домены живут отдельно:

     lib/store/clock.tsx     · часы (секундный и грубый тик)
     lib/store/toast.tsx     · короткие сообщения
     lib/store/settings.tsx  · профиль, черновик, режим движка
     lib/store/notifs.tsx    · лента событий, архив, отмена
     lib/store/data.tsx      · файлы, стикеры, разговоры и производные
     lib/store/lock.tsx      · мастер-ключ, автоблокировка, вкладки

   В этом файле остались навигация, поиск и сборка фасада `useVault()`:
   внешний контракт не изменился ни на одно поле, поэтому экраны можно
   переводить на узкие хуки (`useDataStore`, `useLockStore`, …) по одному,
   а не разом. Обратная совместимость важнее красоты.
   ============================================================ */

export type { Focus, ScreenId } from './store/nav'
export { useNavStore } from './store/nav'

/** Вид файла живёт в data.ts — здесь он только переиспользуется. */
export { viewOf }
export type { FileView }

/* ---------- реэкспорты доменов: внешний контракт не меняется ---------- */

export {
  DEFAULT_SETTINGS,
  buildEngineView,
  normalizeSettings,
  type EngineView,
  type Settings,
  type ToggleId,
} from './store/settings'
export type { Notif, NotifCat, NotifKind, NotifLink } from './store/notifs'
export type { OnboardingResult, OnboardingState } from './onboarding'
export type { LockStatus, LockView } from './store/lock'
export { useCoarseTick, useNow } from './store/clock'
export { useDataStore } from './store/data'
export { useLockStore } from './store/lock'
export { useSettingsStore } from './store/settings'
export { useNotifsStore } from './store/notifs'
export { useEngineStore } from './store/engine'
export { useToast } from './store/toast'

import { ClockProvider } from './store/clock'
import { ToastProvider, useToast } from './store/toast'
import { SettingsProvider, useSettingsStore, type EngineView, type Settings, type ToggleId } from './store/settings'
import { NotifsProvider, useNotifsStore, type Notif, type NotifCat } from './store/notifs'
import { DataProvider, useDataStore, type VaultStats } from './store/data'
import { LockProvider, useLockStore, type LockView } from './store/lock'
import { EngineProvider, useEngineStore } from './store/engine'
import { NavProvider, useNavStore } from './store/nav'
import type { LockMethod } from './lock-store'

export type VaultCtx = {
  hydrated: boolean

  /* корпус */
  files: VaultFile[]
  views: FileView[]
  fileById: (id: string) => VaultFile | undefined
  viewById: (id: string) => FileView | undefined
  addFiles: (incoming: { name: string; size?: number }[]) => void
  /** NF-1: результаты настоящего индексатора становятся файлами сейфа. */
  applyIndexed: (records: IndexedRecord[]) => void
  /** NF-1: честный статус «в обработке» — по реальному конвейеру. */
  setIndexing: (ids: string[], on: boolean) => void
  /** NF-1: файл исчез с диска — уходит и из сейфа. */
  dropIndexed: (ids: string[]) => void
  /** NF-1: подключённая папка-источник. */
  setFolder: (path: string) => void
  /** NF-1: провайдер индексатора подписывает сюда свою переиндексацию. */
  setReindexHandler: (fn: (() => void) | null) => void
  removeFile: (id: string) => void
  retagFile: (id: string, cluster: ClusterId) => void
  /** Перестроить индекс: файлы снова проходят конвейер, связи считаются заново. */
  reindexAll: () => void
  /** Снять автометки и описания: файлы остаются, карта памяти рассыпается. */
  clearIndex: () => void
  /** Стереть сейф целиком: файлы, стикеры и разговоры. */
  wipeVault: () => void

  /* стикеры */
  notes: Note[]
  liveNotes: Note[]
  notesFor: (fileId: string) => Note[]
  addNote: (n: Omit<Note, 'id' | 'createdAt'>) => string
  patchNote: (id: string, fn: (n: Note) => Note) => void
  burnNote: (id: string) => void
  extendNote: (id: string, ms: number) => void

  /* разговоры */
  sessions: Session[]
  activeSessionId: string | null
  setActiveSession: (id: string | null) => void
  addSession: (s: Session) => void
  patchSession: (id: string, fn: (s: Session) => Session) => void
  removeSession: (id: string) => void
  drafts: Record<string, string>
  setDraft: (sessionId: string, text: string) => void
  scrolls: Record<string, number>
  setScroll: (sessionId: string, top: number) => void

  /* конфигурация */
  settings: Settings
  draftSettings: Settings
  setDraftSettings: (fn: (s: Settings) => Settings) => void
  dirty: boolean
  saveSettings: () => void
  revertSettings: () => void
  /** NF-4: что человек выбрал в онбординге и пройден ли он. */
  onboarding: OnboardingState
  finishOnboarding: (r: OnboardingResult) => void

  /* события */
  notifs: Notif[]
  unread: number
  notify: (n: Omit<Notif, 'id' | 'at' | 'unread'>) => void
  markAllRead: () => void
  toggleRead: (id: string) => void
  /** Открыть источник события и снять unread одним действием. */
  openNotif: (id: string) => void
  snoozeNotif: (id: string, ms: number) => void
  muteNotifCat: (cat: NotifCat) => void
  archiveNotif: (id: string) => void
  restoreNotif: (id: string) => void
  deleteNotif: (id: string) => void
  clearRead: () => void
  clearAllNotifs: () => void
  purgeArchive: () => void
  notifUndo: { label: string; at: number } | null
  undoNotifs: () => void
  /** Совместимость: старое имя действия «убрать». */
  dismissNotif: (id: string) => void

  /* навигация */
  screen: ScreenId
  go: (screen: ScreenId) => void
  fileFocus: Focus
  noteFocus: Focus
  clusterFocus: Focus
  nodeFocus: Focus
  settingFocus: Focus
  /** Открытая запись менеджера секретов (переход из поиска и палитры). */
  secretFocus: Focus
  openSecret: (id: string) => void
  /**
   * Индекс сейфа секретов для глобального поиска: заполняет SecretsProvider,
   * только когда замок открыт. Пустой массив = секретов в поиске нет.
   */
  secretIndex: SecretIndexItem[]
  setSecretIndex: (list: SecretIndexItem[]) => void
  openFile: (fileId: string) => void
  /** Открыть стикер в инспекторе библиотеки. */
  openNote: (noteId: string) => void
  openOnMap: (fileId: string) => void
  openCluster: (cluster: ClusterId | 'all') => void
  openSetting: (id: string) => void
  openSession: (id: string) => void

  /* поиск */
  query: string
  setQuery: (q: string) => void
  scope: ScopeId
  setScope: (s: ScopeId) => void
  hits: Hit[]
  matchedFiles: Set<string>
  palette: boolean
  setPalette: (open: boolean) => void
  runHit: (h: Hit) => void

  /* производные числа */
  graph: Graph
  clusters: ReturnType<typeof clusterLoad>
  mix: ReturnType<typeof clusterMix>
  neighbors: (id: string) => ReturnType<typeof neighborsOf>
  stats: VaultStats
  /** Единственный источник подписей режима и модели для всего интерфейса. */
  engineView: EngineView
  grantCloudConsent: () => void
  revokeCloudConsent: () => void
  /** Мгновенно переключить один тумблер (без черновика настроек). */
  setToggle: (id: ToggleId, value: boolean) => void

  /* короткие сообщения */
  toast: string | null
  flash: (msg: string) => void

  /* замок */
  lock: LockView
  lockEpoch: number
  fileKeysCount: number
  setupLock: (secret: string, method: LockMethod) => Promise<string | null>
  changeMaster: (
    currentSecret: string,
    nextSecret: string,
    nextMethod?: LockMethod,
  ) => Promise<string | null>
  disableLock: (currentSecret: string) => Promise<string | null>
  lockNow: () => void
  unlock: (secret: string) => Promise<boolean>
  completeUnlock: () => void
  setAutoLock: (min: number) => void
  resetLock: () => void
}

const Ctx = createContext<VaultCtx | null>(null)

export function useVault(): VaultCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVault вызван вне VaultProvider')
  return v
}

/* ============================================================
   ПРОВАЙДЕР
   ============================================================ */

/**
 * Композиция доменов: часы → тосты → настройки → движок → лента → данные →
 * замок → навигация и поиск. Порядок не декоративный: каждый следующий домен
 * читает предыдущие, обратных связей нет.
 */
export function VaultProvider({ children }: { children: ReactNode }) {
  return (
    <ClockProvider>
      <ToastProvider>
        <SettingsProvider>
          <EngineProvider>
           <NotifsProvider>
            <DataProvider>
              <LockProvider>
                <NavProvider>
                  <VaultFacade>{children}</VaultFacade>
                </NavProvider>
              </LockProvider>
            </DataProvider>
           </NotifsProvider>
          </EngineProvider>
        </SettingsProvider>
      </ToastProvider>
    </ClockProvider>
  )
}

function VaultFacade({ children }: { children: ReactNode }) {
  const { toast, flash } = useToast()
  const S = useSettingsStore()
  const N = useNotifsStore()
  const D = useDataStore()
  const L = useLockStore()
  const E = useEngineStore()

  const hydrated = D.ready && S.ready && N.ready

  /** Лента первого запуска собирается из настоящего состояния сейфа. */
  useEffect(() => {
    if (!hydrated || !N.seededReady || N.seeded || N.notifs.length > 0) return
    const t0 = Date.now()
    const files = D.files
    const bytes = totalBytes(files)
    const g = buildGraph(files, [], t0)
    const m = modelOf(S.settings.model)
    N.replaceNotifs([
      {
        id: 'seed-index',
        kind: 'ok',
        cat: 'pipeline',
        icon: 'check',
        title: 'Демо-корпус загружен',
        body: `${files.length} файлов, ${g.links} связей на карте памяти. Содержимое демо-файлов не читалось: подключите папку, чтобы построить настоящий индекс.`,
        at: t0 - 34 * 60_000,
        unread: true,
      },
      {
        id: 'seed-model',
        kind: 'info',
        cat: 'system',
        icon: 'chipAi',
        title: `Модель ${m.short} выбрана в профиле`,
        body: 'Локальный движок работает через Ollama на этом устройстве. В настройках видно, запущен ли он и стоит ли выбранная модель.',
        at: t0 - 3 * HOUR,
        unread: false,
      },
      {
        id: 'seed-vault',
        kind: 'info',
        cat: 'system',
        icon: 'lockRound',
        title: 'Проверка целостности сейфа',
        body: `AES-256: контрольные суммы совпали, объём сейфа ${fmtBytes(bytes)}.`,
        at: t0 - DAY,
        unread: false,
      },
    ])
    N.markSeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, N.seededReady])

  /* Навигация, поиск и палитра живут в отдельном домене (lib/store/nav.tsx):
     тяжёлые экраны подписываются на него точечно, минуя фасад. */
  const NAV = useNavStore()

  const value = useMemo<VaultCtx>(
    () => ({
      hydrated,

      /* корпус, стикеры, разговоры — домен данных */
      files: D.files,
      views: D.views,
      fileById: D.fileById,
      viewById: D.viewById,
      addFiles: D.addFiles,
      applyIndexed: D.applyIndexed,
      setIndexing: D.setIndexing,
      dropIndexed: D.dropIndexed,
      setFolder: S.setFolder,
      setReindexHandler: D.setReindexHandler,
      removeFile: D.removeFile,
      retagFile: D.retagFile,
      reindexAll: D.reindexAll,
      clearIndex: D.clearIndex,
      wipeVault: D.wipeVault,
      notes: D.notes,
      liveNotes: D.liveNotes,
      notesFor: D.notesFor,
      addNote: D.addNote,
      patchNote: D.patchNote,
      burnNote: D.burnNote,
      extendNote: D.extendNote,
      sessions: D.sessions,
      activeSessionId: D.activeSessionId,
      setActiveSession: D.setActiveSession,
      addSession: D.addSession,
      patchSession: D.patchSession,
      removeSession: D.removeSession,
      drafts: D.drafts,
      setDraft: D.setDraft,
      scrolls: D.scrolls,
      setScroll: D.setScroll,
      graph: D.graph,
      clusters: D.clusters,
      mix: D.mix,
      neighbors: D.neighbors,
      stats: D.stats,

      /* конфигурация */
      settings: S.settings,
      draftSettings: S.draftSettings,
      setDraftSettings: S.setDraftSettings,
      dirty: S.dirty,
      saveSettings: S.saveSettings,
      revertSettings: S.revertSettings,
      onboarding: S.settings.onboarding,
      finishOnboarding: S.finishOnboarding,
      engineView: E.engineView,
      grantCloudConsent: S.grantCloudConsent,
      revokeCloudConsent: S.revokeCloudConsent,
      setToggle: S.setToggle,

      /* события */
      notifs: N.notifs,
      unread: N.unread,
      notify: N.notify,
      markAllRead: N.markAllRead,
      toggleRead: N.toggleRead,
      snoozeNotif: N.snoozeNotif,
      muteNotifCat: N.muteNotifCat,
      archiveNotif: N.archiveNotif,
      restoreNotif: N.restoreNotif,
      deleteNotif: N.deleteNotif,
      clearRead: N.clearRead,
      clearAllNotifs: N.clearAllNotifs,
      purgeArchive: N.purgeArchive,
      notifUndo: N.notifUndo,
      undoNotifs: N.undoNotifs,
      dismissNotif: N.archiveNotif,

      /* навигация и поиск — домен nav */
      screen: NAV.screen,
      go: NAV.go,
      fileFocus: NAV.fileFocus,
      noteFocus: NAV.noteFocus,
      clusterFocus: NAV.clusterFocus,
      nodeFocus: NAV.nodeFocus,
      settingFocus: NAV.settingFocus,
      secretFocus: NAV.secretFocus,
      openSecret: NAV.openSecret,
      secretIndex: NAV.secretIndex,
      setSecretIndex: NAV.setSecretIndex,
      openFile: NAV.openFile,
      openNote: NAV.openNote,
      openOnMap: NAV.openOnMap,
      openCluster: NAV.openCluster,
      openSetting: NAV.openSetting,
      openSession: NAV.openSession,
      openNotif: NAV.openNotif,
      query: NAV.query,
      setQuery: NAV.setQuery,
      scope: NAV.scope,
      setScope: NAV.setScope,
      hits: NAV.hits,
      matchedFiles: NAV.matchedFiles,
      palette: NAV.palette,
      setPalette: NAV.setPalette,
      runHit: NAV.runHit,


      /* короткие сообщения */
      toast,
      flash,

      /* замок */
      lock: L.lock,
      lockEpoch: L.lockEpoch,
      fileKeysCount: L.fileKeysCount,
      setupLock: L.setupLock,
      changeMaster: L.changeMaster,
      disableLock: L.disableLock,
      lockNow: L.lockNow,
      unlock: L.unlock,
      completeUnlock: L.completeUnlock,
      setAutoLock: L.setAutoLock,
      resetLock: L.resetLock,
    }),
    [hydrated, D, S, N, L, E, NAV, toast, flash],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { CLUSTERS }
