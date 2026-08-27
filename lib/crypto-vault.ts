/* ============================================================
   КРИПТО-ЯДРО ЗАМКА · WebCrypto, zero-dependency
   PBKDF2-HMAC-SHA256 (310 000 итераций — рекомендация OWASP)
   → AES-GCM 256. Ничего не кэшируем: мастер-ключ живёт ровно
   столько, сколько длится одна попытка проверки (см. п.10.8
   плана LOCK-FEATURE-PLAN.md), ссылка обнуляется после lockNow.
   Модуль не знает про React и localStorage-конфиг: только математика
   и волатильное хранилище состояния замка (wf.lock.state).
   ============================================================ */

export const LOCK_STATE_KEY = 'wf.lock.state'
export const LOCK_PING_KEY = 'wf.lock.ping'
/** Префикс обёрнутых файловых ключей (этап 5). */
export const FILE_KEY_PREFIX = 'wf.vault.keys.'

/** OWASP 2023+: PBKDF2-HMAC-SHA256 ≥ 600k, для интерактивного прототипа взят пол. */
export const LOCK_ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12
const VERIFIER_TEXT = 'workflow-lock-v1'
const MAX_DELAY_MS = 30_000

/* ---------- доступность WebCrypto ---------- */

export function cryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  )
}

function subtle(): SubtleCrypto {
  if (!cryptoAvailable()) throw new Error('WebCrypto недоступен в этом браузере')
  return globalThis.crypto.subtle
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

/* ---------- base64 (без зависимостей) ---------- */

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function isB64(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && /^[A-Za-z0-9+/]+=*$/.test(s)
}

/* ---------- деривация ---------- */

/**
 * PBKDF2(SHA-256, iterations, salt) → AES-GCM key 256.
 * Вызывается ровно один раз за попытку unlock (п.10.8).
 */
export async function deriveMasterKey(
  secret: string,
  salt: Uint8Array,
  iterations: number = LOCK_ITERATIONS,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/* ---------- симметричные операции ---------- */

export async function aesEncrypt(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ctB64: string; ivB64: string }> {
  const iv = randomBytes(IV_BYTES)
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { ctB64: toB64(new Uint8Array(ct)), ivB64: toB64(iv) }
}

/** null при любой неудаче — неверный ключ, битый шифртекст, подмена GCM-тега. */
export async function aesDecrypt(
  key: CryptoKey,
  ctB64: string,
  ivB64: string,
): Promise<string | null> {
  try {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) as BufferSource },
      key,
      fromB64(ctB64) as BufferSource,
    )
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

/* ---------- состояние замка (wf.lock.state) ---------- */

export type LockStateBlob = {
  v: 1
  saltB64: string
  verifierB64: string
  ivB64: string
  iterations: number
  failCount: number
  lastFailAt: number
  cooldownUntil: number
}

/**
 * Хранилище состояния: localStorage в браузере, память вне его (SSR, node,
 * самотест). Память намеренно не переживает перезагрузку страницы — как и
 * положено волатильному состоянию замка.
 */
type StorageLike = {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

const memoryStore = new Map<string, string>()

function store(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* доступ к storage запрещён — остаёмся в памяти */
  }
  return {
    getItem: (k) => memoryStore.get(k) ?? null,
    setItem: (k, v) => void memoryStore.set(k, v),
    removeItem: (k) => void memoryStore.delete(k),
  }
}

function isLockStateBlob(x: unknown): x is LockStateBlob {
  if (typeof x !== 'object' || x === null) return false
  const b = x as Record<string, unknown>
  return (
    b.v === 1 &&
    isB64(b.saltB64) &&
    isB64(b.verifierB64) &&
    isB64(b.ivB64) &&
    typeof b.iterations === 'number' &&
    b.iterations > 0
  )
}

/** Волатильное чтение; null = состояния нет или оно повреждено. */
export function readLockState(): LockStateBlob | null {
  try {
    const raw = store().getItem(LOCK_STATE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isLockStateBlob(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeLockState(blob: LockStateBlob): void {
  try {
    store().setItem(LOCK_STATE_KEY, JSON.stringify(blob))
  } catch {
    /* приватный режим — замок просто проживёт сессию */
  }
}

export function removeLockState(): void {
  try {
    store().removeItem(LOCK_STATE_KEY)
  } catch {
    /* игнорируем */
  }
}

/* ---------- создание и проверка мастера ---------- */

async function makeStateBlob(secret: string, iterations: number): Promise<LockStateBlob> {
  const salt = randomBytes(SALT_BYTES)
  const key = await deriveMasterKey(secret, salt, iterations)
  const verifier = await aesEncrypt(key, VERIFIER_TEXT)
  return {
    v: 1,
    saltB64: toB64(salt),
    verifierB64: verifier.ctB64,
    ivB64: verifier.ivB64,
    iterations,
    failCount: 0,
    lastFailAt: 0,
    cooldownUntil: 0,
  }
}

/** Создать новый мастер-ключ: свежая соль, свежий верификатор, счётчики в ноль. */
export async function setMasterSecret(secret: string): Promise<LockStateBlob> {
  const blob = await makeStateBlob(secret, LOCK_ITERATIONS)
  writeLockState(blob)
  return blob
}

/** true только если расшифровка верификатора совпала дословно. */
export async function verifyMasterSecret(secret: string): Promise<boolean> {
  const st = readLockState()
  if (!st) return false
  const key = await deriveMasterKey(secret, fromB64(st.saltB64), st.iterations)
  return (await aesDecrypt(key, st.verifierB64, st.ivB64)) === VERIFIER_TEXT
}

/* ---------- анти-брутфорс ---------- */

/** 1→1s, 2→2s, 3→4s … потолок 30s (план п.2.2). */
export function failDelayMs(failCount: number): number {
  if (failCount <= 0) return 0
  return Math.min(MAX_DELAY_MS, 1000 * 2 ** (failCount - 1))
}

/** Записать неудачу; задержка отсчитывается ПОСЛЕ завершения попытки (п.10.8). */
export function registerFailure(): LockStateBlob | null {
  const st = readLockState()
  if (!st) return null
  const now = Date.now()
  const next: LockStateBlob = {
    ...st,
    failCount: st.failCount + 1,
    lastFailAt: now,
    cooldownUntil: now + failDelayMs(st.failCount + 1),
  }
  writeLockState(next)
  return next
}

export function resetFailures(): void {
  const st = readLockState()
  if (!st || (st.failCount === 0 && st.cooldownUntil === 0)) return
  writeLockState({ ...st, failCount: 0, lastFailAt: 0, cooldownUntil: 0 })
}

/* ---------- файловые ключи (каркас для этапа 5) ---------- */

/** Соль файлового ключа выводится из id объекта — хранить её отдельно не нужно. */
async function fileSalt(fileId: string): Promise<Uint8Array> {
  const digest = await subtle().digest(
    'SHA-256',
    new TextEncoder().encode(`wf.filekey.${fileId}`) as BufferSource,
  )
  return new Uint8Array(digest.slice(0, SALT_BYTES))
}

export type SecretPack = { ctB64: string; ivB64: string; saltB64: string }

export async function encryptSecret(
  masterSecret: string,
  fileId: string,
  plaintext: string,
): Promise<SecretPack> {
  const salt = await fileSalt(fileId)
  const key = await deriveMasterKey(masterSecret, salt)
  const { ctB64, ivB64 } = await aesEncrypt(key, plaintext)
  return { ctB64, ivB64, saltB64: toB64(salt) }
}

export async function decryptSecret(
  masterSecret: string,
  fileId: string,
  pack: SecretPack,
): Promise<string | null> {
  const key = await deriveMasterKey(masterSecret, fromB64(pack.saltB64))
  return aesDecrypt(key, pack.ctB64, pack.ivB64)
}

/* ---------- unit-самотест (план этапа 1) ---------- */

export type SelfTestResult = { ok: boolean; checks: { name: string; ok: boolean }[] }

/**
 * Прогон крипто-ядра на малых итерациях (чтобы тест был мгновенным):
 * раунд-трип верификатора, отказ чужому паролю, отказ подделке,
 * файловые секреты туда-обратно, монотонность задержек.
 * Вызывается из консоли dev или из node (webcrypto есть с 19-й версии):
 *   import('./lib/crypto-vault.ts').then(m => m.cryptoSelfTest()).then(console.log)
 */
export async function cryptoSelfTest(): Promise<SelfTestResult> {
  const checks: { name: string; ok: boolean }[] = []
  const push = (name: string, ok: boolean) => checks.push({ name, ok })

  // 1. Раунд-трип: создали мастер → им же открылось.
  const blob = await makeStateBlob('тест-мастер-пароль-123', 1_000)
  writeLockState(blob)
  push('верификатор открывается своим ключом', await verifyMasterSecret('тест-мастер-пароль-123'))
  // 2. Чужой пароль отвергнут.
  push('чужой пароль отвергнут', !(await verifyMasterSecret('не-то-значение')))
  // 3. Подменённый шифртекст отвергнут (GCM-тег).
  const tampered: LockStateBlob = { ...blob, verifierB64: flipByte(blob.verifierB64) }
  const k = await deriveMasterKey('тест-мастер-пароль-123', fromB64(blob.saltB64), blob.iterations)
  push('подделка шифртекта отвергнута', (await aesDecrypt(k, tampered.verifierB64, tampered.ivB64)) === null)

  // 4. Файловые секреты: туда-обратно и отказ при смене мастера.
  const pack = await encryptSecret('мастер-A', 'file-42', 'паспортные данные скрыты')
  push(
    'файловый секрет расшифровывается',
    (await decryptSecret('мастер-A', 'file-42', pack)) === 'паспортные данные скрыты',
  )
  push(
    'файловый секрет не открывается другим мастером',
    (await decryptSecret('мастер-B', 'file-42', pack)) === null,
  )

  // 5. Анти-брутфорс: рост и потолок.
  push(
    'задержки растут до потолка 30s',
    failDelayMs(1) === 1000 && failDelayMs(2) === 2000 && failDelayMs(6) === 30_000,
  )

  removeLockState() // тест не оставляет мусора
  return { ok: checks.every((c) => c.ok), checks }
}

function flipByte(b64: string): string {
  const bytes = fromB64(b64)
  bytes[0] ^= 0x01
  return toB64(bytes)
}
