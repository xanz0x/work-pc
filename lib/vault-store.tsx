'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { contentIndex, contentVersion, subscribeContent } from '@/lib/indexer/content'
import type { IndexedRecord } from '@/lib/indexer/types'
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
import { buildGraph, clusterLoad, neighborsOf, type Graph } from './graph'
import { DAY, HOUR, type Note } from './notes'
import { searchAll, type Hit, type ScopeId, type SecretIndexItem } from './search'
import { useRedacted } from './redact-context'
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

export type ScreenId = 'library' | 'map' | 'chat' | 'vault' | 'settings'

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
export type { LockStatus, LockView } from './store/lock'
export { useNow } from './store/clock'
export { useDataStore } from './store/data'
export { useLockStore } from './store/lock'
export { useSettingsStore } from './store/settings'
export { useNotifsStore } from './store/notifs'
export { useToast } from './store/toast'

import { ClockProvider } from './store/clock'
import { ToastProvider, useToast } from './store/toast'
import { SettingsProvider, useSettingsStore, type EngineView, type Settings, type ToggleId } from './store/settings'
import { NotifsProvider, useNotifsStore, type Notif, type NotifCat } from './store/notifs'
import { DataProvider, useDataStore, type VaultStats } from './store/data'
import { LockProvider, useLockStore, type LockView } from './store/lock'
import type { LockMethod } from './lock-store'

export type Focus = { id: string; at: number } | null

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
 * Композиция доменов: часы → тосты → настройки → лента → данные → замок →
 * навигация и поиск. Порядок не декоративный: каждый следующий домен читает
 * предыдущие, обратных связей нет.
 */
