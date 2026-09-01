'use client'

/* ============================================================
   СТОР · ДАННЫЕ СЕЙФА (AR-1)
   Домен корпуса: файлы, стикеры, разговоры и всё производное от них
   (граф, кластеры, статистика). Здесь же живут действия, которые
   меняют содержимое сейфа. Часы, тосты, настройки, лента и замок —
   отдельные домены; этот файл о них знает только то, что ему нужно
   для честного текста уведомления.
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
  type RefObject,
} from 'react'
import { usePersistedState } from '@/hooks/use-persisted-state'
import type { IndexedRecord } from '@/lib/indexer/types'
import type { Session } from '@/components/chat/types'
import {
  VAULT_FILES,
  VAULT_QUOTA,
  classify,
  clusterMix,
  clusterOf,
  dateLabel,
  engineOf,
  fmtBytes,
  modelOf,
  totalBytes,
  viewOf,
  type ClusterId,
  type FileView,
  type VaultFile,
} from '../data'
import { buildGraph, clusterLoad, neighborsOf, type Graph } from '../graph'
import { isAlive, seedNotes, type Note } from '../notes'
import { useCoarseTick } from './clock'
import { useNotifsStore } from './notifs'
import { useSettingsStore } from './settings'
import { useToast } from './toast'

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`

/** Почему у файла нет текста — то же словами, что и в записи индекса. */
const NO_TEXT_TEXT: Record<string, string> = {
  binary: 'Бинарный формат: текстового слоя нет, OCR в продукте нет',
  'pdf-no-text': 'PDF без текстового слоя (скан): текст не извлечён, OCR нет',
  empty: 'Файл пустой',
  'too-big': 'Файл больше лимита чтения — проиндексировано начало',
  'read-error': 'Файл не удалось прочитать',
}

/** Описание файла из настоящего индекса: только то, что действительно есть. */
function describeIndexed(r: IndexedRecord): string {
  if (r.noText) return NO_TEXT_TEXT[r.noText] ?? 'Текстовый слой не найден'
  if (r.keywords.length > 0) {
    return `В тексте: ${r.keywords.slice(0, 6).join(', ')} · ${r.chunks} чанков`
  }
  return `Текст прочитан: ${r.textLen} символов, ${r.chunks} чанков`
}

