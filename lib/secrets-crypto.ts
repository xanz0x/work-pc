/* ============================================================
   SECRETS-CRYPTO v1 · шифрование записей менеджера секретов
   Строится ПОВЕРХ замка, своей крипты не изобретает:

   мастер-ключ сеанса (PBKDF2 600k → AES-GCM-256, hooks/use-file-keys)
     └─ wrap → SEK (random 32B, wf.secrets.sek.v1)
          └─ HKDF-SHA256(salt=SHA-256('wf.secrets.'+entryId)) → ключ записи
               └─ AES-GCM-256 → значение поля в формате `ct:iv`

   Зачем SEK: мастер-CryptoKey неэкстрагируем, из него нельзя вывести
   ключи на запись. SEK — экстрагируемое сырьё, доступное только внутри
   открытого сеанса, обнуляется вместе с ним (п.10.8 плана замка).
   ============================================================ */

import { aesDecrypt, aesEncrypt, b64ToBytes, bytesToB64, randomBytesOf } from './crypto-vault'
import { getMasterSession } from '@/hooks/use-file-keys'

export const SECRETS_SEK_KEY = 'wf.secrets.sek.v1'

type SekBlob = { v: 1; wct: string; wiv: string }

/** Сырьё ключа сейфа секретов: только память сеанса. */
let sekRaw: Uint8Array | null = null
const keyCache = new Map<string, CryptoKey>()

export function hasSecretsSession(): boolean {
  return sekRaw !== null
}

/** lockNow() / конец сеанса: сырьё и производные ключи обнуляются. */
export function dropSecretsSession(): void {
  if (sekRaw) sekRaw.fill(0)
  sekRaw = null
  keyCache.clear()
}

function readSek(): SekBlob | null {
  try {
    const raw = localStorage.getItem(SECRETS_SEK_KEY)
    if (!raw) return null
    const p: unknown = JSON.parse(raw)
    if (typeof p === 'object' && p !== null && (p as SekBlob).v === 1) return p as SekBlob
    return null
  } catch {
    return null
  }
}

function writeSek(blob: SekBlob): void {
  try {
    localStorage.setItem(SECRETS_SEK_KEY, JSON.stringify(blob))
  } catch {
    /* приватный режим — сейф секретов проживёт сессию */
  }
}

/**
 * Достать (или создать при первом входе) ключ сейфа секретов.
 * false = нет сеанса мастера или чужой мастер (после сброса замка).
 */
export async function ensureSecretsSession(): Promise<boolean> {
  if (sekRaw) return true
  const master = getMasterSession()
  if (!master) return false
  const blob = readSek()
  if (blob) {
    const rawB64 = await aesDecrypt(master, blob.wct, blob.wiv)
    if (rawB64 === null) return false
    sekRaw = b64ToBytes(rawB64)
    return true
  }
  const fresh = randomBytesOf(32)
  const wrapped = await aesEncrypt(master, bytesToB64(fresh))
  writeSek({ v: 1, wct: wrapped.ctB64, wiv: wrapped.ivB64 })
  sekRaw = fresh
  return true
}

/**
 * NF-7: сырьё SEK для бэкапа всего сейфа. Отдаётся ТОЛЬКО внутри открытого
 * сеанса и только для того, чтобы уехать внутрь снимка, зашифрованного
 * отдельным паролем (sealPortable). Без него снимок секретов бесполезен на
 * чистом устройстве: там будет другой мастер-ключ, а значит другая обёртка.
 */
export function exportSekRaw(): string | null {
  return sekRaw ? bytesToB64(sekRaw) : null
}

/**
 * NF-7: принять SEK из снимка — заново обернуть его мастер-ключом ЭТОГО
 * устройства и положить в localStorage. Производные ключи записей сбрасываются.
 */
