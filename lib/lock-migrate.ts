/* ============================================================
   LOCK-MIGRATE · перевод замка на PBKDF2 600 000 итераций
   Гейт из ТЗ: миграция затрагивает существующие данные, поэтому
   она ленивая (при первом успешном unlock), атомарная и с бэкапом.

   Что переупаковывается под новый мастер-ключ:
   1. обёртки мастера (wct/wiv) файловых ключей — словарь wf.filekeys.map.v1;
   2. секреты locked-стикеров (`ct:iv`, зашифрованы мастером сеанса);
   3. wf.secrets.sek.v1 — ключ сейфа секретов.
   Пароль файла (pct/piv) и сами файловые ключи не меняются, поэтому
   «уровень B» продолжает открываться теми же паролями.
   ============================================================ */

import {
  LEGACY_LOCK_ITERATIONS,
  LOCK_ITERATIONS,
  SALT_BYTES,
  VERIFIER_TEXT,
  aesDecrypt,
  aesEncrypt,
  b64ToBytes,
  bytesToB64,
  deriveMasterKey,
  randomBytesOf,
  readLockState,
  writeLockState,
  type LockStateBlob,
} from './crypto-vault'
import {
  fileKeysSnapshot,
  loadFileKeys,
  replaceFileKeys,
  type FileKeyMap,
} from './file-keys-store'
import { SECRETS_SEK_KEY } from './secrets-crypto'

export type MigratableNote = { id: string; locked: boolean; secret: string | null }
export type NotePatch = (id: string, secret: string) => void

const CT_IV_RE = /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* приватный режим */
  }
}

type WrapPair = { ct: string; iv: string }

async function reWrap(
  oldKey: CryptoKey,
  newKey: CryptoKey,
  pair: WrapPair,
): Promise<WrapPair | null> {
  const plain = await aesDecrypt(oldKey, pair.ct, pair.iv)
  if (plain === null) return null
  const next = await aesEncrypt(newKey, plain)
  return { ct: next.ctB64, iv: next.ivB64 }
}

export type RewrapReport = { files: number; notes: number; sek: boolean; broken: number }

/**
 * Переупаковать всё, что было завёрнуто старым мастер-ключом, под новый.
 * Используется и ленивой KDF-миграцией, и сменой мастер-ключа.
 */
export async function rewrapAll(
  oldKey: CryptoKey,
  newKey: CryptoKey,
  notes: MigratableNote[],
  patchNoteSecret: NotePatch,
): Promise<RewrapReport> {
  const report: RewrapReport = { files: 0, notes: 0, sek: false, broken: 0 }

  await loadFileKeys()
  const map: FileKeyMap = { ...fileKeysSnapshot() }
  let changed = false
  for (const [id, blob] of Object.entries(map)) {
    const next = await reWrap(oldKey, newKey, { ct: blob.wct, iv: blob.wiv })
    if (!next) {
      report.broken++
      continue
    }
    map[id] = { ...blob, wct: next.ct, wiv: next.iv }
    changed = true
    report.files++
  }
  if (changed) await replaceFileKeys(map)

  for (const n of notes) {
    if (!n.locked || !n.secret || !CT_IV_RE.test(n.secret)) continue
    const i = n.secret.indexOf(':')
    const next = await reWrap(oldKey, newKey, { ct: n.secret.slice(0, i), iv: n.secret.slice(i + 1) })
    if (!next) {
      report.broken++
      continue
    }
    patchNoteSecret(n.id, `${next.ct}:${next.iv}`)
    report.notes++
  }

  const sekRaw = lsGet(SECRETS_SEK_KEY)
  if (sekRaw) {
    try {
      const blob = JSON.parse(sekRaw) as Record<string, unknown>
      if (typeof blob.wct === 'string' && typeof blob.wiv === 'string') {
        const next = await reWrap(oldKey, newKey, { ct: blob.wct, iv: blob.wiv })
        if (next) {
          lsSet(SECRETS_SEK_KEY, JSON.stringify({ ...blob, wct: next.ct, wiv: next.iv }))
          report.sek = true
        } else {
          report.broken++
        }
      }
    } catch {
      report.broken++
    }
  }

  return report
}

export type KdfMigration =
  | { migrated: false; reason: 'up-to-date' | 'no-state' | 'failed' }
  | { migrated: true; from: number; to: number; report: RewrapReport }

/**
 * Ленивая миграция KDF. Вызывается ТОЛЬКО после успешной проверки пароля:
 * до записи нового состояния делается бэкап старого (идемпотентно, п.4.10 ТЗ).
 */
export async function migrateKdfIterations(
  secret: string,
  notes: MigratableNote[],
  patchNoteSecret: NotePatch,
): Promise<KdfMigration> {
  const st = readLockState()
  if (!st) return { migrated: false, reason: 'no-state' }
  if (st.iterations >= LOCK_ITERATIONS) return { migrated: false, reason: 'up-to-date' }

  try {
    const oldKey = await deriveMasterKey(secret, b64ToBytes(st.saltB64), st.iterations)
    /* Проверка на всякий случай: чужим ключом ничего не переупаковываем. */
    if ((await aesDecrypt(oldKey, st.verifierB64, st.ivB64)) !== VERIFIER_TEXT) {
      return { migrated: false, reason: 'failed' }
    }

    const salt = randomBytesOf(SALT_BYTES)
    const newKey = await deriveMasterKey(secret, salt, LOCK_ITERATIONS)
    const verifier = await aesEncrypt(newKey, VERIFIER_TEXT)

    /* Бэкап старой схемы до записи новой. */
    const backup = {
      at: Date.now(),
      state: st,
      fileKeys: (await loadFileKeys(), fileKeysSnapshot()),
      sek: lsGet(SECRETS_SEK_KEY),
      noteSecrets: notes.filter((n) => n.locked && n.secret).map((n) => ({ id: n.id, secret: n.secret })),
    }
    lsSet(`wf.lock.migrate.backup.${backup.at}`, JSON.stringify(backup))

    const report = await rewrapAll(oldKey, newKey, notes, patchNoteSecret)

    const next: LockStateBlob = {
      v: 1,
      saltB64: bytesToB64(salt),
      verifierB64: verifier.ctB64,
      ivB64: verifier.ivB64,
      iterations: LOCK_ITERATIONS,
      failCount: 0,
      lastFailAt: 0,
      cooldownUntil: 0,
    }
    writeLockState(next)
    return {
      migrated: true,
      from: st.iterations || LEGACY_LOCK_ITERATIONS,
      to: LOCK_ITERATIONS,
      report,
    }
  } catch {
    return { migrated: false, reason: 'failed' }
  }
}
