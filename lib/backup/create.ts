/* ============================================================
   NF-7 · СОЗДАНИЕ И ОТКРЫТИЕ СНИМКА
   Крипта своя не изобретается: снимок заворачивается тем же
   sealPortable (PBKDF2 600 000 → AES-GCM-256), которым модуль секретов
   делает зашифрованный экспорт. Отдельный пароль — отдельный KDF:
   мастер-ключ устройства в снимок не входит.
   ============================================================ */

import { openPortable, sealPortable, type PortableBlob } from '@/lib/secrets-crypto'
import type { ModuleId } from './registry'
import {
  collectSnapshot,
  isSnapshotPayload,
  summarize,
  type LiveState,
  type SnapshotPayload,
} from './snapshot'
import { readConfig, saveSnapshot, type SnapshotMeta } from './store'

let seq = 0
const newId = () => `b-${Date.now().toString(36)}-${(seq++).toString(36)}`

export type CreatedSnapshot = {
  meta: SnapshotMeta
  blob: PortableBlob
  payload: SnapshotPayload
  dropped: SnapshotMeta[]
}

/**
 * Один снимок всех выбранных модулей под отдельным паролем.
 * Пустой пароль отвергаем: снимок без пароля — это открытый экспорт,
 * а он живёт в другом месте продукта и пишется в журнал иначе.
 * null также означает «не поместилось в хранилище»: молча терять снимок
 * нельзя, иначе список обещает копию, которой нет.
 */
export async function createSnapshot(
  password: string,
  ids: ModuleId[],
  auto = false,
  live: LiveState = {},
): Promise<CreatedSnapshot | null> {
  if (password.length < 8 || ids.length === 0) return null

  const payload = await collectSnapshot(ids, live)
  const json = JSON.stringify(payload)
  const blob = await sealPortable(password, json)
  const sum = summarize(payload)

  const meta: SnapshotMeta = {
    id: newId(),
    at: payload.at,
    auto,
    bytes: blob.ct.length,
    build: payload.build,
    modules: sum.modules.map((m) => ({ id: m.id, items: m.items, docs: m.docs })),
    hasKeys: payload.keys !== null,
  }

  const cfg = await readConfig()
  const saved = await saveSnapshot(meta, blob, cfg.keep)
  if (!saved.ok) return null
  return { meta, blob, payload, dropped: saved.dropped }
}

/** null = не тот пароль или снимок повреждён (GCM-тег не сошёлся). */
export async function openSnapshot(
  password: string,
  blob: PortableBlob,
): Promise<SnapshotPayload | null> {
  const json = await openPortable(password, blob)
  if (json === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  return isSnapshotPayload(parsed) ? parsed : null
}
