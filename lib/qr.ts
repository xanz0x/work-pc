/* ============================================================
   QR v1 · собственный кодер QR Code (модель 2)
   Zero-dependency: ни одного npm-пакета. Байтовый режим (UTF-8),
   уровень коррекции M, версии 1–10 (до 213 байт полезных данных) —
   с запасом на строку Wi-Fi `WIFI:T:WPA;S:…;P:…;;`.

   Полный конвейер по ISO/IEC 18004:
   биты режима → счётчик → данные → заполнение → блоки Рида-Соломона
   → чередование → расстановка зигзагом → выбор маски по штрафам
   → format/version info. Ничего не уходит наружу: чистая математика.
   ============================================================ */

/* ---------- GF(256), примитивный полином 0x11D ---------- */

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]

function polyMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) out[i + j] ^= gfMul(a[i], b[j])
  return out
}

/** Порождающий полином ∏(x − α^i) для n проверочных байт. */
function rsGenerator(n: number): number[] {
  let g = [1]
  for (let i = 0; i < n; i++) g = polyMul(g, [1, GF_EXP[i]])
  return g
}

function rsEcc(data: number[], n: number): number[] {
  const gen = rsGenerator(n)
  const res = new Array<number>(data.length + n).fill(0)
  data.forEach((d, i) => (res[i] = d))
  for (let i = 0; i < data.length; i++) {
    const coef = res[i]
    if (coef === 0) continue
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef)
  }
  return res.slice(data.length)
}

/* ---------- таблицы версий для уровня M ---------- */

type Spec = { data: number; ecc: number; blocks: number }

const SPEC: (Spec | null)[] = [
  null,
  { data: 16, ecc: 10, blocks: 1 },
  { data: 28, ecc: 16, blocks: 1 },
  { data: 44, ecc: 26, blocks: 1 },
  { data: 64, ecc: 18, blocks: 2 },
  { data: 86, ecc: 24, blocks: 2 },
  { data: 108, ecc: 16, blocks: 4 },
  { data: 124, ecc: 18, blocks: 4 },
  { data: 154, ecc: 22, blocks: 4 },
  { data: 182, ecc: 22, blocks: 5 },
  { data: 216, ecc: 26, blocks: 5 },
]

const ALIGN: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

/** Остаточные биты после кодовых слов (версии 2–6 — семь нулей). */
const remainderBits = (version: number) => (version >= 2 && version <= 6 ? 7 : 0)

const countBits = (version: number) => (version <= 9 ? 8 : 16)

export const QR_MAX_BYTES = SPEC[10]!.data - 3 /* режим+счётчик+терминатор */

/* ---------- битовый буфер ---------- */

class Bits {
  readonly bits: number[] = []
  push(value: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
  }
}

/* ---------- матрица ---------- */

type Cell = boolean | null

function newGrid(size: number): Cell[][] {
  return Array.from({ length: size }, () => new Array<Cell>(size).fill(null))
}

function drawFunctionPatterns(g: Cell[][], version: number): void {
  const size = g.length

  const finder = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 7; dy++)
      for (let dx = -1; dx <= 7; dx++) {
        const y = cy + dy
        const x = cx + dx
        if (y < 0 || x < 0 || y >= size || x >= size) continue
        const inside = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6
        const d = Math.max(Math.abs(dy - 3), Math.abs(dx - 3))
        g[y][x] = inside ? d !== 2 : false
      }
  }
  finder(0, 0)
  finder(size - 7, 0)
  finder(0, size - 7)

  /* Синхродорожки: строка и столбец 6. */
  for (let i = 0; i < size; i++) {
    if (g[6][i] === null) g[6][i] = i % 2 === 0
    if (g[i][6] === null) g[i][6] = i % 2 === 0
  }

  /* Выравнивающие узоры 5×5, кроме перекрытий с поисковыми. */
  const pos = ALIGN[version]
  for (const cy of pos)
    for (const cx of pos) {
      const corner =
        (cy === 6 && cx === 6) ||
        (cy === 6 && cx === size - 7) ||
        (cy === size - 7 && cx === 6)
      if (corner) continue
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          g[cy + dy][cx + dx] = Math.max(Math.abs(dy), Math.abs(dx)) !== 1
    }

  /* Резерв под format info (заполняется после выбора маски). */
  for (let i = 0; i <= 8; i++) {
    if (g[8][i] === null) g[8][i] = false
    if (g[i][8] === null) g[i][8] = false
  }
  for (let i = 0; i < 8; i++) {
    if (g[size - 1 - i][8] === null) g[size - 1 - i][8] = false
    if (g[8][size - 1 - i] === null) g[8][size - 1 - i] = false
  }
  /* Тёмный модуль. */
  g[size - 8][8] = true

  /* Резерв под version info (версии 7+). */
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      if (g[b][a] === null) g[b][a] = false
      if (g[a][b] === null) g[a][b] = false
    }
  }
}

function drawCodewords(g: Cell[][], fixed: boolean[][], bits: number[]): void {
  const size = g.length
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!fixed[y][x] && i < bits.length) {
          g[y][x] = bits[i] === 1
          i++
        }
      }
    }
  }
}

const maskAt = (m: number, y: number, x: number): boolean => {
  switch (m) {
    case 0:
      return (y + x) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (y + x) % 3 === 0
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
    case 5:
      return ((y * x) % 2) + ((y * x) % 3) === 0
    case 6:
      return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0
    default:
      return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0
  }
}

