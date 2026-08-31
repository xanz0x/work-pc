'use client'

/* ============================================================
   ИНДЕКСАТОР · провайдер (NF-1, шаги 4–6)
   Здесь живёт состояние задания: честный прогресс, отмена, статус
   «в обработке» из реального конвейера, инкрементальность по хешу
   и подключение папки. Провайдер стоит ПОД сейфом: результаты
   индексации становятся файлами сейфа, а не отдельной вселенной.
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
import { useVault } from '@/lib/vault-store'
import { clearContent, contentIndex, dropContent, setContentIndex, upsertContent } from './content'
import {
  forgetFolderHandle,
  folderPermission,
  itemsFromFileList,
  loadFolderHandle,
  pickFolder,
  saveFolderHandle,
  scanFolder,
  supportsFsa,
} from './fs'
import { startJob, type Job } from './runner'
import {
  EMPTY_MANIFEST,
  clearIndexStore,
  readManifest,
  readSearchIndex,
  removeDoc,
  writeManifest,
  writeSearchIndex,
  type IndexManifest,
} from './store'
import {
  EMPTY_PROGRESS,
  type DirHandleLike,
  type IndexItem,
  type IndexProgress,
  type IndexedRecord,
  type SearchEntry,
} from './types'

export type FolderMode = 'fsa' | 'files' | null

/** Действия: ссылки стабильны, поэтому кнопки не перерисовываются от прогресса. */
export type IndexerActions = {
  connectFolder: () => Promise<void>
  grantPermission: () => Promise<void>
  /** Индексация файлов из диалога выбора (фолбэк и «Добавить файл»). */
  indexFiles: (files: File[]) => Promise<void>
  reindex: (force?: boolean) => Promise<void>
  cancel: () => void
  /** Отключить папку и стереть индекс (файлы на диске не трогаются). */
  disconnect: () => Promise<void>
}

/** Редкие изменения: подключение папки, старт/финиш задания, размер индекса. */
export type IndexerSummary = {
  busy: boolean
  folder: string
  folderMode: FolderMode
  needPermission: boolean
  fsaSupported: boolean
  indexedCount: number
}

/** Часто меняющийся прогресс: его подписывает ТОЛЬКО полоса индексации. */
export type IndexerProgressView = {
  progress: IndexProgress
  where: 'worker' | 'main' | null
}

const ActionsCtx = createContext<IndexerActions | null>(null)
const SummaryCtx = createContext<IndexerSummary | null>(null)
const ProgressCtx = createContext<IndexerProgressView | null>(null)

export function useIndexActions(): IndexerActions {
  const v = useContext(ActionsCtx)
  if (!v) throw new Error('useIndexActions вызван вне IndexerProvider')
  return v
}

export function useIndexSummary(): IndexerSummary {
  const v = useContext(SummaryCtx)
  if (!v) throw new Error('useIndexSummary вызван вне IndexerProvider')
  return v
}

export function useIndexProgress(): IndexerProgressView {
  const v = useContext(ProgressCtx)
  if (!v) throw new Error('useIndexProgress вызван вне IndexerProvider')
  return v
}

const BATCH = 200
/** Минимальный интервал между применениями порции к сейфу. */
const FLUSH_MS = 900
const PROGRESS_MS = 90

