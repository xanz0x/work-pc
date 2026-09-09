/* ============================================================
   ИНДЕКСАТОР · чанки и ключевые слова (NF-1)
   Чистые функции: покрыты тестами, работают и в воркере, и в node.
   ============================================================ */

export const CHUNK_SIZE = 1200
export const CHUNK_OVERLAP = 120

/**
 * Резка текста по границам абзацев и предложений: чанк не рвёт слово
 * посередине, соседние чанки перекрываются, чтобы фраза на стыке
 * находилась целиком.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n?/g, '\n').trim()
  if (clean.length === 0) return []
  if (clean.length <= size) return [clean]

  const out: string[] = []
  let at = 0
  while (at < clean.length) {
    let end = Math.min(clean.length, at + size)
    if (end < clean.length) {
      const window = clean.slice(at, end)
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
      )
      if (breakAt > size * 0.5) end = at + breakAt + 1
    }
    const piece = clean.slice(at, end).trim()
    if (piece.length > 0) out.push(piece)
    if (end >= clean.length) break
    at = Math.max(end - overlap, at + 1)
  }
  return out
}

const STOP = new Set([
  'этот', 'который', 'когда', 'также', 'если', 'чтобы', 'быть', 'было', 'были', 'есть',
  'может', 'можно', 'всего', 'после', 'перед', 'между', 'через', 'более', 'менее', 'очень',
  'такой', 'такие', 'него', 'него', 'him', 'that', 'this', 'with', 'from', 'have', 'they',
  'their', 'about', 'there', 'which', 'would', 'could', 'should', 'been', 'were', 'will',
  'него', 'нашей', 'вашей', 'него', 'сюда', 'тоже', 'ещё', 'даже',
])

/** Частотные слова файла: подпись в карточке и грубая семантика для карты. */
export function keywordsOf(text: string, limit = 12): string[] {
  const freq = new Map<string, number>()
  for (const raw of text.toLowerCase().replace('ё', 'е').split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 4 || raw.length > 24) continue
    if (STOP.has(raw)) continue
    if (/^\d+$/.test(raw)) continue
    freq.set(raw, (freq.get(raw) ?? 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w)
}
