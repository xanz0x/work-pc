'use client'

/* ============================================================
   СТОР · НАВИГАЦИЯ И ПОИСК (AR-1, шаг 3)
   Экран, фокусы и строка поиска — единственное состояние, которое не
   принадлежит ни одному домену данных. Раньше оно жило прямо в фасаде,
   и любой экран, читавший `useVault()`, перерисовывался от чужого тоста
   или уведомления. Теперь это отдельный домен: тяжёлые экраны (карта,
   библиотека) подписываются на него точечно.
   ============================================================ */

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
import type { ClusterId } from '../data'
import { searchAll, type Hit, type ScopeId, type SecretIndexItem } from '../search'
import { useRedacted } from '../redact-context'
import { useDataStore } from './data'
import { useLockStore } from './lock'
import { useNotifsStore } from './notifs'

export type ScreenId = 'library' | 'map' | 'chat' | 'vault' | 'settings'
export type Focus = { id: string; at: number } | null

export type NavCtx = {
  screen: ScreenId
  go: (screen: ScreenId) => void
  fileFocus: Focus
  noteFocus: Focus
  clusterFocus: Focus
  nodeFocus: Focus
  settingFocus: Focus
  secretFocus: Focus
  openFile: (fileId: string) => void
  openNote: (noteId: string) => void
  openOnMap: (fileId: string) => void
  openCluster: (cluster: ClusterId | 'all') => void
  openSetting: (id: string) => void
  openSecret: (id: string) => void
  openSession: (id: string) => void
  /** Открыть источник события и снять unread одним действием. */
  openNotif: (id: string) => void
  /** Индекс сейфа секретов для глобального поиска (заполняет SecretsProvider). */
  secretIndex: SecretIndexItem[]
  setSecretIndex: (list: SecretIndexItem[]) => void

  query: string
  setQuery: (q: string) => void
  scope: ScopeId
  setScope: (s: ScopeId) => void
  hits: Hit[]
  matchedFiles: Set<string>
  palette: boolean
  setPalette: (open: boolean) => void
  runHit: (h: Hit) => void
}

const Ctx = createContext<NavCtx | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const D = useDataStore()
  const N = useNotifsStore()
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

  const go = useCallback((next: ScreenId) => setScreen(next), [])

  const openFile = useCallback((fileId: string) => {
    setFileFocus({ id: fileId, at: Date.now() })
    setScreen('library')
  }, [])

  const openNote = useCallback((noteId: string) => {
    setNoteFocus({ id: noteId, at: Date.now() })
    setScreen('library')
  }, [])

  const fileById = D.fileById
  const openOnMap = useCallback(
    (fileId: string) => {
      const f = fileById(fileId)
      setNodeFocus({ id: fileId, at: Date.now() })
      setClusterFocus({ id: f?.cluster ?? 'all', at: Date.now() })
      setScreen('map')
    },
    [fileById],
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

  const setActiveSession = D.setActiveSession
  const openSession = useCallback(
    (id: string) => {
      setActiveSession(id)
      setScreen('chat')
    },
    [setActiveSession],
  )

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

  /** Клик по телу уведомления: лента снимает unread, а куда вести — знает навигация. */
  const readNotif = N.readNotif
  const openNotif = useCallback(
    (id: string) => {
      const n = readNotif(id)
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
    [readNotif],
  )

  /* ---------- поиск ---------- */

  /* Redact-слой: содержимое объектов под файловым ключом в поиск не попадает (п.10.2). */
  const { redactIds } = useRedacted()

  /* NF-1: содержимое из индексатора живёт в модульном сторе — подписываемся
     на его версию, чтобы поиск видел новый текст сразу после индексации. */
  const contentV = useSyncExternalStore(subscribeContent, contentVersion, () => 0)

  /* now читаем нереактивно (Date.now при пересчёте): давность в ранжировании
     не обязана обновляться каждую секунду, зато hits не churn'ятся на тик. */
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
  const liveNotes = D.liveNotes
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
    [liveNotes, openCluster, openFile, openSecret, openSession, openSetting],
  )

  /** Ctrl/Cmd+K — палитра. Работает на любом экране. */
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

  const value = useMemo<NavCtx>(
    () => ({
      screen,
      go,
      fileFocus,
      noteFocus,
      clusterFocus,
      nodeFocus,
      settingFocus,
      secretFocus,
      openFile,
      openNote,
      openOnMap,
      openCluster,
      openSetting,
      openSecret,
      openSession,
      openNotif,
      secretIndex,
      setSecretIndex,
      query,
      setQuery,
      scope,
      setScope,
      hits,
      matchedFiles,
      palette,
      setPalette,
      runHit,
    }),
    [
      screen, go, fileFocus, noteFocus, clusterFocus, nodeFocus, settingFocus, secretFocus,
      openFile, openNote, openOnMap, openCluster, openSetting, openSecret, openSession, openNotif,
      secretIndex, setSecretIndex, query, scope, hits, matchedFiles, palette, runHit,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNavStore(): NavCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNavStore вызван вне NavProvider')
  return v
}