export async function adoptSekRaw(rawB64: string): Promise<boolean> {
  const master = getMasterSession()
  if (!master) return false
  let raw: Uint8Array
  try {
    raw = b64ToBytes(rawB64)
  } catch {
    return false
  }
  if (raw.length !== 32) return false
  const wrapped = await aesEncrypt(master, bytesToB64(raw))
  writeSek({ v: 1, wct: wrapped.ctB64, wiv: wrapped.ivB64 })
  if (sekRaw) sekRaw.fill(0)
  sekRaw = raw
  keyCache.clear()
  return true
}

async function entryKey(entryId: string): Promise<CryptoKey | null> {
  if (!sekRaw) return null
  const cached = keyCache.get(entryId)
  if (cached) return cached
  const salt = new Uint8Array(
    (await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`wf.secrets.${entryId}`) as BufferSource,
    )).slice(0, 16),
  )
  const material = await crypto.subtle.importKey('raw', sekRaw as BufferSource, 'HKDF', false, [
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode('wf.secrets.field') as BufferSource,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  keyCache.set(entryId, key)
  return key
}

/** Формат хранения секретного значения — как у стикеров: `<ctB64>:<ivB64>`. */
const CT_IV_RE = /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/

export function isSealed(value: unknown): boolean {
  return typeof value === 'string' && CT_IV_RE.test(value)
}

/** null = нет сеанса: значение НЕ пишем в открытом виде, вызывающий обязан отказать. */
export async function sealField(entryId: string, plain: string): Promise<string | null> {
  const key = await entryKey(entryId)
  if (!key) return null
  const { ctB64, ivB64 } = await aesEncrypt(key, plain)
  return `${ctB64}:${ivB64}`
}

export async function openField(entryId: string, packed: string): Promise<string | null> {
  if (!isSealed(packed)) return packed || ''
  const key = await entryKey(entryId)
  if (!key) return null
  const i = packed.indexOf(':')
  return aesDecrypt(key, packed.slice(0, i), packed.slice(i + 1))
}

/* ---------- бэкапы и экспорт: собственный пароль, свой KDF ---------- */

import { deriveMasterKey } from './crypto-vault'

export type PortableBlob = { v: 1; kdf: 'pbkdf2'; it: number; salt: string; ct: string; iv: string }

const PORTABLE_ITERATIONS = 600_000

/** Зашифрованный снимок: открывается своим паролем на любом устройстве. */
export async function sealPortable(password: string, json: string): Promise<PortableBlob> {
  const salt = randomBytesOf(16)
  const key = await deriveMasterKey(password, salt, PORTABLE_ITERATIONS)
  const { ctB64, ivB64 } = await aesEncrypt(key, json)
  return {
    v: 1,
    kdf: 'pbkdf2',
    it: PORTABLE_ITERATIONS,
    salt: bytesToB64(salt),
    ct: ctB64,
    iv: ivB64,
  }
}

export async function openPortable(password: string, blob: PortableBlob): Promise<string | null> {
  const key = await deriveMasterKey(password, b64ToBytes(blob.salt), blob.it || PORTABLE_ITERATIONS)
  return aesDecrypt(key, blob.ct, blob.iv)
}

export function isPortableBlob(x: unknown): x is PortableBlob {
  if (typeof x !== 'object' || x === null) return false
  const b = x as Record<string, unknown>
  return (
    b.v === 1 &&
    typeof b.salt === 'string' &&
    typeof b.ct === 'string' &&
    typeof b.iv === 'string' &&
    typeof b.it === 'number'
  )
}

/* ---------- локальные бэкапы под мастер-ключом сеанса ---------- */

export async function sealWithMaster(json: string): Promise<{ ct: string; iv: string } | null> {
  const master = getMasterSession()
  if (!master) return null
  const { ctB64, ivB64 } = await aesEncrypt(master, json)
  return { ct: ctB64, iv: ivB64 }
}

export async function openWithMaster(ct: string, iv: string): Promise<string | null> {
  const master = getMasterSession()
  if (!master) return null
  return aesDecrypt(master, ct, iv)
}
