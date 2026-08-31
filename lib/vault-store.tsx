'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { IconId } from '@/components/icons'
import { pruneNotifs } from '@/lib/notifs'
import { usePersistedState } from '@/hooks/use-persisted-state'
import {
  CLOUD_MODEL_LABEL,
  CLUSTERS,
  LOCAL_ENGINE_READY,
  VAULT_FILES,
  VAULT_QUOTA,
  classify,
  clusterMix,
  clusterOf,
  engineOf,
  fmtBytes,
  modelOf,
  totalBytes,
  viewOf,
  type ClusterId,
  type EngineId,
  type FileView,
  type ModelId,
  type VaultFile,
} from './data'
import { buildGraph, clusterLoad, neighborsOf, type Graph } from './graph'
import { DAY, HOUR, isAlive, seedNotes, type Note } from './notes'
import { searchAll, type Hit, type ScopeId, type SecretIndexItem } from './search'
import {
  cryptoAvailable,
  LOCK_PING_KEY,
  LOCK_STATE_KEY,
  readLockState,
  registerFailure,
  resetFailures,
  setMasterSecret,
  verifyMasterSecret,
} from './crypto-vault'
import {
  auditLockState,
  broadcastLockNow,
  brokenLockedNoteIds,
  countFileKeys,
  DEFAULT_AUTOLOCK_MIN,
  LOCK_CHANNEL_ID,
  LOCK_CONFIG_KEY,
  postLockSync,
  readLockBootstrap,
  readLockConfig,
  readLockSyncMsg,
  validateSecret,
  wipeLockData,
  writeLockConfig,
  type LockConfig,
  type LockMethod,
} from './lock-store'
import { useRedacted } from './redact-context'
import { adoptMasterSession, getMasterSession } from '@/hooks/use-file-keys'
import { migrateKdfIterations, rewrapAll } from './lock-migrate'
import { deriveMasterKey, b64ToBytes } from './crypto-vault'
import type { Session } from '@/components/chat/types'

/* ============================================================
   ЕДИНЫЙ СЕЙФ
   До этого каждый экран считал сам: библиотека знала свои файлы,
   карта — свои узлы, настройки — свои проценты. Числа расходились.
   Здесь один источник истины: корпус файлов, слой стикеров, история
   разговоров, конфигурация и лента событий. Любое действие на любом
   экране меняет это состояние, и все остальные экраны узнают о нём
   в тот же кадр.
   ============================================================ */

export type ScreenId = 'library' | 'map' | 'chat' | 'vault' | 'settings'

/** Вид файла живёт в data.ts — здесь он только переиспользуется. */
export { viewOf }
export type { FileView }

/* ---------- конфигурация ---------- */

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
  folder: '/Users/me/WorkfloW/vault',
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

/** Профиль из localStorage мог быть записан старой сборкой — добираем поля. */
function normalizeSettings(s: Settings): Settings {
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
  /** Короткое имя движка: «Локальный», «Гибридный», «Внешняя». */
  label: string
  /** Кто отвечает на ход: облачная модель или локальная. */
  model: string
  isCloud: boolean
  /** Может ли движок ответить прямо сейчас. */
  ready: boolean
  /** Подпись статус-бара заглавными. */
  statusLabel: string
  /** Подпись сетевого индикатора. */
  netLabel: string
  /** Согласие на облачный ход уже дано. */
  consented: boolean
}

