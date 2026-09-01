/* ============================================================
   ИНДЕКСАТОР · запуск задания (NF-1)
   Воркер — основной путь. Если сборщик или браузер не дал воркера,
   тот же конвейер выполняется в главном потоке порциями с уступкой
   кадра: медленнее, но приложение не врёт про «индексируется».
   ============================================================ */

import { getDoc, putDoc } from './store'
import {
  MAX_READ_BYTES,
  SNIPPET_LIMIT,
  type IndexItem,
  type IndexedRecord,
  type SearchEntry,
  type WorkerIn,
  type WorkerOut,
} from './types'

export type JobHooks = {
  onProgress: (done: number, total: number, current: string) => void
  onFile: (record: IndexedRecord, entry: SearchEntry, skipped: boolean) => void
  onFailed: (path: string, reason: string) => void
}

export type Job = {
  jobId: string
  cancel: () => void
  /** true — задание оборвано пользователем. */
  result: Promise<{ cancelled: boolean; error?: string }>
  /** Где реально считалось: подпись в интерфейсе не должна врать. */
  where: 'worker' | 'main'
}

function makeWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export type JobInput = {
  items: IndexItem[]
  known: Record<string, { id: string; hash: string; size: number; mtime: number }>
  force: boolean
}

export function startJob(input: JobInput, hooks: JobHooks): Job {
  const jobId = `job-${Date.now().toString(36)}`
  const worker = makeWorker()
  if (worker) return workerJob(worker, jobId, input, hooks)
  return mainJob(jobId, input, hooks)
}

function workerJob(worker: Worker, jobId: string, input: JobInput, hooks: JobHooks): Job {
  let settle: (r: { cancelled: boolean; error?: string }) => void = () => {}
  const result = new Promise<{ cancelled: boolean; error?: string }>((res) => {
    settle = res
  })

  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const msg = e.data
    if (msg.jobId !== jobId) return
    if (msg.type === 'progress') hooks.onProgress(msg.done, msg.total, msg.current)
    else if (msg.type === 'file') hooks.onFile(msg.record, msg.entry, msg.skipped)
    else if (msg.type === 'failed') hooks.onFailed(msg.path, msg.reason)
    else if (msg.type === 'done') {
      settle({ cancelled: msg.cancelled })
      worker.terminate()
    } else if (msg.type === 'fatal') {
      settle({ cancelled: false, error: msg.reason })
      worker.terminate()
    }
  }
  worker.onerror = (e: ErrorEvent) => {
    settle({ cancelled: false, error: e.message || 'воркер не запустился' })
    worker.terminate()
  }

  const msg: WorkerIn = { type: 'index', jobId, items: input.items, known: input.known, force: input.force }
  worker.postMessage(msg)

  return {
    jobId,
    where: 'worker',
    cancel: () => worker.postMessage({ type: 'cancel', jobId } satisfies WorkerIn),
    result,
  }
}

const frame = () =>
  new Promise<void>((res) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => res())
    else setTimeout(res, 0)
  })

function mainJob(jobId: string, input: JobInput, hooks: JobHooks): Job {
  let stop = false
  const run = async (): Promise<{ cancelled: boolean; error?: string }> => {
    /* AR-2: конвейер (с PDF-парсером внутри) в первом бандле не нужен —
       это резервный путь. Грузим его в момент, когда воркера не дали. */
    const { processFile } = await import('./pipeline')
    let done = 0
    for (const item of input.items) {
      if (stop) break
      hooks.onProgress(done, input.items.length, item.name)
      try {
        const prev = input.known[item.path]
        if (!input.force && prev && prev.size === item.size && prev.mtime === item.mtime) {
          const stored = await getDoc(prev.id)
          if (stored) {
            hooks.onFile(
              stored.record,
              {
                id: stored.record.id,
                path: stored.record.path,
                name: stored.record.name,
                keywords: stored.record.keywords,
                text: stored.chunks.join('\n').slice(0, SNIPPET_LIMIT),
              },
              true,
            )
            done += 1
            await frame()
            continue
          }
        }
        const file = item.file ?? (await item.handle?.getFile())
        if (!file) throw new Error('файл недоступен')
        const blob = file.size > MAX_READ_BYTES ? file.slice(0, MAX_READ_BYTES) : file
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const { record, entry, chunks } = await processFile({
          path: item.path,
          name: item.name,
          size: item.size,
          mtime: item.mtime,
          bytes,
        })
        await putDoc(record, chunks)
        hooks.onFile(record, entry, !input.force && prev?.hash === record.hash)
      } catch (e) {
        hooks.onFailed(item.path, e instanceof Error ? e.message : 'не прочитан')
      }
      done += 1
      await frame()
    }
    hooks.onProgress(done, input.items.length, '')
    return { cancelled: stop }
  }

  return {
    jobId,
    where: 'main',
    cancel: () => {
      stop = true
    },
    result: run(),
  }
}
