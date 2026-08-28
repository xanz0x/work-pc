'use client'

/* ============================================================
   FILE-KEYS v3.2b · хук файловых ключей и криптомиграции (этап 5)
   План docs/architecture/lock-system.md: п.4 (wrapped = AES-GCM(masterKey, fileKey)),
   п.10.6 (миграция стикеров), инвариант locked=true ⇒ secret вида ct:iv.
   Мастер-ключ живёт в памяти сессии РОВНО до lockNow()/конца сессии
   (кэширование после блокировки запрещено п.10.8) — ссылка обнуляется
   при уходе статуса из 'unlocked'. vault-store не трогаем: всё локально.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FILE_KEY_PREFIX,
  aesDecrypt,
  aesEncrypt,
  deriveMasterKey,
  failDelayMs,
  readLockState,
} from '@/lib/crypto-vault'
import { LOCK_MIGRATED_KEY } from '@/lib/lock-store'

const FK_VERIFIER = 'wf-filekey-v1'
/** Инвариант 10.6: шифртекст stored as `<ctB64>:<ivB64>`. */
const CT_IV_RE = /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/

/* ---------- base64 (локально, чтобы не трогать готовое ядро) ---------- */

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/* ---------- сессионный мастер-ключ (модульный уровень) ---------- */

let masterRef: CryptoKey | null = null

export function hasMasterSession(): boolean {
  return masterRef !== null
}

/**
 * Ключ сеанса для модулей, которые строятся ПОВЕРХ замка (менеджер секретов).
 * Отдаём сам CryptoKey (он неэкстрагируемый), а не секрет пользователя.
 */
export function getMasterSession(): CryptoKey | null {
  return masterRef
}

/**
 * Принять мастер-ключ в память сессии. Вызывается ТОЛЬКО сразу после
 * успешной проверки пароля (verifyMasterSecret уже подтвердил его).
 */
export async function adoptMasterSession(secret: string): Promise<boolean> {
  const st = readLockState()
  if (!st) return false
  try {
    masterRef = await deriveMasterKey(secret, b64ToBytes(st.saltB64), st.iterations)
    return true
  } catch {
    return false
  }
}

/** lockNow() или конец сессии: ссылка обязана обнулиться (п.10.8). */
export function dropMasterSession(): void {
  masterRef = null
}

/* ---------- секреты стикеров: формат ct:iv ---------- */

export function looksEncrypted(secret: unknown): boolean {
  return typeof secret === 'string' && CT_IV_RE.test(secret)
}

async function encryptToVault(plaintext: string): Promise<string> {
  if (!masterRef) throw new Error('нет сессии мастера')
  const { ctB64, ivB64 } = await aesEncrypt(masterRef, plaintext)
  return `${ctB64}:${ivB64}`
}

async function decryptFromVault(packed: string): Promise<string | null> {
  if (!masterRef) return null
  const i = packed.indexOf(':')
  if (i <= 0) return null
  return aesDecrypt(masterRef, packed.slice(0, i), packed.slice(i + 1))
}

type MigratableNote = { id: string; locked: boolean; secret: string | null }
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type PatchFn = (id: string, fn: (n: any) => any) => void

export type PackResult =
  | { kind: 'ct'; value: string }
  | { kind: 'no-session' }
  | { kind: 'off' }

/**
 * Одноразовая миграция п.10.6: plaintext-секрет locked-стикеров → ct:iv.
 * Идемпотентна: маркер LOCK_MIGRATED_KEY + пропуск уже зашифрованных.
 */
export async function migrateLockedNotes(
  notes: MigratableNote[],
  patchNote: PatchFn,
): Promise<number> {
  try {
    if (localStorage.getItem(LOCK_MIGRATED_KEY) === '1') return 0
  } catch {
    /* нет storage — работаем как раньше */
    return 0
  }
  let migrated = 0
  for (const n of notes) {
    if (!n.locked || !n.secret || looksEncrypted(n.secret)) continue
    try {
      const packed = await encryptToVault(n.secret)
      /* fn обязана вернуть полный объект заметки (см. patchNote в vault-store). */
      patchNote(n.id, (prev: MigratableNote & Record<string, unknown>) => ({ ...prev, secret: packed }))
      migrated++
    } catch {
      /* один стикер не блокирует остальных; ретрай при следующем unlock */
    }
  }
  try {
    localStorage.setItem(LOCK_MIGRATED_KEY, '1')
  } catch {
    /* приватный режим — миграция повторится за сессию один раз по маркеру в памяти */
  }
  return migrated
}

/* ---------- файловые ключи: wrapped-хранение ---------- */

type FileKeyBlob = {
  v: 1
  /** обёртка мастера: AES-GCM(masterKey, fileKeyRaw-b64) — доступ только у открытого сеанса. */
  wct: string
  wiv: string
  /** обёртка пароля файла: AES-GCM(PBKDF2(password, saltOf(fileId)), fileKeyRaw-b64) — «уровень B». */
  pct: string
  piv: string
  /** верификатор под самим файловым ключом. */
  kct: string
  kiv: string
  /** зашифрованное описание desc (файловым ключом). */
  dct?: string
  div?: string
}

