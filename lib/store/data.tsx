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
import { isAlive, type Note } from '../notes'
import { logJournal } from '../journal'
import { trackAction } from '../telemetry'
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

/* ---------- UX-5: демо-режим ----------
   Показательный корпус живёт отдельным модулем (lib/demo-seed.ts) и
   грузится динамическим import() только тогда, когда сейф пуст и демо
   ещё не отключали. Отметка о посеве и отказе — в localStorage. */

const DEMO_KEY = 'wf.demo.v1'

type DemoState = {
  /** Демо уже сеяли: второй раз не подмешиваем даже в пустой сейф. */
  seeded: boolean
  /** Человек нажал «Начать с чистого сейфа». */
  dismissed: boolean
}

const DEMO_OFF: DemoState = { seeded: false, dismissed: false }

export type DemoView = {
  /** В сейфе прямо сейчас лежат демо-объекты. */
  active: boolean
  /** Сколько демо-объектов: файлы + стикеры + разговоры. */
  count: number
  files: number
  notes: number
  sessions: number
  dismissed: boolean
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
  /** NF-5: правка порции файлов одной записью — без тоста на каждый объект. */
  bulkPatchFiles: (ids: string[], fn: (f: VaultFile) => VaultFile) => void
  /** NF-5: удаление порции файлов; отмена делается restoreFiles. */
  bulkRemoveFiles: (ids: string[]) => void
  /** NF-5: вернуть снятые файлы обратно в сейф (окно отмены). */
  restoreFiles: (list: VaultFile[]) => void
  /** NF-5: правка порции стикеров одной записью. */
  bulkPatchNotes: (ids: string[], fn: (n: Note) => Note) => void
  reindexAll: () => void
  clearIndex: () => void
  wipeVault: () => void
  /** UX-5: состояние демо-режима — баннер и плашки читают его. */
  demo: DemoView
  /** UX-5: убрать демо-объекты, не трогая пользовательские. */
  clearDemo: () => void

  /** NF-11: движок синхронизации подменяет корпус целиком слитым состоянием. */
  replaceFiles: (list: VaultFile[]) => void
  replaceNotes: (list: Note[]) => void

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

  const [files, setFiles, filesReady] = usePersistedState<VaultFile[]>('wf.files.v1', [])
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

  /** UX-5: демо-объекты первого запуска — отдельным модулем и одним решением. */
  const [demoState, setDemoState, demoReady] = usePersistedState<DemoState>(
    DEMO_KEY,
    DEMO_OFF,
    (_prev, local) => local,
  )
  const filesRef = useRef(files)
  filesRef.current = files
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  useEffect(() => {
    if (!demoReady || !filesReady || !notesReady || !chatReady) return
    if (demoState.seeded || demoState.dismissed) return
    /* В сейфе уже что-то лежит: это данные человека — демо к ним не мешаем.
       Но профиль мог приехать со старой сборки, где демо-объекты лежали
       без метки: помечаем их по id, иначе «Начать с чистого сейфа» не
       найдёт, что именно убирать. */
    if (filesRef.current.length > 0 || notesRef.current.length > 0) {
      let alive2 = true
      void import('../demo-seed').then(({ DEMO_FILES, demoNotes, demoSession }) => {
        if (!alive2) return
        const fileIds = new Set(DEMO_FILES.map((f) => f.id))
        const noteIds = new Set(demoNotes(0).map((n) => n.id))
        const sessionId = demoSession(0, 0).id
        const hasDemo =
          filesRef.current.some((f) => fileIds.has(f.id)) ||
          notesRef.current.some((n) => noteIds.has(n.id))
        if (hasDemo) {
          setFiles((all) => all.map((f) => (fileIds.has(f.id) ? { ...f, demo: true } : f)))
          setNotes((all) => all.map((n) => (noteIds.has(n.id) ? { ...n, demo: true } : n)))
          setSessions((all) => all.map((s) => (s.id === sessionId ? { ...s, demo: true } : s)))
        }
        setDemoState({ seeded: true, dismissed: !hasDemo })
      })
      return () => {
        alive2 = false
      }
    }
    let alive = true
    void import('../demo-seed').then(({ DEMO_FILES, demoNotes, demoSession }) => {
      if (!alive) return
      const t0 = Date.now()
      setFiles((all) => (all.length > 0 ? all : DEMO_FILES))
      setNotes((all) => (all.length > 0 ? all : demoNotes(t0)))
      setSessions((all) => (all.length > 0 ? all : [demoSession(t0, DEMO_FILES.length)]))
      setDemoState({ seeded: true, dismissed: false })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoReady, filesReady, notesReady, chatReady, demoState.seeded, demoState.dismissed])

  const demo = useMemo<DemoView>(() => {
    const df = files.filter((f) => f.demo).length
    const dn = notes.filter((n) => n.demo).length
    const ds = sessions.filter((s) => s.demo).length
    return {
      active: df + dn + ds > 0,
      count: df + dn + ds,
      files: df,
      notes: dn,
      sessions: ds,
      dismissed: demoState.dismissed,
    }
  }, [files, notes, sessions, demoState.dismissed])

  /** «Начать с чистого сейфа»: уходит только демо, пользовательское остаётся. */
  const clearDemo = useCallback(() => {
    setFiles((all) => all.filter((f) => !f.demo))
    setNotes((all) => all.filter((n) => !n.demo))
    setSessions((all) => all.filter((s) => !s.demo))
    setActiveSessionId((cur) =>
      cur && sessionsRef.current.some((s) => s.id === cur && s.demo) ? null : cur,
    )
    setDemoState({ seeded: true, dismissed: true })
    trackAction('demo.clear')
    flash('Демо-данные убраны. В сейфе остались только ваши объекты.')
  }, [flash, setActiveSessionId, setDemoState, setFiles, setNotes, setSessions])

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

  /* ---------- NF-5: массовые операции ----------
     Ключевое отличие от одиночных действий: одна запись в состояние на
     всю порцию. Пятьсот вызовов patchNote дали бы пятьсот записей в
     хранилище и столько же перерисовок — порциями это двадцать. */

  const bulkPatchFiles = useCallback(
    (ids: string[], fn: (f: VaultFile) => VaultFile) => {
      if (ids.length === 0) return
      const set = new Set(ids)
      setFiles((all) => all.map((f) => (set.has(f.id) ? fn(f) : f)))
    },
    [setFiles],
  )

  const bulkRemoveFiles = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const set = new Set(ids)
      setFiles((all) => all.filter((f) => !set.has(f.id)))
      setNotes((all) =>
        all.map((n) => (n.pinnedTo && set.has(n.pinnedTo) ? { ...n, pinnedTo: undefined } : n)),
      )
      setSessions((all) =>
        all.map((s) =>
          s.pinned.some((p) => set.has(p))
            ? { ...s, pinned: s.pinned.filter((p) => !set.has(p)) }
            : s,
        ),
      )
    },
    [setFiles, setNotes, setSessions],
  )

  const restoreFiles = useCallback(
    (list: VaultFile[]) => {
      if (list.length === 0) return
      setFiles((all) => {
        const known = new Set(all.map((f) => f.id))
        const back = list.filter((f) => !known.has(f.id))
        return back.length === 0 ? all : [...back, ...all]
      })
    },
    [setFiles],
  )

  const bulkPatchNotes = useCallback(
    (ids: string[], fn: (n: Note) => Note) => {
      if (ids.length === 0) return
      const set = new Set(ids)
      setNotes((all) => all.map((n) => (set.has(n.id) ? fn(n) : n)))
    },
    [setNotes],
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
    void logJournal(
      'vault-wipe',
      'Сейф стёрт',
      `Удалены ${n} файлов (${fmtBytes(bytes)}), стикеры и разговоры. Восстановление невозможно.`,
    ).then((jid) =>
      notify({
        kind: 'danger',
        cat: 'privacy',
        icon: 'trash',
        title: 'Сейф стёрт',
        body: `${n} файлов и ${fmtBytes(bytes)} удалены без возможности восстановления.`,
        link: { kind: 'journal', id: jid },
      }),
    )
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
      bulkPatchFiles,
      bulkRemoveFiles,
      restoreFiles,
      bulkPatchNotes,
      reindexAll,
      clearIndex,
      wipeVault,
      demo,
      clearDemo,
      replaceFiles: setFiles,
      replaceNotes: setNotes,
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
      setReindexHandler, removeFile, retagFile, bulkPatchFiles, bulkRemoveFiles, restoreFiles,
      bulkPatchNotes, reindexAll, clearIndex, wipeVault, demo, clearDemo, setFiles, setNotes, notes,
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