export function IndexerProvider({ children }: { children: ReactNode }) {
  const v = useVault()
  const [progress, setProgress] = useState<IndexProgress>(EMPTY_PROGRESS)
  const [folder, setFolder] = useState('')
  const [folderMode, setFolderMode] = useState<FolderMode>(null)
  const [needPermission, setNeedPermission] = useState(false)
  const [where, setWhere] = useState<'worker' | 'main' | null>(null)
  const [indexedCount, setIndexedCount] = useState(0)
  /* Вычислять поддержку API прямо в рендере нельзя: сервер её не видит и
     гидратация расходится. Узнаём после монтирования. */
  const [fsaSupported, setFsaSupported] = useState(false)

  useEffect(() => setFsaSupported(supportsFsa()), [])

  const handleRef = useRef<DirHandleLike | null>(null)
  const manifestRef = useRef<IndexManifest>(EMPTY_MANIFEST)
  const jobRef = useRef<Job | null>(null)
  const progressRef = useRef<IndexProgress>(EMPTY_PROGRESS)
  const lastPaint = useRef(0)
  const lastFlush = useRef(0)

  const paint = useCallback((next: IndexProgress, force = false) => {
    progressRef.current = next
    const t = Date.now()
    if (force || t - lastPaint.current > PROGRESS_MS) {
      lastPaint.current = t
      setProgress(next)
    }
  }, [])

  /* ---------- восстановление индекса при старте ---------- */

  useEffect(() => {
    let alive = true
    void (async () => {
      const [m, entries] = await Promise.all([readManifest(), readSearchIndex()])
      if (!alive) return
      manifestRef.current = m
      setFolder(m.folder)
      setIndexedCount(entries.length)
      setContentIndex(entries)
      const h = await loadFolderHandle()
      if (!alive || !h) return
      handleRef.current = h
      setFolderMode('fsa')
      const state = await folderPermission(h, false)
      if (alive) setNeedPermission(state !== 'granted')
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------- ядро: одно задание ---------- */

  const run = useCallback(
    async (items: IndexItem[], opts: { force: boolean; folderName: string; prune: boolean }) => {
      if (jobRef.current) return
      const known = manifestRef.current.files
      const startedAt = Date.now()

      /* Честный «в обработке»: помечаем ровно те файлы, что уйдут в конвейер. */
      const knownIds = items.map((i) => known[i.path]?.id).filter((id): id is string => Boolean(id))
      if (knownIds.length > 0) v.setIndexing(knownIds, true)

      paint(
        {
          ...EMPTY_PROGRESS,
          phase: 'index',
          total: items.length,
          startedAt,
        },
        true,
      )

      const records: IndexedRecord[] = []
      const entries: SearchEntry[] = []
      let indexed = 0
      let skipped = 0
      let failed = 0

      const flush = () => {
        if (records.length === 0) return
        lastFlush.current = Date.now()
        v.applyIndexed(records.splice(0, records.length))
        upsertContent(entries.splice(0, entries.length))
      }
      /* Порции склеиваются по времени: перерисовывать библиотеку чаще раза в
         секунду смысла нет, а кадры это стоит дорого. */
      const maybeFlush = () => {
        if (records.length >= BATCH || Date.now() - lastFlush.current > FLUSH_MS) flush()
      }

      const job = startJob(
        { items, known, force: opts.force },
        {
          onProgress: (done, total, current) => {
            paint({ ...progressRef.current, phase: 'index', done, total, current, indexed, skipped, failed })
          },
          onFile: (record, entry, wasSkipped) => {
            records.push(record)
            entries.push(entry)
            if (wasSkipped) skipped += 1
            else indexed += 1
            manifestRef.current.files[record.path] = {
              id: record.id,
              hash: record.hash,
              size: record.size,
              mtime: record.mtime,
            }
            maybeFlush()
          },
          onFailed: (path, reason) => {
            failed += 1
            console.warn('[indexer]', path, reason)
          },
        },
      )
      jobRef.current = job
      setWhere(job.where)

      const res = await job.result
      flush()
      jobRef.current = null
      if (knownIds.length > 0) v.setIndexing(knownIds, false)

      /* Файлы, исчезнувшие с диска, уходят из индекса — но только при полном
         обходе папки: индексация горсти файлов не смеет чистить архив. */
      if (opts.prune && !res.cancelled) {
        const alive = new Set(items.map((i) => i.path))
        const gone = Object.entries(manifestRef.current.files).filter(([p]) => !alive.has(p))
        if (gone.length > 0) {
          const ids = gone.map(([, f]) => f.id)
          await Promise.all(ids.map(removeDoc))
          gone.forEach(([p]) => delete manifestRef.current.files[p])
          dropContent(ids)
          v.dropIndexed(ids)
        }
      }

      manifestRef.current = {
        folder: opts.folderName || manifestRef.current.folder,
        at: Date.now(),
        files: manifestRef.current.files,
      }
      await writeManifest(manifestRef.current)
      const all = [...contentIndex().values()]
      await writeSearchIndex(all)
      setIndexedCount(all.length)
      setFolder(manifestRef.current.folder)
      v.setFolder(manifestRef.current.folder)

      paint(
        {
          phase: res.error ? 'error' : res.cancelled ? 'cancelled' : 'done',
          total: items.length,
          done: progressRef.current.done,
          indexed,
          skipped,
          failed,
          current: '',
          startedAt,
          finishedAt: Date.now(),
          error: res.error,
        },
        true,
      )

      const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
      if (res.error) {
        v.flash(`Индексация прервана: ${res.error}`)
        v.notify({
          kind: 'danger',
          cat: 'pipeline',
          icon: 'shield',
          title: 'Индексация не завершена',
          body: `Причина: ${res.error}. Индекс остался в прежнем состоянии.`,
        })
        return
      }
      if (res.cancelled) {
        v.flash(`Индексация отменена. Обработано ${indexed + skipped} из ${items.length}.`)
        v.notify({
          kind: 'warn',
          cat: 'pipeline',
          icon: 'refresh',
          title: 'Индексация отменена',
          body: `Успевшие файлы остались в индексе: ${indexed} новых, ${skipped} без изменений.`,
        })
        return
      }
      v.flash(`Индекс готов: ${indexed} новых, ${skipped} без изменений, ${secs} с.`)
      v.notify({
        kind: failed > 0 ? 'warn' : 'ok',
        cat: 'pipeline',
        icon: 'check',
        title: 'Индексация завершена',
        body: `${items.length} файлов из «${manifestRef.current.folder || 'выбранного набора'}»: ${indexed} прочитано заново, ${skipped} не изменилось${failed > 0 ? `, ${failed} не прочитано` : ''}.`,
        link: { kind: 'screen', id: 'library' },
      })
    },
    [paint, v],
  )

  /* ---------- действия ---------- */

  const scanAndRun = useCallback(
    async (handle: DirHandleLike, force: boolean) => {
      paint({ ...EMPTY_PROGRESS, phase: 'scan', startedAt: Date.now() }, true)
      const items = await scanFolder(handle, (n) =>
        paint({ ...progressRef.current, phase: 'scan', total: n }, true),
      )
      if (items.length === 0) {
        paint({ ...EMPTY_PROGRESS, phase: 'done', finishedAt: Date.now() }, true)
        v.flash('В папке нет доступных файлов.')
        return
      }
      await run(items, { force, folderName: handle.name, prune: true })
    },
    [paint, run, v],
  )

  const connectFolder = useCallback(async () => {
    if (!supportsFsa()) {
      v.flash('Браузер не даёт доступ к папке — выберите файлы через диалог.')
      return
    }
    const handle = await pickFolder()
    if (!handle) return
    handleRef.current = handle
    setFolderMode('fsa')
    setNeedPermission(false)
    await saveFolderHandle(handle)
    await scanAndRun(handle, false)
  }, [scanAndRun, v])

  const grantPermission = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return
    const state = await folderPermission(handle, true)
    setNeedPermission(state !== 'granted')
    if (state === 'granted') await scanAndRun(handle, false)
  }, [scanAndRun])

  const indexFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const items = itemsFromFileList(files)
      const dir = items[0].path.includes('/') ? items[0].path.split('/')[0] : ''
      if (dir) setFolderMode('files')
      await run(items, {
        force: false,
        folderName: dir || manifestRef.current.folder,
        prune: false,
      })
    },
    [run],
  )

  const reindex = useCallback(
    async (force = false) => {
      const handle = handleRef.current
      if (!handle) {
        v.flash('Папка не подключена: индексировать нечего. Подключите папку в библиотеке.')
        return
      }
      const state = await folderPermission(handle, true)
      if (state !== 'granted') {
        setNeedPermission(true)
        v.flash('Браузер не подтвердил доступ к папке — переиндексация отменена.')
        return
      }
      await scanAndRun(handle, force)
    },
    [scanAndRun, v],
  )

  const cancel = useCallback(() => {
    jobRef.current?.cancel()
  }, [])

  const disconnect = useCallback(async () => {
    jobRef.current?.cancel()
    const ids = [...contentIndex().keys()]
    await clearIndexStore()
    await forgetFolderHandle()
    clearContent()
    v.dropIndexed(ids)
    handleRef.current = null
    manifestRef.current = EMPTY_MANIFEST
    setFolder('')
    setFolderMode(null)
    setIndexedCount(0)
    setNeedPermission(false)
    paint({ ...EMPTY_PROGRESS }, true)
    v.flash('Индекс стёрт, папка отключена. Файлы на диске не тронуты.')
    v.notify({
      kind: 'warn',
      cat: 'pipeline',
      icon: 'trash',
      title: 'Индекс стёрт',
      body: 'Содержимое, чанки и хеши удалены из локальной базы. Файлы на диске остались.',
    })
  }, [paint, v])

  /* Переиндексация из настроек идёт через тот же конвейер (NF-1). */
  const setReindexHandler = v.setReindexHandler
  useEffect(() => {
    setReindexHandler(() => {
      void reindex(false)
    })
    return () => setReindexHandler(null)
  }, [reindex, setReindexHandler])

  const busy = progress.phase === 'scan' || progress.phase === 'index'

  const actions = useMemo<IndexerActions>(
    () => ({ connectFolder, grantPermission, indexFiles, reindex, cancel, disconnect }),
    [cancel, connectFolder, disconnect, grantPermission, indexFiles, reindex],
  )

  const summary = useMemo<IndexerSummary>(
    () => ({ busy, folder, folderMode, needPermission, fsaSupported, indexedCount }),
    [busy, folder, folderMode, fsaSupported, indexedCount, needPermission],
  )

  const progressView = useMemo<IndexerProgressView>(
    () => ({ progress, where }),
    [progress, where],
  )

  return (
    <ActionsCtx.Provider value={actions}>
      <SummaryCtx.Provider value={summary}>
        <ProgressCtx.Provider value={progressView}>{children}</ProgressCtx.Provider>
      </SummaryCtx.Provider>
    </ActionsCtx.Provider>
  )
}