/** Детерминированная соль пароля файла — как fileSalt() ядра ('wf.filekey.'+id). */
async function fkSaltBytes(fileId: string): Promise<Uint8Array> {
  const d = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`wf.filekey.${fileId}`) as BufferSource,
  )
  return new Uint8Array(d.slice(0, 16))
}

async function importRaw(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    b64ToBytes(b64) as BufferSource,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  )
}

/* ---------- публичные проверки без хука (для карточек доски) ---------- */

/** '' = нет сессии мастера; иначе верно/неверно. Используется и в useFileKeys. */
export async function checkStickerSecret(packed: string, plain: string): Promise<boolean | ''> {
  if (!masterRef) return ''
  const pt = await decryptFromVault(packed)
  return pt !== null && pt === plain
}

function fkRead(fileId: string): FileKeyBlob | null {
  try {
    const raw = localStorage.getItem(FILE_KEY_PREFIX + fileId)
    if (!raw) return null
    const p: unknown = JSON.parse(raw)
    if (
      typeof p === 'object' && p !== null &&
      (p as FileKeyBlob).v === 1 && typeof (p as FileKeyBlob).wct === 'string'
    ) {
      return p as FileKeyBlob
    }
    return null
  } catch {
    return null
  }
}

function fkWrite(fileId: string, blob: FileKeyBlob): void {
  try {
    localStorage.setItem(FILE_KEY_PREFIX + fileId, JSON.stringify(blob))
  } catch {
    /* приватный режим — ключ проживёт сессию не дольше памяти */
  }
}

export type FileKeyOpenResult =
  | { ok: true; desc: string | null }
  | { ok: false; reason: 'missing' | 'needUnlock' | 'wrong'; delayMs: number }

