/* ============================================================
   ИНДЕКСАТОР · конвейер одного файла (NF-1)
   Чистая функция: байты → запись индекса, чанки и строка поиска.
   Работает и в воркере, и в тесте — поэтому DOM здесь не участвует.
   ============================================================ */

import { chunkText } from './chunk'
import { keywordsOf } from './chunk'
import { extOf, extractText } from './extract'
import { SNIPPET_LIMIT, type IndexedRecord, type SearchEntry } from './types'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** id файла = хеш относительного пути: переиндексация не плодит дубли. */
export async function idOfPath(path: string): Promise<string> {
  const hex = await sha256Hex(new TextEncoder().encode(path))
  return `idx-${hex.slice(0, 16)}`
}

export type Processed = {
  record: IndexedRecord
  entry: SearchEntry
  chunks: string[]
}

export async function processFile(input: {
  path: string
  name: string
  size: number
  mtime: number
  bytes: Uint8Array
}): Promise<Processed> {
  const { path, name, size, mtime, bytes } = input
  const [id, hash] = await Promise.all([idOfPath(path), sha256Hex(bytes)])
  const { text, noText } = await extractText(name, bytes)
  const chunks = chunkText(text)
  const keywords = keywordsOf(text)

  const record: IndexedRecord = {
    id,
    path,
    name,
    ext: extOf(name),
    size,
    mtime,
    hash,
    textLen: text.length,
    chunks: chunks.length,
    keywords,
    noText,
    at: Date.now(),
  }

  const entry: SearchEntry = {
    id,
    path,
    name,
    keywords,
    text: text.slice(0, SNIPPET_LIMIT),
  }

  return { record, entry, chunks }
}
