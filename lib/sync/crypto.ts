/* ============================================================
   NF-11 · ключи синхронизации
   Из 12 слов BIP39 (128 бит энтропии) через HKDF выводятся три значения:
   ключ шифрования AES-GCM, идентификатор пространства и «пароль
   пространства». Сервер знает только идентификатор и хеш пароля — оба
   односторонние производные, из них ключ не восстановить. Ключ
   синхронизации не связан с мастер-ключом замка: его можно показать
   и ввести на другом устройстве, не раскрывая замок.
   ============================================================ */

import { entropyToMnemonic, mnemonicToEntropy } from '@/lib/bip39'
import { aesDecrypt, aesEncrypt } from '@/lib/crypto-vault'
import { isOp, type Op } from './crdt'

export type SyncKeys = {
  key: CryptoKey
  spaceId: string
  spacePass: string
}

const enc = new TextEncoder()

function hex(b: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
}

async function hkdf(material: CryptoKey, info: string, bits: number): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('wsx-sync.v1'), info: enc.encode(info) },
    material,
    bits,
  )
}

export async function keysFromEntropy(entropy: Uint8Array): Promise<SyncKeys> {
  const material = await crypto.subtle.importKey('raw', entropy as BufferSource, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('wsx-sync.v1'), info: enc.encode('enc') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return {
    key,
    spaceId: hex(await hkdf(material, 'space-id', 128)),
    spacePass: hex(await hkdf(material, 'space-pass', 256)),
  }
}

export async function keysFromWords(words: string[]): Promise<SyncKeys | null> {
  const entropy = await mnemonicToEntropy(words)
  return entropy ? keysFromEntropy(entropy) : null
}

export function newEntropy(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export async function wordsFromEntropy(entropy: Uint8Array): Promise<string[]> {
  return entropyToMnemonic(entropy)
}

export type Sealed = { ct: string; iv: string }

export async function sealJson(key: CryptoKey, value: unknown): Promise<Sealed> {
  const { ctB64, ivB64 } = await aesEncrypt(key, JSON.stringify(value))
  return { ct: ctB64, iv: ivB64 }
}

export async function openJson(key: CryptoKey, s: Sealed): Promise<unknown | null> {
  const text = await aesDecrypt(key, s.ct, s.iv)
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Пачка операций одним шифртекстом: меньше IV, меньше строк на сервере. */
export async function sealOps(key: CryptoKey, ops: Op[]): Promise<Sealed> {
  return sealJson(key, ops)
}

export async function openOps(key: CryptoKey, s: Sealed): Promise<Op[] | null> {
  const v = await openJson(key, s)
  if (!Array.isArray(v) || !v.every(isOp)) return null
  return v
}

/** Хекс-строки для localStorage: энтропия хранится только на устройстве. */
export function entropyToHex(e: Uint8Array): string {
  return hex(e)
}

export function hexToEntropy(h: string): Uint8Array | null {
  if (!/^[a-f0-9]{32}$/.test(h)) return null
  return new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)))
}