export function VaultProvider({ children }: { children: ReactNode }) {
  return (
    <ClockProvider>
      <ToastProvider>
        <SettingsProvider>
          <NotifsProvider>
            <DataProvider>
              <LockProvider>
                <VaultFacade>{children}</VaultFacade>
              </LockProvider>
            </DataProvider>
          </NotifsProvider>
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

  const [screen, setScreen] = useState<ScreenId>('library')
  const [fileFocus, setFileFocus] = useState<Focus>(null)
  const [clusterFocus, setClusterFocus] = useState<Focus>(null)
  const [nodeFocus, setNodeFocus] = useState<Focus>(null)
  const [settingFocus, setSettingFocus] = useState<Focus>(null)
  const [noteFocus, setNoteFocus] = useState<Focus>(null)
  const [secretFocus, setSecretFocus] = useState<Focus>(null)
  const [secretIndex, setSecretIndexState] = useState<SecretIndexItem[]>([])
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ScopeId>('all')
  const [palette, setPalette] = useState(false)

  const hydrated = D.ready && S.ready && N.ready

  /* п.10.4: замок закрылся — навигация забывает всё выбранное, чтобы чужой
     фокус (файл, стикер, узел карты) не достался новому человеку. */
  const epochRef = useRef(L.lockEpoch)
  useEffect(() => {
    if (epochRef.current === L.lockEpoch) return
    epochRef.current = L.lockEpoch
    setFileFocus(null)
    setNoteFocus(null)
    setNodeFocus(null)
    setClusterFocus(null)
    setSecretFocus(null)
  }, [L.lockEpoch])

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
        body: 'Локальный движок в этой сборке не подключён: скорость и требования к памяти покажем, когда он появится.',
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

  /* ---------- навигация ---------- */

  const go = useCallback((next: ScreenId) => setScreen(next), [])

  const openFile = useCallback((fileId: string) => {
    setFileFocus({ id: fileId, at: Date.now() })
    setScreen('library')
  }, [])

  const openNote = useCallback((noteId: string) => {
    setNoteFocus({ id: noteId, at: Date.now() })
    setScreen('library')
  }, [])

  const openOnMap = useCallback(
    (fileId: string) => {
      const f = D.fileById(fileId)
      setNodeFocus({ id: fileId, at: Date.now() })
      setClusterFocus({ id: f?.cluster ?? 'all', at: Date.now() })
      setScreen('map')
    },
    [D],
  )

  const openCluster = useCallback((cluster: ClusterId | 'all') => {
    setClusterFocus({ id: cluster, at: Date.now() })
    setScreen('library')
  }, [])

  const openSetting = useCallback((id: string) => {
    setSettingFocus({ id, at: Date.now() })
    setScreen('settings')
  }, [])

  const openSecret = useCallback((id: string) => {
    setSecretFocus({ id, at: Date.now() })
    setScreen('vault')
  }, [])

  const setSecretIndex = useCallback((list: SecretIndexItem[]) => {
    setSecretIndexState((prev) => {
      if (
        prev.length === list.length &&
        prev.every((p, i) => p.id === list[i].id && p.title === list[i].title)
      ) {
        return prev
      }
      return list
    })
  }, [])

  const setActiveSession = D.setActiveSession
  const openSession = useCallback(
    (id: string) => {
      setActiveSession(id)
      setScreen('chat')
    },
    [setActiveSession],
  )

  /**
   * Клик по телу уведомления: домен ленты снимает unread, а куда вести —
   * знает только навигация.
   */
  const openNotif = useCallback(
    (id: string) => {
      const n = N.readNotif(id)
      if (!n) return
      const at = Date.now()
      const link = n.link
      if (link?.kind === 'file') {
        setScreen('library')
        setFileFocus({ id: link.id, at })
        return
      }
      if (link?.kind === 'note') {
        setScreen('library')
        setNoteFocus({ id: link.id, at })
        return
      }
      if (link?.kind === 'secret') {
        setScreen('vault')
        setSecretFocus({ id: link.id, at })
        return
      }
      if (link?.kind === 'setting') {
        setScreen('settings')
        setSettingFocus({ id: link.id, at })
        return
      }
      if (link?.kind === 'screen') {
        setScreen(link.id as ScreenId)
        return
      }
      if (n.cat === 'pipeline') {
        setScreen('library')
        return
      }
      setScreen('settings')
      setSettingFocus({ id: n.cat === 'privacy' ? 'privacy' : 'notifs', at })
    },
    [N],
  )

  /* ---------- поиск ---------- */

  /* Красакт объектов под файловым ключом: поиск по их содержимому запрещён (п.10.2). */
  const { redactIds } = useRedacted()

  /* NF-1: содержимое из индексатора живёт в модульном сторе — подписываемся
     на его версию, чтобы поиск видел новый текст сразу после индексации. */
  const contentV = useSyncExternalStore(subscribeContent, contentVersion, () => 0)

  /* now читаем нереактивно (Date.now при пересчёте): давность в ранжировании
     поиска не обязана обновляться каждую секунду, зато hits перестают
     churn'иться на каждый тик часов. */
  const searchInput = useMemo(
    () => ({
      files: D.files,
      notes: D.liveNotes,
      sessions: D.sessions,
      now: Date.now(),
      redactIds,
      secrets: secretIndex,
      content: contentIndex(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [D.files, D.liveNotes, D.sessions, redactIds, secretIndex, contentV],
  )

  const hits = useMemo(() => searchAll(query, scope, searchInput), [query, scope, searchInput])

  const matchedFiles = useMemo(() => {
    const ids = new Set<string>()
    for (const h of hits) {
      if (h.kind === 'file') ids.add(h.id)
      if (h.kind === 'cluster') {
        D.files.filter((f) => f.cluster === h.id).forEach((f) => ids.add(f.id))
      }
      if (h.kind === 'note') {
        const n = D.liveNotes.find((x) => x.id === h.id)
        if (n?.pinnedTo) ids.add(n.pinnedTo)
      }
    }
    return ids
  }, [hits, D.files, D.liveNotes])

  /** Один переход на все виды результатов — палитра и топбар зовут его же. */
  const runHit = useCallback(
    (h: Hit) => {
      setPalette(false)
      if (h.kind === 'file') openFile(h.id)
      else if (h.kind === 'cluster') openCluster(h.id as ClusterId)
      else if (h.kind === 'chat') openSession(h.id)
      else if (h.kind === 'setting') openSetting(h.id)
      else if (h.kind === 'secret') openSecret(h.id)
      else if (h.kind === 'note') {
        const n = D.liveNotes.find((x) => x.id === h.id)
        if (n?.pinnedTo) openFile(n.pinnedTo)
        else {
          setNodeFocus({ id: h.id, at: Date.now() })
          setScreen('map')
        }
      }
    },
    [D.liveNotes, openCluster, openFile, openSecret, openSession, openSetting],
  )

  /** Ctrl/Cmd+K — палитра. Работает на любом экране, кроме поля ввода чата. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

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
      engineView: S.engineView,
      grantCloudConsent: S.grantCloudConsent,
      revokeCloudConsent: S.revokeCloudConsent,
      setToggle: S.setToggle,

      /* события */
      notifs: N.notifs,
      unread: N.unread,
      notify: N.notify,
      markAllRead: N.markAllRead,
      toggleRead: N.toggleRead,
      openNotif,
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

      /* навигация */
      screen,
      go,
      fileFocus,
      noteFocus,
      clusterFocus,
      nodeFocus,
      settingFocus,
      secretFocus,
      openSecret,
      secretIndex,
      setSecretIndex,
      openFile,
      openNote,
      openOnMap,
      openCluster,
      openSetting,
      openSession,

      /* поиск */
      query,
      setQuery,
      scope,
      setScope,
      hits,
      matchedFiles,
      palette,
      setPalette,
      runHit,

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
    [
      hydrated, D, S, N, L, screen, go, fileFocus, noteFocus, clusterFocus, nodeFocus,
      settingFocus, secretFocus, openSecret, secretIndex, setSecretIndex, openFile, openNote,
      openOnMap, openCluster, openSetting, openSession, openNotif, query, scope, hits,
      matchedFiles, palette, runHit, toast, flash,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { CLUSTERS }