function drawFormat(g: Cell[][], mask: number): void {
  const size = g.length
  const data = (0 << 3) | mask /* уровень M = 00 */
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const bit = (i: number) => ((bits >>> i) & 1) === 1

  for (let i = 0; i <= 5; i++) g[i][8] = bit(i)
  g[7][8] = bit(6)
  g[8][8] = bit(7)
  g[8][7] = bit(8)
  for (let i = 9; i < 15; i++) g[8][14 - i] = bit(i)

  for (let i = 0; i < 8; i++) g[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) g[size - 15 + i][8] = bit(i)
  g[size - 8][8] = true
}

function drawVersion(g: Cell[][], version: number): void {
  if (version < 7) return
  const size = g.length
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  const bits = (version << 12) | rem
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    g[b][a] = on
    g[a][b] = on
  }
}

/* ---------- штрафы (правила 1–4) ---------- */

function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0

  const runScore = (line: boolean[]) => {
    let s = 0
    let run = 1
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) {
        run++
        if (run === 5) s += 3
        else if (run > 5) s += 1
      } else run = 1
    }
    return s
  }
  const finderLike = (line: boolean[]) => {
    let s = 0
    const pat = [true, false, true, true, true, false, true]
    for (let i = 0; i + 7 <= size; i++) {
      let hit = true
      for (let k = 0; k < 7; k++)
        if (line[i + k] !== pat[k]) {
          hit = false
          break
        }
      if (!hit) continue
      const before = line.slice(Math.max(0, i - 4), i)
      const after = line.slice(i + 7, i + 11)
      if ((before.length === 4 && before.every((b) => !b)) || (after.length === 4 && after.every((b) => !b)))
        s += 40
    }
    return s
  }

  for (let y = 0; y < size; y++) {
    const row = m[y]
    score += runScore(row) + finderLike(row)
  }
  for (let x = 0; x < size; x++) {
    const col = m.map((r) => r[x])
    score += runScore(col) + finderLike(col)
  }

  /* Правило 2: блоки 2×2 одного цвета. */
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
    }

  /* Правило 4: перекос доли тёмных модулей от 50 %. */
  let dark = 0
  for (const row of m) for (const c of row) if (c) dark++
  const pct = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(pct - 50) / 5) * 10
  return score
}

/* ---------- публичный API ---------- */

/**
 * Матрица QR (true = тёмный модуль) для строки. Кодирует UTF-8,
 * уровень коррекции M. null — строка длиннее версии 10.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)]

  let version = 0
  for (let v = 1; v <= 10; v++) {
    const cap = SPEC[v]!.data * 8
    if (4 + countBits(v) + bytes.length * 8 <= cap) {
      version = v
      break
    }
  }
  if (version === 0) return null

  const spec = SPEC[version]!
  const bb = new Bits()
  bb.push(0b0100, 4)
  bb.push(bytes.length, countBits(version))
  for (const b of bytes) bb.push(b, 8)

  const capacity = spec.data * 8
  bb.push(0, Math.min(4, capacity - bb.bits.length))
  while (bb.bits.length % 8 !== 0) bb.bits.push(0)

  const words: number[] = []
  for (let i = 0; i < bb.bits.length; i += 8) {
    let byte = 0
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bb.bits[i + k]
    words.push(byte)
  }
  const PAD = [0xec, 0x11]
  for (let i = 0; words.length < spec.data; i++) words.push(PAD[i % 2])

  /* Блоки: короткие идут первыми, длинные — на один байт больше. */
  const long = spec.data % spec.blocks
  const short = Math.floor(spec.data / spec.blocks)
  const dataBlocks: number[][] = []
  const eccBlocks: number[][] = []
  let off = 0
  for (let b = 0; b < spec.blocks; b++) {
    const len = short + (b >= spec.blocks - long ? 1 : 0)
    const chunk = words.slice(off, off + len)
    off += len
    dataBlocks.push(chunk)
    eccBlocks.push(rsEcc(chunk, spec.ecc))
  }

  const interleaved: number[] = []
  const maxLen = Math.max(...dataBlocks.map((b) => b.length))
  for (let i = 0; i < maxLen; i++)
    for (const b of dataBlocks) if (i < b.length) interleaved.push(b[i])
  for (let i = 0; i < spec.ecc; i++) for (const b of eccBlocks) interleaved.push(b[i])

  const bitStream: number[] = []
  for (const byte of interleaved) for (let i = 7; i >= 0; i--) bitStream.push((byte >>> i) & 1)
  for (let i = 0; i < remainderBits(version); i++) bitStream.push(0)

  const size = 17 + 4 * version
  const base = newGrid(size)
  drawFunctionPatterns(base, version)
  const fixed = base.map((row) => row.map((c) => c !== null))
  drawCodewords(base, fixed, bitStream)
  drawVersion(base, version)

  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const g: Cell[][] = base.map((row) => row.slice())
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!fixed[y][x] && maskAt(mask, y, x)) g[y][x] = !(g[y][x] === true)
    drawFormat(g, mask)
    const solid = g.map((row) => row.map((c) => c === true))
    const sc = penalty(solid)
    if (sc < bestScore) {
      bestScore = sc
      best = solid
    }
  }
  return best
}

/** Экранирование по стандарту Wi-Fi QR: \ ; , : " требуют слеша. */
export function wifiEscape(s: string): string {
  return s.replace(/([\\;,:"])/g, '\\$1')
}

export function wifiPayload(ssid: string, password: string, security: string): string {
  const sec = /wep/i.test(security) ? 'WEP' : password ? 'WPA' : 'nopass'
  const hidden = ''
  return `WIFI:T:${sec};S:${wifiEscape(ssid)};${password ? `P:${wifiEscape(password)};` : ''}${hidden};`
}
