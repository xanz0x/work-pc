/* ============================================================
   ИНДЕКСАТОР · текстовый слой PDF (NF-1, zero-dependency)
   Закон проекта — без новых зависимостей, поэтому pdf.js здесь не
   появится. Разбираем ровно то, что можно разобрать честно: потоки
   FlateDecode распаковываются штатным DecompressionStream, из
   контент-потоков берутся операторы показа текста (Tj/TJ/'/").
   Скан без текстового слоя так и помечается — OCR в продукте нет.
   ============================================================ */

const LATIN1 = new TextDecoder('latin1')

function latin1(bytes: Uint8Array): string {
  return LATIN1.decode(bytes)
}

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

/**
 * Строки PDF по спецификации в PDFDocEncoding (близко к latin1), но часть
 * генераторов кладёт туда UTF-8. Если байты — валидный UTF-8 с не-ASCII,
 * читаем как UTF-8: иначе кириллица превращается в мохибаке.
 */
function maybeUtf8(s: string): string {
  if (!/[\u0080-\u00FF]/.test(s)) return s
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
    const out = UTF8_STRICT.decode(bytes)
    return /[\p{L}]/u.test(out) ? out : s
  } catch {
    return s
  }
}

/** Распаковка zlib/raw-deflate средствами платформы. null — не наш поток. */
export async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(
        new DecompressionStream(format),
      )
      const buf = await new Response(stream).arrayBuffer()
      if (buf.byteLength > 0) return new Uint8Array(buf)
    } catch {
      /* следующий формат */
    }
  }
  return null
}

function unescapeLiteral(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const n = raw[i + 1]
    i += 1
    if (n === 'n') out += '\n'
    else if (n === 'r') out += '\r'
    else if (n === 't') out += '\t'
    else if (n === 'b' || n === 'f') out += ' '
    else if (n === '\n') continue
    else if (n >= '0' && n <= '7') {
      let oct = n
      while (oct.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') {
        oct += raw[i + 1]
        i += 1
      }
      out += String.fromCharCode(parseInt(oct, 8))
    } else out += n ?? ''
  }
  return out
}

function decodeHexString(raw: string): string {
  const hex = raw.replace(/[^0-9A-Fa-f]/g, '')
  const bytes: number[] = []
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  /* UTF-16BE узнаём по нулевым старшим байтам латиницы. */
  const zeros = bytes.filter((_, i) => i % 2 === 0 && bytes[i] === 0).length
  if (bytes.length >= 4 && bytes.length % 2 === 0 && zeros > bytes.length / 4) {
    let out = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return out
  }
  return bytes.map((b) => String.fromCharCode(b)).join('')
}

const TOKEN =
  /\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\bTJ\b|\bTj\b|\bT\*|\bTd\b|\bTD\b|\bET\b|'|"/g

/** Текст из контент-потока страницы: только операторы показа текста. */
export function contentText(buf: Uint8Array): string {
  const s = latin1(buf)
  let out = ''
  let pending = ''
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(s)) !== null) {
    const tok = m[0]
    if (tok.startsWith('(')) {
      pending += maybeUtf8(unescapeLiteral(tok.slice(1, -1)))
    } else if (tok.startsWith('<')) {
      pending += maybeUtf8(decodeHexString(tok.slice(1, -1)))
    } else if (tok === 'Tj' || tok === 'TJ' || tok === "'" || tok === '"') {
      out += pending
      pending = ''
      if (tok === "'" || tok === '"') out += '\n'
      else out += ' '
    } else {
      out += pending
      pending = ''
      out += '\n'
    }
  }
  out += pending
  return out
}

/** Доля читаемых символов: защита от «текста», собранного из мусора глифов. */
export function readableRatio(s: string): number {
  if (s.length === 0) return 0
  let good = 0
  for (const ch of s) {
    if (/[\p{L}\p{N}\s.,;:!?()«»"'\-–—/@#%+*=]/u.test(ch)) good += 1
  }
  return good / s.length
}

function dictBefore(s: string, streamAt: number): string {
  const from = Math.max(0, streamAt - 2000)
  const head = s.slice(from, streamAt)
  const open = head.lastIndexOf('<<')
  return open < 0 ? head : head.slice(open)
}

/**
 * Текстовый слой PDF. Пустая строка — текста нет (скан или шифрование),
 * вызывающий обязан сказать это пользователю прямо.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const s = latin1(bytes)
  if (!s.startsWith('%PDF')) return ''
  /* Зашифрованные документы не читаем: честнее промолчать, чем выдать мусор. */
  if (/\/Encrypt\b/.test(s.slice(0, 4096)) || /trailer[\s\S]{0,400}\/Encrypt\b/.test(s)) return ''

  const parts: string[] = []
  let at = 0
  let guard = 0
  while (guard < 2000) {
    guard += 1
    const start = s.indexOf('stream', at)
    if (start < 0) break
    const dict = dictBefore(s, start)
    let dataStart = start + 'stream'.length
    if (s[dataStart] === '\r') dataStart += 1
    if (s[dataStart] === '\n') dataStart += 1
    const end = s.indexOf('endstream', dataStart)
    if (end < 0) break
    at = end + 'endstream'.length

    /* Картинки и шрифты в текст не превращаются — их даже не распаковываем. */
    if (/\/Subtype\s*\/Image|\/FontFile|\/Type\s*\/XObject\s*\/Subtype\s*\/Image/.test(dict)) continue

    const raw = bytes.subarray(dataStart, end)
    let data: Uint8Array | null = raw
    if (/\/FlateDecode/.test(dict)) data = await inflate(raw)
    else if (/\/Filter/.test(dict)) data = null // DCT/CCITT/LZW — не наш случай
    if (!data) continue

    const text = contentText(data)
    if (text.trim().length > 0) parts.push(text)
  }

  const joined = parts.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const letters = (joined.match(/\p{L}/gu) ?? []).length
  if (letters < 12 || readableRatio(joined) < 0.55) return ''
  return joined
}