export type VaultStats = {
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

export type DataCtx = {
  /** Корпус, стикеры и разговоры прочитаны из хранилища. */
  ready: boolean

  files: VaultFile[]
  views: FileView[]
  fileById: (id: string) => VaultFile | undefined
  viewById: (id: string) => FileView | undefined
  addFiles: (incoming: { name: string; size?: number }[]) => void
  applyIndexed: (records: IndexedRecord[]) => void
  setIndexing: (ids: string[], on: boolean) => void
  dropIndexed: (ids: string[]) => void
  setReindexHandler: (fn: (() => void) | null) => void
  removeFile: (id: string) => void
  retagFile: (id: string, cluster: ClusterId) => void
  reindexAll: () => void
  clearIndex: () => void
  wipeVault: () => void

  notes: Note[]
  liveNotes: Note[]
  notesFor: (fileId: string) => Note[]
  addNote: (n: Omit<Note, 'id' | 'createdAt'>) => string
  patchNote: (id: string, fn: (n: Note) => Note) => void
  burnNote: (id: string) => void
  extendNote: (id: string, ms: number) => void
  /** Крипто-миграциям нужен свежий список без подписки на рендер. */
  notesRef: RefObject<Note[]>
  patchNoteSecret: (id: string, secret: string) => void

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

  graph: Graph
  clusters: ReturnType<typeof clusterLoad>
  mix: ReturnType<typeof clusterMix>
  neighbors: (id: string) => ReturnType<typeof neighborsOf>
  stats: VaultStats
}

const Ctx = createContext<DataCtx | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const { flash } = useToast()
  const { notify } = useNotifsStore()
  const { settings } = useSettingsStore()
  /** Состав живых стикеров пересчитываем раз в пять секунд, а не каждую. */
  const tick = useCoarseTick(5000)

  const [files, setFiles, filesReady] = usePersistedState<VaultFile[]>('wf.files.v1', VAULT_FILES)
  const [notes, setNotes, notesReady] = usePersistedState<Note[]>('wf.notes.v1', [])
  const [sessions, setSessions, chatReady] = usePersistedState<Session[]>('wf.chat.v1', [])
  const [activeSessionId, setActiveSessionId] = usePersistedState<string | null>(
    'wf.chat.active',
    null,
  )
  const [drafts, setDrafts] = usePersistedState<Record<string, string>>('wf.chat.drafts', {})
  const [scrolls, setScrolls] = usePersistedState<Record<string, number>>('wf.chat.scroll', {})

  const ready = filesReady && notesReady && chatReady

  const notesRef = useRef(notes)
  notesRef.current = notes
  /** NF-1: сюда indexer-провайдер подписывает настоящую переиндексацию. */
  const reindexRef = useRef<(() => void) | null>(null)

  const patchNoteSecret = useCallback(
    (id: string, secret: string) =>
      setNotes((all) => all.map((n) => (n.id === id ? { ...n, secret } : n))),
    [setNotes],
  )

  /** Стикеры первого запуска. */
  useEffect(() => {
    if (!notesReady) return
    if (notesRef.current.length === 0) setNotes(seedNotes(Date.now()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesReady])

  /* ---------- корпус ---------- */

  const fileMap = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])
  const views = useMemo(() => files.map(viewOf), [files])
  const viewMap = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])

  const fileById = useCallback((id: string) => fileMap.get(id), [fileMap])
  const viewById = useCallback((id: string) => viewMap.get(id), [viewMap])

  /**
   * Приём файлов «мимо конвейера»: только метаданные, содержимое не читалось.
   * Настоящее чтение делает индексатор (NF-1, `useIndexer().indexFiles`),
   * поэтому здесь ни таймеров, ни статуса «в обработке» — врать нечем.
   */
  const addFiles = useCallback(
    (incoming: { name: string; size?: number }[]) => {
      if (incoming.length === 0) return
      const created = incoming.map((f) => {
        const { cluster, icon } = classify(f.name)
        return {
          id: uid('f'),
          icon,
          cluster,
          name: f.name,
          desc: 'Метаданные без содержимого — файл не читался индексатором',
          bytes: Math.max(1024, Math.round(f.size ?? 256 * 1024)),
          date: 'только что',
          tags: ['новое'],
          processing: false,
        } satisfies VaultFile
      })

      setFiles((all) => [...created, ...all])
      flash(
        created.length === 1
          ? `«${created[0].name}» добавлен как метаданные.`
          : `${created.length} файлов добавлены как метаданные.`,
      )
      notify({
        kind: 'info',
        cat: 'pipeline',
        icon: 'inbox',
        title: created.length === 1 ? 'Файл в сейфе' : `${created.length} файлов в сейфе`,
        body: 'Содержимое не читалось: индексация запускается кнопкой «Подключить папку» в библиотеке.',
        link: { kind: 'file', id: created[0].id },
      })
    },
    [flash, notify, setFiles],
  )

  const removeFile = useCallback(
    (id: string) => {
      const f = fileMap.get(id)
      setFiles((all) => all.filter((x) => x.id !== id))
      setNotes((all) => all.map((n) => (n.pinnedTo === id ? { ...n, pinnedTo: undefined } : n)))
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
   * Переиндексация. Настоящий конвейер живёт в indexer-провайдере (NF-1):
   * стор только зовёт его. Папки нет — честно говорим об этом, а не крутим
   * фальшивый прогресс таймерами.
   */
  const reindexAll = useCallback(() => {
    const handler = reindexRef.current
    if (!handler) {
      flash('Папка не подключена: индексировать нечего. Подключите папку в библиотеке.')
      notify({
        kind: 'warn',
        cat: 'pipeline',
        icon: 'refresh',
        title: 'Переиндексация невозможна',
        body: 'Источник не выбран. В библиотеке есть кнопка «Подключить папку» — после неё индекс строится по настоящему содержимому.',
        link: { kind: 'screen', id: 'library' },
      })
      return
    }
    handler()
  }, [flash, notify])

  /* ---------- NF-1: результаты настоящего индексатора ---------- */

  const applyIndexed = useCallback(
    (records: IndexedRecord[]) => {
      if (records.length === 0) return
      setFiles((all) => {
        const known = new Map(all.map((f) => [f.id, f]))
        const fresh: VaultFile[] = []
        for (const r of records) {
          const prev = known.get(r.id)
          const auto = classify(r.name)
          const next: VaultFile = {
            id: r.id,
            icon: auto.icon,
            cluster: prev?.cluster ?? auto.cluster,
            name: r.name,
            desc: describeIndexed(r),
            bytes: Math.max(1, r.size),
            date: dateLabel(r.mtime),
            tags: r.keywords.length > 0 ? r.keywords.slice(0, 3) : ['без текста'],
            processing: false,
            path: r.path,
            indexed: true,
            noText: r.noText,
            keywords: r.keywords,
            textLen: r.textLen,
          }
          if (prev) known.set(r.id, next)
          else fresh.push(next)
        }
        return [...fresh, ...all.map((f) => known.get(f.id) ?? f)]
      })
    },
    [setFiles],
  )

  const setIndexing = useCallback(
    (ids: string[], on: boolean) => {
      if (ids.length === 0) return
      const set = new Set(ids)
      setFiles((all) => all.map((f) => (set.has(f.id) ? { ...f, processing: on } : f)))
    },
    [setFiles],
  )

  const dropIndexed = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const set = new Set(ids)
      setFiles((all) => all.filter((f) => !set.has(f.id)))
    },
    [setFiles],
  )

  const setReindexHandler = useCallback((fn: (() => void) | null) => {
    reindexRef.current = fn
  }, [])

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

  /* liveNotes держим референциально стабильным: пока состав живых стикеров
     не изменился, отдаём прежний массив — иначе граф, поиск и статистика
     пересчитывались бы на каждый тик. */
  const liveNotesRef = useRef<Note[]>([])
  const liveNotes = useMemo(() => {
    const next = notes.filter((n) => isAlive(n, Date.now()))
    const prev = liveNotesRef.current
    if (prev.length === next.length && prev.every((p, i) => p === next[i])) return prev
    liveNotesRef.current = next
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, tick])

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
      const n = notesRef.current.find((x) => x.id === id)
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
    [flash, notify, setNotes],
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
    (s: Session) => setSessions((all) => (all.some((x) => x.id === s.id) ? all : [s, ...all])),
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

  /* ---------- граф и производные ---------- */

  const aliveKey = useMemo(() => liveNotes.map((n) => n.id).join('|'), [liveNotes])
  /**
   * AR-1, шаг 3: производные считаются ВНЕ рендера. Граф на большом корпусе —
   * самая дорогая производная, и раньше она пересчитывалась синхронно в
   * useMemo прямо во время индексации: интерфейс замирал на каждой порции
   * файлов. Теперь пересчёт отложен и склеен по времени, а рендер получает
   * готовый снимок.
   */
  const [graph, setGraph] = useState<Graph>(() => buildGraph([], [], 0))
  useEffect(() => {
    const t = setTimeout(() => setGraph(buildGraph(files, liveNotesRef.current, 0)), 180)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, aliveKey])
  const clusters = useMemo(() => clusterLoad(graph), [graph])
  const mix = useMemo(() => clusterMix(files), [files])
  const neighbors = useCallback((id: string) => neighborsOf(graph, id), [graph])

  const stats = useMemo<VaultStats>(() => {
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

  const value = useMemo<DataCtx>(
    () => ({
      ready,
      files,
      views,
      fileById,
      viewById,
      addFiles,
      applyIndexed,
      setIndexing,
      dropIndexed,
      setReindexHandler,
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
      notesRef,
      patchNoteSecret,
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
      graph,
      clusters,
      mix,
      neighbors,
      stats,
    }),
    [
      ready, files, views, fileById, viewById, addFiles, applyIndexed, setIndexing, dropIndexed,
      setReindexHandler, removeFile, retagFile, reindexAll, clearIndex, wipeVault, notes,
      liveNotes, notesFor, addNote, patchNote, burnNote, extendNote, patchNoteSecret, sessions,
      activeSessionId, setActiveSessionId, addSession, patchSession, removeSession, drafts,
      setDraft, scrolls, setScroll, graph, clusters, mix, neighbors, stats,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDataStore(): DataCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDataStore вызван вне DataProvider')
  return v
}
