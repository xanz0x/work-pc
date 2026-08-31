/* ============================================================
   ИНДЕКСАТОР · извлечение текста (NF-1)
   Один вход: байты + имя → текст либо честная причина, почему текста нет.
   ============================================================ */

import { pdfText } from './pdf'
import type { NoTextReason } from './types'

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'json', 'jsonl', 'log', 'ini', 'toml', 'yml',
  'yaml', 'xml', 'html', 'htm', 'css', 'scss', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py',
  'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh',
  'sql', 'env', 'conf', 'srt', 'vtt', 'rtf',
])

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** Признак «это текстовый формат, читаем как текст». */
export function isTextExt(ext: string): boolean {
  return TEXT_EXT.has(ext)
}

const UTF8 = new TextDecoder('utf-8', { fatal: false })

function decodeText(bytes: Uint8Array): string {
  const s = UTF8.decode(bytes)
  /* Нулевые байты и битые символы = это не текст, а бинарник с текстовым расширением. */
  const bad = (s.match(/[\uFFFD\u0000]/g) ?? []).length
  if (bad > Math.max(4, s.length * 0.02)) return ''
  return s
}

export type Extracted = { text: string; noText?: NoTextReason }

export async function extractText(name: string, bytes: Uint8Array): Promise<Extracted> {
  const ext = extOf(name)
  if (bytes.byteLength === 0) return { text: '', noText: 'empty' }

  if (ext === 'pdf') {
    const text = await pdfText(bytes)
    return text.trim().length > 0 ? { text } : { text: '', noText: 'pdf-no-text' }
  }

  if (isTextExt(ext)) {
    const text = decodeText(bytes)
    if (text.trim().length === 0) return { text: '', noText: 'binary' }
    return { text }
  }

  return { text: '', noText: 'binary' }
}
