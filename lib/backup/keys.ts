/* ============================================================
   NF-7 · КЛЮЧЕВОЙ МАТЕРИАЛ СНИМКА
   Всё, что в сейфе завёрнуто МАСТЕР-КЛЮЧОМ этого устройства, на чистом
   устройстве бесполезно: там другой мастер. Поэтому снимок несёт сырьё —
   SEK менеджера секретов, сырые файловые ключи и открытые секреты
   locked-стикеров, — а восстановление заворачивает их заново под мастер
   принимающего устройства.

   Сырьё лежит ВНУТРИ снимка, зашифрованного отдельным паролем
   (sealPortable: PBKDF2 600 000 → AES-GCM-256). Наружу оно не выходит и
   собирается только внутри открытого сеанса: без мастер-сессии секция
   ключей отсутствует, и снимок честно об этом сообщает.
   ============================================================ */

import { aesDecrypt, aesEncrypt } from '@/lib/crypto-vault'
import { getMasterSession } from '@/hooks/use-file-keys'
import { adoptSekRaw, exportSekRaw } from '@/lib/secrets-crypto'
import {
  fileKeysSnapshot,
  loadFileKeys,
  replaceFileKeys,
  resetFileKeysCache,
  type FileKeyMap,
} from '@/lib/file-keys-store'
import { docs } from '@/lib/db'
import { NOTES_DOC } from './registry'

export type KeyMaterial = {
  v: 1
  /** Сырьё ключа сейфа секретов (b64), null — сеанса секретов не было. */
  sek: string | null
  /** id файла → сырьё файлового ключа (b64). */
  fileKeys: Record<string, string>
  /** id стикера → открытый секрет. */
  noteSecrets: Record<string, string>
}

export type KeyReport = { sek: boolean; files: number; notes: number; broken: number }

const CT_IV_RE = /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/

type NoteLike = { id: string; locked?: boolean; secret?: unknown }

function notesOf(value: unknown): NoteLike[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (n): n is NoteLike => typeof n === 'object' && n !== null && typeof (n as NoteLike).id === 'string',
  )
}

/** null = нет сеанса мастера: ключи в снимок не попадут. */
export async function collectKeyMaterial(notesDoc: unknown): Promise<KeyMaterial | null> {
  const master = getMasterSession()
  if (!master) return null

  const fileKeys: Record<string, string> = {}
  await loadFileKeys()
  for (const [id, blob] of Object.entries(fileKeysSnapshot())) {
    const raw = await aesDecrypt(master, blob.wct, blob.wiv)
    if (raw !== null) fileKeys[id] = raw
  }

  const noteSecrets: Record<string, string> = {}
  for (const n of notesOf(notesDoc)) {
    if (n.locked !== true || typeof n.secret !== 'string' || !CT_IV_RE.test(n.secret)) continue
    const i = n.secret.indexOf(':')
    const plain = await aesDecrypt(master, n.secret.slice(0, i), n.secret.slice(i + 1))
    if (plain !== null) noteSecrets[n.id] = plain
  }

  return { v: 1, sek: exportSekRaw(), fileKeys, noteSecrets }
}

export function isKeyMaterial(x: unknown): x is KeyMaterial {
  if (typeof x !== 'object' || x === null) return false
  const b = x as Partial<KeyMaterial>
  return (
    (b.sek === null || typeof b.sek === 'string') &&
    typeof b.fileKeys === 'object' &&
    b.fileKeys !== null &&
    typeof b.noteSecrets === 'object' &&
    b.noteSecrets !== null
  )
}

/**
 * Завернуть сырьё снимка под мастер-ключ ЭТОГО устройства.
 * Вызывается ПОСЛЕ того, как документы модулей уже записаны: обёртки
 * файловых ключей и секреты стикеров правятся поверх восстановленных.
 */
export async function applyKeyMaterial(km: KeyMaterial): Promise<KeyReport> {
  const report: KeyReport = { sek: false, files: 0, notes: 0, broken: 0 }
  const master = getMasterSession()
  if (!master) return report

  if (km.sek) report.sek = await adoptSekRaw(km.sek)

  const ids = Object.keys(km.fileKeys)
  if (ids.length > 0) {
    /* Словарь только что перезаписан снимком — читаем его заново. */
    resetFileKeysCache()
    const map: FileKeyMap = { ...(await loadFileKeys()) }
    for (const id of ids) {
      const blob = map[id]
      if (!blob) {
        report.broken++
        continue
      }
      const wrapped = await aesEncrypt(master, km.fileKeys[id])
      map[id] = { ...blob, wct: wrapped.ctB64, wiv: wrapped.ivB64 }
      report.files++
    }
    await replaceFileKeys(map)
  }

  const secretIds = Object.keys(km.noteSecrets)
  if (secretIds.length > 0) {
    const stored = await docs.get(NOTES_DOC)
    const list = notesOf(stored)
    if (list.length > 0) {
      const next: unknown[] = []
      for (const n of list) {
        const plain = km.noteSecrets[n.id]
        if (plain === undefined) {
          next.push(n)
          continue
        }
        const packed = await aesEncrypt(master, plain)
        next.push({ ...n, secret: `${packed.ctB64}:${packed.ivB64}` })
        report.notes++
      }
      await docs.put(NOTES_DOC, next)
    }
  }

  return report
}