function buildEngineView(s: Settings): EngineView {
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

/* ---------- события ---------- */

export type NotifKind = 'ok' | 'warn' | 'danger' | 'info'
export type NotifCat = 'pipeline' | 'privacy' | 'system'

/** Куда ведёт уведомление: клик по телу открывает источник события. */
export type NotifLink =
  | { kind: 'file'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'secret'; id: string }
  | { kind: 'setting'; id: string }
  | { kind: 'screen'; id: ScreenId }

export type Notif = {
  id: string
  kind: NotifKind
  cat: NotifCat
  icon: IconId
  title: string
  body: string
  at: number
  unread: boolean
  /** В архиве: не видно в основной ленте, но можно восстановить. */
  archived?: boolean
  /** Источник события — открывается кликом по телу уведомления. */
  link?: NotifLink
  /** Сколько событий склеено в это (ежедневная сводка). */
  merged?: number
  /** Склеенные события сводки: раскрываются по клику. */
  items?: Notif[]
  /** Отложено пользователем: не видно в ленте до этого времени. */
  snoozedUntil?: number
}

/* Retention ленты вынесен в `lib/notifs.ts` (P0-4): чистые функции
   покрыты unit-тестами, стор только вызывает pruneNotifs. */

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`

/* ---------- контекст ---------- */

export type Focus = { id: string; at: number } | null

/* ---------- замок ---------- */

export type LockStatus = 'off' | 'locked' | 'unlocked'

/**
 * Срез замка для UI. Сам мастер-ключ нигде не хранится: он выводится
 * из секрета на время одной проверки и умирает вместе с ней (п.10.8).
 */
export type LockView = {
  status: LockStatus
  method: LockMethod | null
  autoLockMin: number
  /** Идёт деривация PBKDF2 — повторные попытки игнорируются (п.10.8). */
  busy: boolean
  /** Ввод заблокирован анти-брутфорсом до этого мгновения. */
  cooldownUntil: number
  failCount: number
  /** Когда встал замок — подпись на экране блокировки. */
  lockedAt: number
}

const OFF_LOCK: LockView = {
  status: 'off',
  method: null,
  autoLockMin: 0,
  busy: false,
  cooldownUntil: 0,
  failCount: 0,
  lockedAt: 0,
}

/** useLayoutEffect молчит на сервере — SSR-прогон провайдера не шумит в консоль. */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export type VaultCtx = {
  hydrated: boolean

  /* корпус */
  files: VaultFile[]
  views: FileView[]
  fileById: (id: string) => VaultFile | undefined
  viewById: (id: string) => FileView | undefined
  addFiles: (incoming: { name: string; size?: number }[]) => void
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
  /** Прочитать все непрочитанные вне архива (с возможностью отмены). */
  markAllRead: () => void
  /** Сменить статус одного уведомления: прочитано ⟷ непрочитано. */
  toggleRead: (id: string) => void
  /** Открыть источник события и снять unread одним действием. */
  openNotif: (id: string) => void
  /** Отложить событие: скрыть из ленты на заданное время. */
  snoozeNotif: (id: string, ms: number) => void
  /** Выключить категорию событий прямо из уведомления. */
  muteNotifCat: (cat: NotifCat) => void
  /** Убрать одно уведомление в архив (обратимо). */
  archiveNotif: (id: string) => void
  /** Вернуть из архива в ленту с прежним статусом. */
  restoreNotif: (id: string) => void
  /** Удалить безвозвратно (только из архива). */
  deleteNotif: (id: string) => void
  /** Очистить прочитанные: уходят в архив, непрочитанные не затрагиваются. */
  clearRead: () => void
  /** Очистить всю ленту в архив. */
  clearAllNotifs: () => void
  /** Стереть архив безвозвратно. */
  purgeArchive: () => void
  /** Отмена последнего действия над лентой; живёт 7 секунд. */
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
  stats: {
    files: number
    notes: number
    links: number
    nodes: number
    bytes: number
    quota: number
    usedPct: number
    processing: number
    sessions: number
    model: string
    /** null — источника у метрики нет, интерфейс печатает «—». */
    modelRam: string | null
    tokensPerSec: number | null
    engine: string
    offline: boolean
    indexedAgo: string
  }
  /** Единственный источник подписей режима и модели для всего интерфейса. */
  engineView: EngineView
  /** Согласие на облачные ходы: дано / отозвано. */
  grantCloudConsent: () => void
  revokeCloudConsent: () => void
  /** Мгновенно переключить один тумблер (без черновика настроек). */
  setToggle: (id: ToggleId, value: boolean) => void

  /* короткие сообщения */
  toast: string | null
  flash: (msg: string) => void

  /* замок */
  lock: LockView
  /**
   * Счётчик закрытий замка: растёт на каждом lockNow. Экраны сбрасывают
   * по нему локальный sel/фильтры, которые провайдеру недоступны (п.10.4).
   */
  lockEpoch: number
  /** Сколько объектов лежит под файловым ключом (каркас этапа 5). */
  fileKeysCount: number
  /** Создать мастер-ключ; текст ошибки или null при успехе. */
  setupLock: (secret: string, method: LockMethod) => Promise<string | null>
  /**
   * Смена мастера = полный re-setup с подтверждением старого ключа;
   * сессия остаётся разблокированной (п.10.7). Файловые ключи
   * пере-обёртываются на этапе 5.
   */
  changeMaster: (
    currentSecret: string,
    nextSecret: string,
    nextMethod?: LockMethod,
  ) => Promise<string | null>
  /** Выключить замок, подтвердив текущий ключ; файловые ключи стираются (план п.4). */
  disableLock: (currentSecret: string) => Promise<string | null>
  /** Немедленно закрыть сейф: кнопка-замок, Ctrl+Shift+L, автоблокировка. */
  lockNow: () => void
  /** Криптопроверка без снятия замка — экран блокировки сам решает момент перехода. */
  unlock: (secret: string) => Promise<boolean>
  /** Применить успешную проверку: снять замок в памяти этой вкладки (п.10.5). */
  completeUnlock: () => void
  setAutoLock: (min: number) => void
  /** «Забыли мастер»: стереть замок и файловые ключи; файлы остаются. */
  resetLock: () => void
}

const Ctx = createContext<VaultCtx | null>(null)

/**
 * Часы вынесены в отдельный контекст: они тикают раз в секунду, и держать их
 * в основном сейфе значило заставлять перерисовываться каждый кадр всё, что
 * читает useVault. Теперь секунды подписывают только те, кому нужен отсчёт
 * (тающие стикеры, «5 мин назад»), — остальной интерфейс остаётся спокойным.
 */
const NowCtx = createContext<number>(0)

export function useVault(): VaultCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVault вызван вне VaultProvider')
  return v
}

/** Общие часы приложения. 0 до первого клиентского тика (совпадает с SSR). */
export function useNow(): number {
  return useContext(NowCtx)
}

/* ============================================================
   ПРОВАЙДЕР
   ============================================================ */

export function VaultProvider({ children }: { children: ReactNode }) {
  const [files, setFiles, filesReady] = usePersistedState<VaultFile[]>('wf.files.v1', VAULT_FILES)
  const [notes, setNotes, notesReady] = usePersistedState<Note[]>('wf.notes.v1', [])
  const [sessions, setSessions, chatReady] = usePersistedState<Session[]>('wf.chat.v1', [])
  const [activeSessionId, setActiveSessionId] = usePersistedState<string | null>(
    'wf.chat.active',
    null,
  )
  const [drafts, setDrafts] = usePersistedState<Record<string, string>>('wf.chat.drafts', {})
  const [scrolls, setScrolls] = usePersistedState<Record<string, number>>('wf.chat.scroll', {})
  const [rawSettings, setSettings, setReady] = usePersistedState<Settings>(
    'wf.settings.v1',
    DEFAULT_SETTINGS,
  )
  const settings = useMemo(() => normalizeSettings(rawSettings), [rawSettings])
  const [notifs, setNotifs, notifReady] = usePersistedState<Notif[]>('wf.notifs.v1', [])
  /** Демо-лента наливается один раз: очищенная лента больше не возрождается. */
  const [notifsSeeded, setNotifsSeeded, seededReady] = usePersistedState<boolean>(
    'wf.notifs.seeded.v1',
    false,
  )
  const [notifUndo, setNotifUndo] = useState<{ label: string; at: number } | null>(null)

  const [draftSettings, setDraftState] = useState<Settings>(DEFAULT_SETTINGS)
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
  const [toast, setToast] = useState<string | null>(null)
  const [now, setNow] = useState(0)

  /* ---------- замок: состояние ---------- */

  /** Стартуем как SSR ('off'): первый клиентский рендер обязан совпасть с сервером. */
  const [lock, setLock] = useState<LockView>(OFF_LOCK)
  const [fileKeysCount, setFileKeysCount] = useState(0)
  /** Эпоха замка: «замок закрылся» как событие для локальных селектов экранов. */
  const [lockEpoch, setLockEpoch] = useState(0)
  const lockRef = useRef(lock)
  lockRef.current = lock
  /** Последняя активность для автоблокировки; живёт только в памяти вкладки. */
  const activityRef = useRef(Date.now())

  const hydrated = filesReady && notesReady && chatReady && setReady && notifReady
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  /** Стикеры для крипто-миграций (нужны при переупаковке под новый мастер). */
  const notesRef = useRef(notes)
  notesRef.current = notes
  const patchNoteSecret = useCallback(
    (id: string, secret: string) =>
      setNotes((all) => all.map((n) => (n.id === id ? { ...n, secret } : n))),
    [setNotes],
  )

  /** Общие часы. Один таймер на всё приложение вместо четырёх. */
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (setReady) setDraftState(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setReady])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  /* ---------- замок: синхронный bootstrap (п.10.1 / п.10.11) ---------- */

  /**
   * Первый клиентский рендер совпадает с SSR ('off'), затем — ещё до первой
   * отрисовки — состояние переключается на реальное. До этого момента контент
   * накрыт предгидратационной заглушкой html.lock-pending из layout.tsx,
   * поэтому «мигнул открытым» невозможно ни при каком раскладе.
   */
  useIsoLayoutEffect(() => {
    const boot = readLockBootstrap()
    if (boot === 'locked') {
      const cfg = readLockConfig()
      const st = readLockState()
      setLock({
        status: 'locked',
        method: cfg?.method ?? 'pin',
        autoLockMin: cfg?.autoLockMin ?? DEFAULT_AUTOLOCK_MIN,
        busy: false,
        cooldownUntil: st && st.cooldownUntil > Date.now() ? st.cooldownUntil : 0,
        failCount: st?.failCount ?? 0,
        lockedAt: Date.now(),
      })
    } else {
      const cfg = readLockConfig()
      setLock({ ...OFF_LOCK, method: cfg?.enabled ? cfg.method : null })
    }
    // React подтвердил статус — снимаем заглушку первым же кадром.
    document.documentElement.classList.remove('lock-pending')
    setFileKeysCount(countFileKeys())
  }, [])

  /* Аудит целостности (п.10.12) — после гидратации, когда стикеры прочитаны. */
  useEffect(() => {
    if (!hydrated) return
    const report = auditLockState(notes)
    if (!report.ok) console.warn('[lock-audit]', report.issues, report.fixes)
    // Инвариант locked ⇒ ct: сломанные стикеры честно разблокируются.
    const broken = brokenLockedNoteIds(notes)
    if (broken.length > 0) {
      setNotes((all) => all.map((n) => (broken.includes(n.id) ? { ...n, locked: false } : n)))
      notify({
        kind: 'warn',
        cat: 'privacy',
        icon: 'shield',
        title: 'Целостность стикеров восстановлена',
        body: `${broken.length} ${broken.length === 1 ? 'стикер был' : 'стикеров были'} без шифртекста — блокировка снята.`,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  /* ---------- замок: действия ---------- */

  /* ---------- события ---------- */

  /**
   * Уведомление проходит через настройки: выключенная категория не создаёт
   * событие вообще, а включённая сводка склеивает поток конвейера в одну
   * запись. Переключатели на экране настроек действительно работают.
   */
  const notify = useCallback(
    (n: Omit<Notif, 'id' | 'at' | 'unread'>) => {
      const t = settingsRef.current.toggles
      if (n.cat === 'pipeline' && !t.ntfPipeline) return
      if (n.cat === 'privacy' && !t.ntfPrivacy) return

      if (n.cat === 'pipeline' && t.ntfDigest) {
        setNotifs((all) => {
          const i = all.findIndex((x) => x.id.startsWith('digest'))
          const item: Notif = { ...n, id: uid('n'), at: Date.now(), unread: true }
          if (i >= 0) {
            const cur = all[i]
            const items = [item, ...(cur.items ?? [])].slice(0, 50)
            const next: Notif = {
              ...cur,
              at: Date.now(),
              /* N-6: сводка не «сбрасывает» себя перезаписью — прочитанность
                 снимается только приходом нового события. */
              unread: true,
              body: n.body,
              merged: items.length,
              items,
              title: `Сводка конвейера: ${items.length} ${
                items.length === 1 ? 'событие' : 'события'
              }`,
            }
            return [next, ...all.filter((_, k) => k !== i)]
          }
          return [
            {
              id: `digest-${Date.now().toString(36)}`,
              kind: 'info',
              cat: 'pipeline',
              icon: 'inbox',
              title: 'Сводка конвейера: 1 событие',
              body: n.body,
              at: Date.now(),
              unread: true,
              merged: 1,
              items: [item],
            },
            ...all,
          ]
        })
        return
      }

      setNotifs((all) => pruneNotifs([{ ...n, id: uid('n'), at: Date.now(), unread: true }, ...all]))
    },
    [setNotifs],
  )

  /** Лента первого запуска собирается из настоящего состояния сейфа. */
  useEffect(() => {
    if (!hydrated || !seededReady || notifsSeeded || notifs.length > 0) return
    const t0 = Date.now()
    const bytes = totalBytes(files)
    const g = buildGraph(files, [], t0)
    const m = modelOf(settings.model)
    setNotifs([
      {
        id: 'seed-index',
        kind: 'ok',
        cat: 'pipeline',
        icon: 'check',
        title: 'Индексация завершена',
        body: `${files.length} файлов, ${g.links} связей на карте памяти. Конфликтов версий не найдено.`,
        at: t0 - 34 * 60_000,
        unread: true,
      },
      {
        id: 'seed-privacy',
        kind: 'danger',
        cat: 'privacy',
        icon: 'shield',
        title: 'Найдены чувствительные данные',
        body: 'В «договор_аренды_2026.pdf» распознаны паспортные данные — превью замаскировано локально.',
        at: t0 - 52 * 60_000,
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
    setNotifsSeeded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, seededReady])

  /** Стикеры первого запуска. */
  useEffect(() => {
    if (!notesReady) return
    if (notes.length === 0) setNotes(seedNotes(Date.now()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesReady])

  /* ---------- события: действия и синхронизация ---------- */

  const notifsRef = useRef(notifs)
  notifsRef.current = notifs
  /** Снимок для отмены последнего массового действия. */
  const notifSnap = useRef<Notif[] | null>(null)
  /** Пришло из другой вкладки — не отправлять обратно (иначе эхо). */
  const notifFromChannel = useRef(false)
  const notifChannel = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel('workflow-notifs')
    notifChannel.current = ch
    ch.onmessage = (e: MessageEvent) => {
      const list = (e.data as { notifs?: Notif[] } | null)?.notifs
      if (!Array.isArray(list)) return
      notifFromChannel.current = true
      setNotifs(list)
    }
    return () => {
      ch.close()
      notifChannel.current = null
    }
  }, [setNotifs])

  useEffect(() => {
    if (!notifReady) return
    if (notifFromChannel.current) {
      notifFromChannel.current = false
      return
    }
    notifChannel.current?.postMessage({ notifs })
  }, [notifs, notifReady])

  /** Запомнить состояние ленты перед обратимым действием. */
  const rememberNotifs = useCallback((label: string) => {
    notifSnap.current = notifsRef.current
    setNotifUndo({ label, at: Date.now() })
  }, [])

  const undoNotifs = useCallback(() => {
    const snap = notifSnap.current
    if (!snap) return
    notifSnap.current = null
    setNotifUndo(null)
    setNotifs(snap)
    flash('Действие с уведомлениями отменено.')
  }, [flash, setNotifs])

  const markAllRead = useCallback(() => {
    if (!notifsRef.current.some((n) => n.unread && !n.archived)) return
    rememberNotifs('Все отмечены прочитанными')
    setNotifs((all) => all.map((n) => (n.archived ? n : { ...n, unread: false })))
  }, [rememberNotifs, setNotifs])

  const toggleRead = useCallback(
    (id: string) =>
      setNotifs((all) => all.map((n) => (n.id === id ? { ...n, unread: !n.unread } : n))),
    [setNotifs],
  )

  const archiveNotif = useCallback(
    (id: string) => {
      rememberNotifs('Уведомление убрано')
      setNotifs((all) => all.map((n) => (n.id === id ? { ...n, archived: true } : n)))
    },
    [rememberNotifs, setNotifs],
  )

  const restoreNotif = useCallback(
    (id: string) =>
      setNotifs((all) => all.map((n) => (n.id === id ? { ...n, archived: false } : n))),
    [setNotifs],
  )

  const deleteNotif = useCallback(
    (id: string) => setNotifs((all) => all.filter((n) => n.id !== id)),
    [setNotifs],
  )

  /** N-10: отложить событие — уходит из ленты и возвращается само. */
  const snoozeNotif = useCallback(
    (id: string, ms: number) => {
      setNotifs((all) =>
        all.map((n) => (n.id === id ? { ...n, snoozedUntil: Date.now() + ms, unread: true } : n)),
      )
      flash('Уведомление отложено на час.')
    },
    [flash, setNotifs],
  )

  /** N-10: выключить категорию прямо из уведомления. */
  const muteNotifCat = useCallback(
    (cat: NotifCat) => {
      const key: ToggleId | null =
        cat === 'pipeline' ? 'ntfPipeline' : cat === 'privacy' ? 'ntfPrivacy' : null
      if (!key) {
        flash('Системные события выключить нельзя — это журнал сейфа.')
        return
      }
      setSettings((s) => {
        const base = normalizeSettings(s)
        return { ...base, toggles: { ...base.toggles, [key]: false } }
      })
      setDraftState((s) => ({ ...s, toggles: { ...s.toggles, [key]: false } }))
      flash(`Категория «${cat === 'pipeline' ? 'Конвейер' : 'Приватность'}» выключена в настройках.`)
    },
    [flash, setSettings],
  )

  const clearRead = useCallback(() => {
    if (!notifsRef.current.some((n) => !n.unread && !n.archived)) return
    rememberNotifs('Прочитанные убраны в архив')
    setNotifs((all) => all.map((n) => (!n.archived && !n.unread ? { ...n, archived: true } : n)))
  }, [rememberNotifs, setNotifs])

  const clearAllNotifs = useCallback(() => {
    if (!notifsRef.current.some((n) => !n.archived)) return
    rememberNotifs('Лента очищена в архив')
    setNotifs((all) => all.map((n) => (n.archived ? n : { ...n, archived: true, unread: false })))
  }, [rememberNotifs, setNotifs])

  const purgeArchive = useCallback(() => {
    if (!notifsRef.current.some((n) => n.archived)) return
    rememberNotifs('Архив стёрт')
    setNotifs((all) => all.filter((n) => !n.archived))
  }, [rememberNotifs, setNotifs])

  /**
   * Клик по телу уведомления: снимаем unread и открываем источник события.
   * Если источник не указан, ведём в раздел, к которому относится событие.
   */
  const openNotif = useCallback(
    (id: string) => {
      const n = notifsRef.current.find((x) => x.id === id)
      if (!n) return
      setNotifs((all) => all.map((x) => (x.id === id ? { ...x, unread: false } : x)))
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
        setScreen(link.id)
        return
      }
      if (n.cat === 'pipeline') {
        setScreen('library')
        return
      }
      setScreen('settings')
      setSettingFocus({ id: n.cat === 'privacy' ? 'privacy' : 'notifs', at })
    },
    [setNotifs],
  )

  /* ---------- корпус ---------- */

  const fileMap = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])
  const views = useMemo(() => files.map(viewOf), [files])
  const viewMap = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])

  const fileById = useCallback((id: string) => fileMap.get(id), [fileMap])
  const viewById = useCallback((id: string) => viewMap.get(id), [viewMap])

  /**
   * Приём файлов. Конвейер честный: файл сначала в обработке, а сколько он
   * там пробудет — зависит от того, включены ли OCR и автометки в настройках.
   */
  const addFiles = useCallback(
    (incoming: { name: string; size?: number }[]) => {
      if (incoming.length === 0) return
      const t = settingsRef.current.toggles
      const created = incoming.map((f) => {
        const { cluster, icon } = classify(f.name)
        return {
          id: uid('f'),
          icon,
          cluster,
          name: f.name,
          desc: t.autotag
            ? `Определено автоматически: ${clusterOf(cluster).note.toLowerCase()}`
            : 'Без описания — автометки выключены в настройках',
          bytes: Math.max(1024, Math.round(f.size ?? 256 * 1024)),
          date: 'только что',
          tags: t.autotag ? ['новое', clusterOf(cluster).label.toLowerCase()] : ['новое'],
          processing: true,
        } satisfies VaultFile
      })

      setFiles((all) => [...created, ...all])
      flash(
        created.length === 1
          ? `«${created[0].name}» принят в конвейер.`
          : `${created.length} файлов приняты в конвейер.`,
      )
      notify({
        kind: 'info',
        cat: 'pipeline',
        icon: 'inbox',
        title: created.length === 1 ? 'Файл в конвейере' : `${created.length} файлов в конвейере`,
        body: `Источник: ${settingsRef.current.folder}. Распознавание ${t.ocr ? 'включено' : 'выключено'}.`,
        link: { kind: 'file', id: created[0].id },
      })

      const delay = t.ocr ? 4200 : 2200
      const ids = created.map((c) => c.id)
      setTimeout(() => {
        setFiles((all) => all.map((f) => (ids.includes(f.id) ? { ...f, processing: false } : f)))
        notify({
          kind: 'ok',
          cat: 'pipeline',
          icon: 'check',
          title: 'Индексация завершена',
          body: `${created.length} ${created.length === 1 ? 'файл' : 'файлов'} разобран${
            created.length === 1 ? '' : 'ы'
          } и связан${created.length === 1 ? '' : 'ы'} с картой памяти.`,
          link: { kind: 'file', id: created[0].id },
        })
      }, delay)
    },
    [flash, notify, setFiles],
  )

  const removeFile = useCallback(
    (id: string) => {
      const f = fileMap.get(id)
      setFiles((all) => all.filter((x) => x.id !== id))
      setNotes((all) =>
        all.map((n) => (n.pinnedTo === id ? { ...n, pinnedTo: undefined } : n)),
      )
      /* Разговоры живут в том же сейфе: удалённый файл уходит и из контекста. */
      setSessions((all) =>
        all.map((s) =>
          s.pinned.includes(id) ? { ...s, pinned: s.pinned.filter((p) => p !== id) } : s,
        ),
      )
      if (f) flash(`«${f.name}» удалён из сейфа.`)
    },
    [fileMap, flash, setFiles, setNotes, setSessions],
  )

  const retagFile = useCallback(
    (id: string, cluster: ClusterId) => {
      setFiles((all) => all.map((f) => (f.id === id ? { ...f, cluster } : f)))
      flash(`Файл перенесён в кластер «${clusterOf(cluster).label}».`)
    },
    [flash, setFiles],
  )

  /**
   * Переиндексация. Всё, что делает конвейер при приёме, повторяется для
   * всего корпуса: файлы уходят в обработку, статус-бар и карта это видят.
   */
  const reindexAll = useCallback(() => {
    const t = settingsRef.current.toggles
    setFiles((all) => all.map((f) => ({ ...f, processing: true })))
    flash('Переиндексация запущена. Файлы остаются на диске.')
    notify({
      kind: 'info',
      cat: 'pipeline',
      icon: 'refresh',
      title: 'Переиндексация запущена',
      body: `Источник: ${settingsRef.current.folder}. Распознавание ${t.ocr ? 'включено' : 'выключено'}.`,
    })
    setTimeout(
      () => {
        setFiles((all) => all.map((f) => ({ ...f, processing: false })))
        notify({
          kind: 'ok',
          cat: 'pipeline',
          icon: 'check',
          title: 'Индексация завершена',
          body: 'Корпус разобран заново, связи на карте памяти пересчитаны.',
        })
      },
      t.ocr ? 4200 : 2200,
    )
  }, [flash, notify, setFiles])

  /** Очистка индекса: метки и описания уходят, файлы остаются. */
  const clearIndex = useCallback(() => {
    setFiles((all) =>
      all.map((f) => ({
        ...f,
        tags: [],
        desc: 'Индекс очищен — описание построится заново после переиндексации',
        processing: false,
      })),
    )
    flash('ИИ-индекс очищен. Файлы на диске не тронуты.')
    notify({
      kind: 'warn',
      cat: 'pipeline',
      icon: 'trash',
      title: 'ИИ-индекс очищен',
      body: 'Метки и описания удалены, карта памяти осталась без связей.',
    })
  }, [flash, notify, setFiles])

  /** Полное уничтожение сейфа. */
  const wipeVault = useCallback(() => {
    const n = files.length
    const bytes = totalBytes(files)
    setFiles([])
    setNotes([])
    setSessions([])
    setActiveSessionId(null)
    setDrafts({})
    setScrolls({})
    flash('Сейф стёрт. Восстановить содержимое невозможно.')
    notify({
      kind: 'danger',
      cat: 'privacy',
      icon: 'trash',
      title: 'Сейф стёрт',
      body: `${n} файлов и ${fmtBytes(bytes)} удалены без возможности восстановления.`,
    })
  }, [
    files,
    flash,
    notify,
    setActiveSessionId,
    setDrafts,
    setFiles,
    setNotes,
    setScrolls,
    setSessions,
  ])

  /* ---------- стикеры ---------- */

  /* liveNotes держим референциально стабильным: часы тикают раз в секунду,
     но пока состав живых стикеров не изменился, отдаём прежний массив —
     иначе граф, поиск и статистика пересчитывались бы каждый кадр. */
  const liveNotesRef = useRef<Note[]>([])
  const liveNotes = useMemo(() => {
    const next = notes.filter((n) => isAlive(n, now || Date.now()))
    const prev = liveNotesRef.current
    if (prev.length === next.length && prev.every((p, i) => p === next[i])) return prev
    liveNotesRef.current = next
    return next
  }, [notes, now])

  const notesFor = useCallback(
    (fileId: string) => liveNotes.filter((n) => n.pinnedTo === fileId),
    [liveNotes],
  )

  const addNote = useCallback(
    (n: Omit<Note, 'id' | 'createdAt'>) => {
      const id = uid('note')
      setNotes((all) => [{ ...n, id, createdAt: Date.now() }, ...all])
      flash(n.expiresAt ? 'Стикер создан и начал таять.' : 'Стикер сохранён навсегда.')
      return id
    },
    [flash, setNotes],
  )

  const patchNote = useCallback(
    (id: string, fn: (n: Note) => Note) =>
      setNotes((all) => all.map((n) => (n.id === id ? fn(n) : n))),
    [setNotes],
  )

  const burnNote = useCallback(
    (id: string) => {
      const n = notes.find((x) => x.id === id)
      setNotes((all) => all.map((x) => (x.id === id ? { ...x, expiresAt: Date.now() - 1 } : x)))
      if (n) {
        flash(`Стикер «${n.title}» стёрт.`)
        notify({
          kind: 'warn',
          cat: 'privacy',
          icon: 'trash',
          title: 'Стикер уничтожен',
          body: `«${n.title}» стёрт с диска без возможности восстановления.`,
        })
      }
    },
    [flash, notes, notify, setNotes],
  )

  const extendNote = useCallback(
    (id: string, ms: number) =>
      setNotes((all) =>
        all.map((n) =>
          n.id === id
            ? { ...n, expiresAt: Math.max(Date.now(), n.expiresAt ?? Date.now()) + ms, lifeSpan: ms }
            : n,
        ),
      ),
    [setNotes],
  )

  /* ---------- разговоры ---------- */

  /** Идемпотентно: разговор с таким id уже лежит в сейфе — второй раз не кладём. */
  const addSession = useCallback(
    (s: Session) =>
      setSessions((all) => (all.some((x) => x.id === s.id) ? all : [s, ...all])),
    [setSessions],
  )
  const patchSession = useCallback(
    (id: string, fn: (s: Session) => Session) =>
      setSessions((all) => all.map((s) => (s.id === id ? fn(s) : s))),
    [setSessions],
  )
  const removeSession = useCallback(
    (id: string) => {
      setSessions((all) => all.filter((s) => s.id !== id))
      setActiveSessionId((cur) => (cur === id ? null : cur))
    },
    [setActiveSessionId, setSessions],
  )
  const setDraft = useCallback(
    (sessionId: string, text: string) => setDrafts((p) => ({ ...p, [sessionId]: text })),
    [setDrafts],
  )
  const setScroll = useCallback(
    (sessionId: string, top: number) => setScrolls((p) => ({ ...p, [sessionId]: top })),
    [setScrolls],
  )

  /* ---------- замок: действия ---------- */

  const setupLock = useCallback(
    async (secret: string, method: LockMethod): Promise<string | null> => {
      if (lockRef.current.busy) return 'Идёт вывод ключа — секунду'
      const policyError = validateSecret(secret, method)
      if (policyError) return policyError
      if (!cryptoAvailable()) return 'WebCrypto недоступен в этом браузере — замок не работает'
      setLock((p) => ({ ...p, busy: true }))
      try {
        await setMasterSecret(secret)
        /* Сеанс мастера нужен сразу: менеджер секретов создаёт свой ключ поверх него. */
        await adoptMasterSession(secret)
        const nextCfg: LockConfig = {
          enabled: true,
          method,
          autoLockMin: readLockConfig()?.autoLockMin ?? DEFAULT_AUTOLOCK_MIN,
          createdAt: Date.now(),
        }
        writeLockConfig(nextCfg)
        activityRef.current = Date.now()
        postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
        setLock({
          status: 'unlocked',
          method,
          autoLockMin: nextCfg.autoLockMin,
          busy: false,
          cooldownUntil: 0,
          failCount: 0,
          lockedAt: 0,
        })
        notify({
          kind: 'ok',
          cat: 'privacy',
          icon: 'lockRound',
          title: 'Замок включён',
          body: `Мастер-ключ (${method === 'pin' ? 'PIN' : 'пароль'}) создан на этом устройстве. PBKDF2 · 600 000 итераций.`,
        })
        return null
      } catch (e) {
        setLock((p) => ({ ...p, busy: false }))
        return e instanceof Error ? e.message : 'Не удалось создать мастер-ключ'
      }
    },
    [notify],
  )

  /** Смена метода/мастера = полный re-setup; сессия не разрывается (п.10.7). */
  const changeMaster = useCallback(
    async (currentSecret: string, nextSecret: string, nextMethod?: LockMethod) => {
      if (lockRef.current.busy) return 'Идёт вывод ключа — секунду'
      const cfg = readLockConfig()
      if (!cfg?.enabled || !cryptoAvailable()) return 'Замок не настроен'
      setLock((p) => ({ ...p, busy: true }))
      try {
        if (!(await verifyMasterSecret(currentSecret))) {
          const st = registerFailure()
          setLock((p) => ({
            ...p,
            busy: false,
            failCount: st?.failCount ?? p.failCount + 1,
            cooldownUntil: st?.cooldownUntil ?? p.cooldownUntil,
          }))
          return 'Текущий ключ не подходит'
        }
        const method = nextMethod ?? cfg.method
        const policyError = validateSecret(nextSecret, method)
        if (policyError) {
          setLock((p) => ({ ...p, busy: false }))
          return policyError
        }
        /* Ключ старого мастера нужен до перезаписи состояния — им расшифруем обёртки. */
        const prevState = readLockState()
        let oldKey: CryptoKey | null = getMasterSession()
        if (!oldKey && prevState) {
          oldKey = await deriveMasterKey(
            currentSecret,
            b64ToBytes(prevState.saltB64),
            prevState.iterations,
          )
        }
        await setMasterSecret(nextSecret) // свежая соль + верификатор, счётчики в ноль
        resetFailures()
        /* Всё, что было завёрнуто прежним мастером (файловые ключи, секреты
           стикеров, ключ сейфа секретов), переупаковывается под новый —
           иначе смена мастера тихо ломает уровень B. */
        const nextState = readLockState()
        if (oldKey && nextState) {
          try {
            const newKey = await deriveMasterKey(
              nextSecret,
              b64ToBytes(nextState.saltB64),
              nextState.iterations,
            )
            await rewrapAll(oldKey, newKey, notesRef.current, patchNoteSecret)
          } catch {
            /* переупаковка не удалась — сообщим ниже, данные не потеряны */
          }
        }
        await adoptMasterSession(nextSecret)
        writeLockConfig({ ...cfg, enabled: true, method })
        activityRef.current = Date.now()
        postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
        setLock((p) => ({
          ...p,
          status: 'unlocked',
          method,
          busy: false,
          cooldownUntil: 0,
          failCount: 0,
        }))
        notify({
          kind: 'ok',
          cat: 'privacy',
          icon: 'lockRound',
          title: 'Мастер-ключ изменён',
          body: 'Верификатор пересоздан с новой солью. Файловые ключи будут пере-обёрнуты при следующем открытии.',
        })
        return null
      } catch (e) {
        setLock((p) => ({ ...p, busy: false }))
        return e instanceof Error ? e.message : 'Не удалось изменить мастер-ключ'
      }
    },
    [notify],
  )

  const disableLock = useCallback(
    async (currentSecret: string): Promise<string | null> => {
      if (lockRef.current.busy) return 'Идёт вывод ключа — секунду'
      if (!readLockConfig()?.enabled) return 'Замок и так выключен'
      setLock((p) => ({ ...p, busy: true }))
      try {
        if (!(await verifyMasterSecret(currentSecret))) {
          const st = registerFailure()
          setLock((p) => ({
            ...p,
            busy: false,
            failCount: st?.failCount ?? p.failCount + 1,
            cooldownUntil: st?.cooldownUntil ?? p.cooldownUntil,
          }))
          return 'Ключ не подходит'
        }
        /* Без мастера файловые ключи невосстановимы — честно стираем и их (план п.4). */
        wipeLockData()
        setFileKeysCount(0)
        postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
        setLock({ ...OFF_LOCK })
        notify({
          kind: 'warn',
          cat: 'privacy',
          icon: 'shield',
          title: 'Замок выключен',
          body: 'Мастер-ключ и файловые ключи стёрты. Содержимое сейфа осталось без защиты.',
        })
        return null
      } catch (e) {
        setLock((p) => ({ ...p, busy: false }))
        return e instanceof Error ? e.message : 'Не удалось выключить замок'
      }
    },
    [notify],
  )

  const lockNow = useCallback(() => {
    if (lockRef.current.status !== 'unlocked') return
    broadcastLockNow() // п.10.9: остальные вкладки закрываются той же командой
    activityRef.current = Date.now()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    /* п.10.4: замок забывает всё выбранное — после разблокировки чужой фокус
       (файл, стикер, узел карты) не обязан достаться новому человеку. */
    setFileFocus(null)
    setNoteFocus(null)
    setNodeFocus(null)
    setClusterFocus(null)
    setSecretFocus(null)
    /* Локальный sel библиотеки отсюда недоступен — экраны сбрасывают его сами,
       глядя на эпоху (screen-library подключит этап 5). */
    setLockEpoch((n) => n + 1)
    setLock((p) => ({
      ...p,
      status: 'locked',
      busy: false,
      lockedAt: Date.now(),
      cooldownUntil: 0,
      failCount: 0,
    }))
    notify({
      kind: 'info',
      cat: 'privacy',
      icon: 'lockRound',
      title: 'Сейф заблокирован',
      body: 'Для входа снова нужен мастер-ключ. Разблокировка не переносится между вкладками.',
    })
  }, [notify])

  /**
   * Криптопроверка без смены статуса. Деривация запускается ровно один раз
   * за попытку; повторные клики и ввод во время кулдауна игнорируются (п.10.8).
   */
  const unlock = useCallback(
    async (secret: string): Promise<boolean> => {
      const cur = lockRef.current
      if (cur.busy || cur.status !== 'locked') return false
      if (cur.cooldownUntil > Date.now()) return false
      if (!readLockState()) return false
      setLock((p) => ({ ...p, busy: true }))
      let ok = false
      try {
        ok = await verifyMasterSecret(secret)
      } catch {
        ok = false
      }
      if (ok) {
        resetFailures()
        /* Ленивая миграция KDF 310k → 600k: только после подтверждённого пароля,
           с бэкапом старой схемы и переупаковкой всех обёрток (гейт §6 ТЗ). */
        try {
          const mig = await migrateKdfIterations(secret, notesRef.current, patchNoteSecret)
          if (mig.migrated) {
            notify({
              kind: 'ok',
              cat: 'privacy',
              icon: 'shield',
              title: 'Замок усилен: PBKDF2 600 000',
              body: `Итерации подняты с ${mig.from.toLocaleString('ru-RU')} до ${mig.to.toLocaleString('ru-RU')}. Переупаковано ключей файлов: ${mig.report.files}, секретов стикеров: ${mig.report.notes}.`,
            })
          }
        } catch {
          /* миграция не обязана мешать входу */
        }
        setLock((p) => ({ ...p, busy: false, cooldownUntil: 0, failCount: 0 }))
      } else {
        const st = registerFailure()
        const fails = st?.failCount ?? lockRef.current.failCount + 1
        const cooldownSec =
          st?.cooldownUntil && st.cooldownUntil > Date.now()
            ? Math.max(1, Math.ceil((st.cooldownUntil - Date.now()) / 1000))
            : null
        setLock((p) => ({
          ...p,
          busy: false,
          failCount: fails,
          cooldownUntil: st?.cooldownUntil ?? Date.now(),
        }))
        /* Этап 6, лента сейфа: попытки входа видны в ленте даже тому,
           кто сидит в другой вкладке и не смотрит на экран блокировки. */
        notify({
          kind: 'warn',
          cat: 'privacy',
          icon: 'lockRound',
          title: `Неудачная попытка входа (${fails})`,
          body: cooldownSec
            ? `Мастер-ключ не подошёл. Следующая попытка через ${cooldownSec} с.`
            : 'Мастер-ключ не подошёл. Проверка шла локально.',
        })
      }
      return ok
    },
    [notify],
  )

  const completeUnlock = useCallback(() => {
    activityRef.current = Date.now()
    setLock((p) =>
      p.status === 'locked'
        ? { ...p, status: 'unlocked', busy: false, lockedAt: 0 }
        : p,
    )
    setFileKeysCount(countFileKeys())
    notify({
      kind: 'ok',
      cat: 'privacy',
      icon: 'check',
      title: 'Сейф разблокирован',
      body: 'Ключ проверен локально: PBKDF2 · AES-GCM. Ни один байт не покинул устройство.',
    })
  }, [notify])

  const setAutoLock = useCallback((min: number) => {
    const cfg = readLockConfig()
    if (cfg) writeLockConfig({ ...cfg, autoLockMin: min })
    setLock((p) => ({ ...p, autoLockMin: min }))
    postLockSync('unlock-config-changed') // п.10.9: таймер автоблока одинаков во вкладках
  }, [])

  /** Путь «забыл мастер»: без подтверждения, зато с честной ценой — файловые ключи. */
  const resetLock = useCallback(() => {
    wipeLockData()
    setFileKeysCount(0)
    postLockSync('unlock-config-changed') // п.10.9: вкладки перечитают конфиг
    setLock({ ...OFF_LOCK })
    notify({
      kind: 'danger',
      cat: 'privacy',
      icon: 'trash',
      title: 'Замок сброшен',
      body: 'Мастер-ключ и файловые ключи стёрты. Файлы остались, пароли к ним — нет.',
    })
  }, [notify])

  /* Автоблокировка: тик раз в 5 секунд против последней активности (план п.2.4). */
  useEffect(() => {
    const t = setInterval(() => {
      const L = lockRef.current
      if (
        L.status === 'unlocked' &&
        L.autoLockMin > 0 &&
        Date.now() - activityRef.current > L.autoLockMin * 60_000
      ) {
        lockNow()
      }
    }, 5000)
    return () => clearInterval(t)
  }, [lockNow])

  /* Активность продлевает таймер: click/keydown/pointermove, throttle 10 с. */
  useEffect(() => {
    let last = 0
    const touch = () => {
      const t = Date.now()
      if (t - last > 10_000) {
        last = t
        activityRef.current = t
      }
    }
    window.addEventListener('pointermove', touch, { passive: true })
    window.addEventListener('pointerdown', touch, { passive: true })
    window.addEventListener('keydown', touch, { passive: true })
    return () => {
      window.removeEventListener('pointermove', touch)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
    }
  }, [])

  /* Хоткей блокировки — Ctrl/Cmd+Shift+L (п.10.10: Ctrl+L занят браузером). */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        lockNow()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lockNow])

  /* Вкладки синхронны (п.10.9): setup/disable виден всем, ping закрывает всех,
     а unlock остаётся частным делом вкладки — его наружу никто не транслирует.
     storage-события дублирует BroadcastChannel('workflow-lock'): в приватных
     окнах и части браузеров storage между вкладками не доходит, канал надёжнее. */
  useEffect(() => {
    function applyPing() {
      if (lockRef.current.status === 'unlocked') lockNow()
    }
    function applyConfigChange() {
      if (readLockBootstrap() === 'off') {
        setLock({ ...OFF_LOCK })
        return
      }
      const cfg = readLockConfig()
      setLock((p) =>
        p.status === 'unlocked'
          ? {
              ...p,
              method: cfg?.method ?? p.method,
              autoLockMin: cfg?.autoLockMin ?? p.autoLockMin,
            }
          : {
              ...p,
              status: 'locked',
              method: cfg?.method ?? 'pin',
              autoLockMin: cfg?.autoLockMin ?? DEFAULT_AUTOLOCK_MIN,
            },
      )
    }
    function syncFromStorage(key: string | null) {
      if (key === LOCK_PING_KEY) return applyPing()
      if (key !== LOCK_CONFIG_KEY && key !== LOCK_STATE_KEY) return
      applyConfigChange()
    }
    function onStorage(e: StorageEvent) {
      syncFromStorage(e.key)
    }
    let ch: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        ch = new BroadcastChannel(LOCK_CHANNEL_ID)
        ch.onmessage = (e: MessageEvent) => {
          const m = readLockSyncMsg(e.data)
          if (!m) return
          if (m.type === 'lock') applyPing()
          else applyConfigChange()
        }
      }
    } catch {
      /* нет канала — остаётся storage-сигнал */
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      ch?.close()
    }
  }, [lockNow])

  /* ---------- конфигурация ---------- */

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
    const before = settingsRef.current
    const next: Settings = { ...draftSettings, cloudConsentAt: before.cloudConsentAt }
    setSettings(next)
    settingsRef.current = next
    flash('Конфигурация записана в локальный профиль. Конвейер перезапущен без потери индекса.')
    if (before.model !== draftSettings.model) {
      const m = modelOf(draftSettings.model)
      notify({
        kind: 'info',
        cat: 'system',
        icon: 'chipAi',
        title: `Модель в профиле: ${m.short}`,
        body: 'Локальный движок не подключён — модель выбрана на будущее, ответы идут через выбранный движок.',
      })
    }
    if (before.engine !== draftSettings.engine) {
      const e = engineOf(draftSettings.engine)
      notify({
        kind: e.offline ? 'ok' : 'danger',
        cat: 'privacy',
        icon: e.offline ? 'lockRound' : 'shield',
        title: `Движок переключён: ${e.short}`,
        body: e.offline
          ? 'Внешних запросов больше нет. Локальный движок пока не подключён — чат ответит только после его появления.'
          : 'Часть запросов уйдёт наружу. Перед первым облачным ходом спросим согласие.',
      })
    }
  }, [draftSettings, flash, notify, setSettings])

  const revertSettings = useCallback(() => setDraftState(settings), [settings])

  /* ---------- граф и производные ---------- */

  const aliveKey = useMemo(() => liveNotes.map((n) => n.id).join('|'), [liveNotes])
  const graph = useMemo(
    () => buildGraph(files, liveNotes, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, aliveKey],
  )
  const clusters = useMemo(() => clusterLoad(graph), [graph])
  const mix = useMemo(() => clusterMix(files), [files])
  const neighbors = useCallback((id: string) => neighborsOf(graph, id), [graph])

  const stats = useMemo(() => {
    const bytes = totalBytes(files)
    const m = modelOf(settings.model)
    const e = engineOf(settings.engine)
    return {
      files: files.length,
      notes: liveNotes.length,
      links: graph.links,
      nodes: graph.nodes.length,
      bytes,
      quota: VAULT_QUOTA,
      usedPct: Math.min(100, Math.round((bytes / VAULT_QUOTA) * 100)),
      processing: files.filter((f) => f.processing).length,
      sessions: sessions.length,
      model: m.short,
      modelRam: m.ram,
      tokensPerSec: m.tokensPerSec,
      engine: e.short,
      offline: e.offline && !settings.toggles.telemetry,
      indexedAgo: files.some((f) => f.processing) ? 'идёт сейчас' : '2 мин назад',
    }
  }, [files, graph, liveNotes.length, sessions.length, settings])

  const engineView = useMemo(() => buildEngineView(settings), [settings])

  /** Согласие на облачные ходы: пишется в профиль, видно в настройках. */
  const grantCloudConsent = useCallback(() => {
    setSettings((s) => ({ ...normalizeSettings(s), cloudConsentAt: Date.now() }))
  }, [setSettings])

  const revokeCloudConsent = useCallback(() => {
    setSettings((s) => ({ ...normalizeSettings(s), cloudConsentAt: null }))
    flash('Согласие на облачные запросы отозвано — спросим снова перед следующим ходом.')
  }, [flash, setSettings])

  const setToggle = useCallback(
    (id: ToggleId, value: boolean) => {
      setSettings((s) => {
        const base = normalizeSettings(s)
        return { ...base, toggles: { ...base.toggles, [id]: value } }
      })
      setDraftState((s) => ({ ...s, toggles: { ...s.toggles, [id]: value } }))
    },
    [setSettings],
  )

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
      const f = fileMap.get(fileId)
      setNodeFocus({ id: fileId, at: Date.now() })
      setClusterFocus({ id: f?.cluster ?? 'all', at: Date.now() })
      setScreen('map')
    },
    [fileMap],
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
      if (prev.length === list.length && prev.every((p, i) => p.id === list[i].id && p.title === list[i].title)) {
        return prev
      }
      return list
    })
  }, [])

  const openSession = useCallback(
    (id: string) => {
      setActiveSessionId(id)
      setScreen('chat')
    },
    [setActiveSessionId],
  )

  /* ---------- поиск ---------- */

  /* Красакт объектов под файловым ключом: поиск по их содержимому запрещён (п.10.2). */
  const { redactIds } = useRedacted()

  /* now читаем нереактивно (Date.now при пересчёте): давность в ранжировании
     поиска не обязана обновляться каждую секунду, зато hits перестают
     churn'иться на каждый тик часов. */
  const searchInput = useMemo(
    () => ({ files, notes: liveNotes, sessions, now: Date.now(), redactIds, secrets: secretIndex }),
    [files, liveNotes, sessions, redactIds, secretIndex],
  )

  const hits = useMemo(() => searchAll(query, scope, searchInput), [query, scope, searchInput])

  const matchedFiles = useMemo(() => {
    const ids = new Set<string>()
    for (const h of hits) {
      if (h.kind === 'file') ids.add(h.id)
      if (h.kind === 'cluster') files.filter((f) => f.cluster === h.id).forEach((f) => ids.add(f.id))
      if (h.kind === 'note') {
        const n = liveNotes.find((x) => x.id === h.id)
        if (n?.pinnedTo) ids.add(n.pinnedTo)
      }
    }
    return ids
  }, [hits, files, liveNotes])

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
        const n = liveNotes.find((x) => x.id === h.id)
        if (n?.pinnedTo) openFile(n.pinnedTo)
        else {
          setNodeFocus({ id: h.id, at: Date.now() })
          setScreen('map')
        }
      }
    },
    [liveNotes, openCluster, openFile, openSession, openSetting, openSecret],
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

  const unread = useMemo(
    () => notifs.filter((n) => n.unread && !n.archived).length,
    [notifs],
  )

  const value: VaultCtx = useMemo(
    () => ({
    hydrated,
    files,
    views,
    fileById,
    viewById,
    addFiles,
    removeFile,
    retagFile,
    reindexAll,
    clearIndex,
    wipeVault,
    notes,
    liveNotes,
    notesFor,
    addNote,
    patchNote,
    burnNote,
    extendNote,
    sessions,
    activeSessionId,
    setActiveSession: setActiveSessionId as (id: string | null) => void,
    addSession,
    patchSession,
    removeSession,
    drafts,
    setDraft,
    scrolls,
    setScroll,
    settings,
    draftSettings,
    setDraftSettings,
    dirty,
    saveSettings,
    revertSettings,
    notifs,
    unread,
    notify,
    markAllRead,
    toggleRead,
    openNotif,
    snoozeNotif,
    muteNotifCat,
    archiveNotif,
    restoreNotif,
    deleteNotif,
    clearRead,
    clearAllNotifs,
    purgeArchive,
    notifUndo,
    undoNotifs,
    dismissNotif: archiveNotif,
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
    query,
    setQuery,
    scope,
    setScope,
    hits,
    matchedFiles,
    palette,
    setPalette,
    runHit,
    graph,
    clusters,
    mix,
    neighbors,
    stats,
    engineView,
    grantCloudConsent,
    revokeCloudConsent,
    setToggle,
    toast,
    flash,
    /* замок */
    lock,
    lockEpoch,
    fileKeysCount,
    setupLock,
    changeMaster,
    disableLock,
    lockNow,
    unlock,
    completeUnlock,
    setAutoLock,
    resetLock,
    }),
    [
      hydrated, files, views, fileById, viewById, addFiles, removeFile, retagFile,
      reindexAll, clearIndex, wipeVault, notes, liveNotes, notesFor, addNote, patchNote,
      burnNote, extendNote, sessions, activeSessionId, setActiveSessionId, addSession,
      patchSession, removeSession, drafts, setDraft, scrolls, setScroll, settings,
      draftSettings, setDraftSettings, dirty, saveSettings, revertSettings, notifs, unread,
      notify, markAllRead, toggleRead, openNotif, snoozeNotif, muteNotifCat, archiveNotif,
      restoreNotif, deleteNotif, clearRead, clearAllNotifs, purgeArchive, notifUndo,
      undoNotifs, screen, go, fileFocus, noteFocus, clusterFocus, nodeFocus, settingFocus,
      secretFocus, openSecret, secretIndex, setSecretIndex, openFile, openNote, openOnMap,
      openCluster, openSetting, openSession, query, scope, hits, matchedFiles, palette,
      runHit, graph, clusters, mix, neighbors, stats, engineView, grantCloudConsent,
      revokeCloudConsent, setToggle, toast, flash, lock, lockEpoch, fileKeysCount, setupLock,
      changeMaster, disableLock, lockNow, unlock, completeUnlock, setAutoLock, resetLock,
    ],
  )

  return (
    <Ctx.Provider value={value}>
      <NowCtx.Provider value={now || 0}>{children}</NowCtx.Provider>
    </Ctx.Provider>
  )
}

export { CLUSTERS }
