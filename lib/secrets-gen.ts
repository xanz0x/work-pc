/* ============================================================
   ГЕНЕРАТОРЫ И ОЦЕНКА СИЛЫ · CSPRNG, локально, без сети
   crypto.getRandomValues + отбраковка по модулю (без смещения).
   Скоринг — локальная эвристика в духе zxcvbn: энтропия минус
   штрафы за словарные куски, повторы и клавиатурные дорожки.
   ============================================================ */

export type GenOptions = {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  /** Исключить похожие символы: 0/O, 1/l/I, 5/S. */
  noAmbiguous: boolean
  /** Произносимые блоки вида «kuva-tery-9» вместо случайного шума. */
  memorable: boolean
}

export const DEFAULT_GEN: GenOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  noAmbiguous: true,
  memorable: false,
}

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!#$%&*+-=?@^_~',
}
const AMBIGUOUS = /[0O1lI5S|]/g

/** Равномерный выбор без смещения по модулю. */
function pick(alphabet: string): string {
  const max = 256 - (256 % alphabet.length)
  const buf = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < max) return alphabet[buf[0] % alphabet.length]
  }
}

export function randomInt(bound: number): number {
  const max = 4294967296 - (4294967296 % bound)
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < max) return buf[0] % bound
  }
}

const CONS = 'bdfghjklmnprstvz'
const VOW = 'aeiouy'

function syllable(): string {
  return pick(CONS) + pick(VOW) + pick(CONS) + pick(VOW)
}

export function generatePassword(opt: GenOptions): string {
  if (opt.memorable) {
    const blocks = Math.max(2, Math.min(6, Math.round(opt.length / 5)))
    const parts: string[] = []
    for (let i = 0; i < blocks; i++) {
      let s = syllable()
      if (opt.upper && i === 0) s = s[0].toUpperCase() + s.slice(1)
      parts.push(s)
    }
    let out = parts.join('-')
    if (opt.digits) out += `-${randomInt(90) + 10}`
    if (opt.symbols) out += pick(SETS.symbols)
    return out
  }

  let alphabet = ''
  if (opt.upper) alphabet += SETS.upper
  if (opt.lower) alphabet += SETS.lower
  if (opt.digits) alphabet += SETS.digits
  if (opt.symbols) alphabet += SETS.symbols
  if (!alphabet) alphabet = SETS.lower
  if (opt.noAmbiguous) alphabet = alphabet.replace(AMBIGUOUS, '')

  const len = Math.max(4, Math.min(128, opt.length))
  let out = ''
  for (let i = 0; i < len; i++) out += pick(alphabet)

  /* Гарантия присутствия каждого включённого класса. */
  const need: string[] = []
  if (opt.upper) need.push(SETS.upper)
  if (opt.lower) need.push(SETS.lower)
  if (opt.digits) need.push(SETS.digits)
  if (opt.symbols) need.push(SETS.symbols)
  need.forEach((set, i) => {
    const cleaned = opt.noAmbiguous ? set.replace(AMBIGUOUS, '') : set
    if (![...out].some((ch) => cleaned.includes(ch)) && i < out.length) {
      out = out.slice(0, i) + pick(cleaned) + out.slice(i + 1)
    }
  })
  return out
}

export function generatePin(len = 6): string {
  let out = ''
  for (let i = 0; i < len; i++) out += String(randomInt(10))
  return out
}

export function generateHex(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function generateUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/* ---------- оценка силы ---------- */

const WEAK = [
  'password',
  'пароль',
  'qwerty',
  'йцукен',
  'admin',
  'letmein',
  'welcome',
  'iloveyou',
  'dragon',
  'monkey',
  'master',
  'login',
  'secret',
  'workflow',
]
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

export type Strength = { score: 0 | 1 | 2 | 3 | 4; bits: number; label: string; hints: string[] }

const LABELS = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Крепкий']

export function scorePassword(pw: string): Strength {
  if (!pw) return { score: 0, bits: 0, label: 'Пусто', hints: ['Введите или сгенерируйте значение'] }

  const low = pw.toLowerCase()
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/[0-9]/.test(pw)) pool += 10
  if (/[^A-Za-z0-9]/.test(pw)) pool += 20
  let bits = pw.length * Math.log2(Math.max(2, pool))

  const hints: string[] = []
  if (WEAK.some((w) => low.includes(w))) {
    bits -= 28
    hints.push('содержит словарное слово')
  }
  if (SEQUENCES.some((seq) => hasRun(low, seq))) {
    bits -= 16
    hints.push('есть последовательность символов')
  }
  const unique = new Set(pw).size
  if (unique <= Math.max(2, Math.ceil(pw.length / 3))) {
    bits -= 14
    hints.push('символы повторяются')
  }
  if (/^\d+$/.test(pw)) {
    bits -= 12
    hints.push('только цифры')
  }
  if (pw.length < 12) hints.push('короче 12 символов')

  bits = Math.max(0, Math.round(bits))
  const score: Strength['score'] = bits < 32 ? 0 : bits < 50 ? 1 : bits < 70 ? 2 : bits < 95 ? 3 : 4
  return { score, bits, label: LABELS[score], hints }
}

function hasRun(hay: string, seq: string): boolean {
  for (let i = 0; i + 4 <= seq.length; i++) {
    const chunk = seq.slice(i, i + 4)
    if (hay.includes(chunk) || hay.includes([...chunk].reverse().join(''))) return true
  }
  return false
}