export function useFileKeys(opts: {
  status: 'off' | 'locked' | 'unlocked'
  fileKeysCount?: number
  notes: MigratableNote[]
  patchNote: PatchFn
}) {
  const { status } = opts

  /** id защищённых файлов (по localStorage) — реактивно через Set. */
  const [protectedIds, setProtectedIds] = useState<Set<string>>(() => new Set())
  /** Файлы, открытые файловым ключом: до lockNow() или конца сессии. */
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  /** Расшифрованные описания открытых файлов (только память сессии). */
  const [openDescs, setOpenDescs] = useState<Record<string, string>>({})
  /** Anti-брутфорс: счётчик неудач на файл — только память хука. */
  const failCountsRef = useRef<Map<string, number>>(new Map())

  const notesRef = useRef(opts.notes)
  notesRef.current = opts.notes
  const patchRef = useRef(opts.patchNote)
  patchRef.current = opts.patchNote

  const rescan = useCallback(() => {
    const ids = new Set<string>()
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(FILE_KEY_PREFIX)) ids.add(k.slice(FILE_KEY_PREFIX.length))
      }
    } catch {
      /* нет доступа к storage */
    }
    setProtectedIds(ids)
  }, [])

  useEffect(rescan, [rescan, opts.fileKeysCount])

  /* Блокировка/выключение замка: мастер обнуляется, открытия сбрасываются. */
  useEffect(() => {
    if (status !== 'unlocked') {
      dropMasterSession()
      setOpenIds(new Set())
      setOpenDescs({})
      failCountsRef.current.clear()
    }
  }, [status])

  /* Миграция п.10.6: одноразово после разблокировки сейфа. */
  useEffect(() => {
    if (status !== 'unlocked' || !masterRef) return
    let marker: string | null = null
    try {
      marker = localStorage.getItem(LOCK_MIGRATED_KEY)
    } catch {
      return
    }
    if (marker === '1') return
    void migrateLockedNotes(notesRef.current, patchRef.current)
  }, [status])

  const isProtected = useCallback((fileId: string) => protectedIds.has(fileId), [protectedIds])
  const isOpen = useCallback((fileId: string) => openIds.has(fileId), [openIds])

  /**
   * Зашифровать новый секрет для store'а (locked=true ⇒ ct:iv).
   * 'off' = замок выключен, демо-режим без криптографии;
   * 'no-session' = замок включён, но сессии мастера нет.
   */
  const packSecret = useCallback(async (plain: string): Promise<PackResult> => {
    let migrated = false
    try {
      migrated = localStorage.getItem(LOCK_MIGRATED_KEY) === '1'
    } catch {
      return { kind: 'off' }
    }
    if (!migrated) return { kind: 'off' }
    if (!masterRef) return { kind: 'no-session' }
    try {
      return { kind: 'ct', value: await encryptToVault(plain) }
    } catch {
      return { kind: 'no-session' }
    }
  }, [])

  /** Проверка ключа стикера после миграции: делегирует модулю сессии мастера. */
  const checkSticker = checkStickerSecret

  const canPack = useCallback(() => hasMasterSession(), [])

  /**
   * Поставить файл на ключ (п.4): случайный fileKeyRaw 32B оборачивается
   * ДВУМЯ факторами — мастер-ключом открытого сеанса и паролем файла
   * (PBKDF2(пароль, детерминированная соль fileId)) — в wf.vault.keys.<id>;
   * desc шифруется самим файловым ключом. Замечание к п.10.8: master CryptoKey
   * неэкстрагируем, поэтому «wrapped = AES-GCM(masterKey, …)» держит raw-ключ,
   * а пароль файла проверяется отдельно через свою обёртку того же ключа.
   */
  const setFileKey = useCallback(
    async (fileId: string, password: string, currentDesc: string): Promise<FileKeyOpenResult> => {
      if (!masterRef) return { ok: false, reason: 'needUnlock', delayMs: 0 }
      try {
        const raw = new Uint8Array(32)
        crypto.getRandomValues(raw)
        const rawB64 = bytesToB64(raw)
        const fk = await importRaw(rawB64)
        const ver = await aesEncrypt(fk, FK_VERIFIER)
        const wrapMaster = await aesEncrypt(masterRef, rawB64)
        const pkWrap = await deriveMasterKey(password, await fkSaltBytes(fileId))
        const wrapPw = await aesEncrypt(pkWrap, rawB64)
        const descPack = currentDesc ? await aesEncrypt(fk, currentDesc) : null
        fkWrite(fileId, {
          v: 1,
          wct: wrapMaster.ctB64,
          wiv: wrapMaster.ivB64,
          pct: wrapPw.ctB64,
          piv: wrapPw.ivB64,
          kct: ver.ctB64,
          kiv: ver.ivB64,
          ...(descPack ? { dct: descPack.ctB64, div: descPack.ivB64 } : {}),
        })
      } catch {
        return { ok: false, reason: 'needUnlock', delayMs: 0 }
      }
      rescan()
      return { ok: true, desc: null }
    },
    [rescan],
  )

  /** Открыть защищённый файл: нужен сеанс мастера И пароль файла; неверно → задержка 1s→2s→4s… */
  const openWithFileKey = useCallback(
    async (fileId: string, password: string): Promise<FileKeyOpenResult> => {
      const blob = fkRead(fileId)
      if (!blob) return { ok: false, reason: 'missing', delayMs: 0 }
      if (!masterRef) return { ok: false, reason: 'needUnlock', delayMs: 0 }

      /* Фактор «пароль файла»: расшифровываем сырьё ключа его обёрткой. */
      const pkWrap = await deriveMasterKey(password, await fkSaltBytes(fileId))
      const fromPw = await aesDecrypt(pkWrap, blob.pct, blob.piv)

      const fail = (): FileKeyOpenResult => {
        const fails = (failCountsRef.current.get(fileId) ?? 0) + 1
        failCountsRef.current.set(fileId, fails)
        // Задержка отсчитывается ПОСЛЕ неудачной попытки (п.10.8): возвращаем её.
        return { ok: false, reason: 'wrong' as const, delayMs: failDelayMs(fails) }
      }
      if (fromPw === null) return fail()

      /* Фактор «сеанс мастера»: та же строка должна выйти из обёртки мастера. */
      const fromMaster = await aesDecrypt(masterRef, blob.wct, blob.wiv)
      if (fromMaster === null || fromMaster !== fromPw) return fail()

      /* Целостность файла ключа + подготовка к расшифровке desc. */
      const fk = await importRaw(fromPw).catch(() => null)
      const verified = fk ? await aesDecrypt(fk, blob.kct, blob.kiv) : null
      if (verified !== FK_VERIFIER || !fk) return fail()

      failCountsRef.current.delete(fileId)
      let desc: string | null = null
      if (blob.dct && blob.div) desc = await aesDecrypt(fk, blob.dct, blob.div)
      setOpenIds((s) => (s.has(fileId) ? s : new Set(s).add(fileId)))
      if (desc !== null) setOpenDescs((m) => ({ ...m, [fileId]: desc! }))
      return { ok: true, desc }
    },
    [],
  )

  /** Убрать файловый ключ при удалении файла из сейфа. */
  const forgetKey = useCallback(
    (fileId: string) => {
      try {
        localStorage.removeItem(FILE_KEY_PREFIX + fileId)
      } catch {
        /* игнорируем */
      }
      setOpenIds((s) => {
        if (!s.has(fileId)) return s
        const next = new Set(s)
        next.delete(fileId)
        return next
      })
      rescan()
    },
    [rescan],
  )

  return {
    isProtected,
    isOpen,
    openDescOf: useCallback((id: string) => openDescs[id], [openDescs]),
    canPack,
    checkSticker,
    packSecret,
    setFileKey,
    openWithFileKey,
    forgetKey,
    hasSession: hasMasterSession,
  }
}
