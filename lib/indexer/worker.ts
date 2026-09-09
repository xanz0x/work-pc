/* ============================================================
   ИНДЕКСАТОР · воркер (NF-1, шаг 2)
   Чтение, извлечение текста, чанки, ключевые слова и хеш считаются
   здесь — главный поток остаётся свободным, интерфейс не подвисает
   даже на папке в тысячу файлов.
   ============================================================ */

/// <reference lib="webworker" />

import { processFile } from './pipeline'
import { idOfPath } from './pipeline'
import { getDoc, putDoc } from './store'
import { MAX_READ_BYTES, type IndexItem, type WorkerIn, type WorkerOut } from './types'

const cancelled = new Set<string>()

function send(msg: WorkerOut): void {
  ;(self as unknown as { postMessage(m: WorkerOut): void }).postMessage(msg)
}

async function readBytes(item: IndexItem): Promise<Uint8Array> {
  const file = item.file ?? (await item.handle?.getFile())
  if (!file) throw new Error('файл недоступен')
  if (file.size > MAX_READ_BYTES) {
    return new Uint8Array(await file.slice(0, MAX_READ_BYTES).arrayBuffer())
  }
  return new Uint8Array(await file.arrayBuffer())
}

async function runJob(msg: Extract<WorkerIn, { type: 'index' }>): Promise<void> {
  const { jobId, items, known, force } = msg
  let done = 0

  for (const item of items) {
    if (cancelled.has(jobId)) break
    send({ type: 'progress', jobId, done, total: items.length, current: item.name })

    try {
      const prev = known[item.path]
      /* Инкрементальность, дешёвый путь: размер и время не менялись — не читаем. */
      if (!force && prev && prev.size === item.size && prev.mtime === item.mtime) {
        const stored = await getDoc(prev.id)
        if (stored) {
          send({
            type: 'file',
            jobId,
            record: stored.record,
            entry: {
              id: stored.record.id,
              path: stored.record.path,
              name: stored.record.name,
              keywords: stored.record.keywords,
              text: stored.chunks.join('\n').slice(0, 6000),
            },
            chunks: [],
            skipped: true,
          })
          done += 1
          continue
        }
      }

      const bytes = await readBytes(item)
      const { record, entry, chunks } = await processFile({
        path: item.path,
        name: item.name,
        size: item.size,
        mtime: item.mtime,
        bytes,
      })

      /* Инкрементальность, точный путь: содержимое совпало по хешу. */
      const unchanged = !force && prev?.hash === record.hash
      await putDoc(record, chunks)
      send({ type: 'file', jobId, record, entry, chunks: [], skipped: unchanged })
    } catch (e) {
      send({
        type: 'failed',
        jobId,
        path: item.path,
        reason: e instanceof Error ? e.message : 'не прочитан',
      })
    }
    done += 1
  }

  send({ type: 'progress', jobId, done, total: items.length, current: '' })
  send({ type: 'done', jobId, cancelled: cancelled.has(jobId) })
  cancelled.delete(jobId)
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data
  if (msg.type === 'cancel') {
    cancelled.add(msg.jobId)
    return
  }
  if (msg.type === 'index') {
    void runJob(msg).catch((err: unknown) => {
      send({
        type: 'fatal',
        jobId: msg.jobId,
        reason: err instanceof Error ? err.message : 'сбой воркера',
      })
    })
  }
}

/* Экспорт нужен только сборщику: файл остаётся модулем. */
export { idOfPath }
