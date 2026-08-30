/* ============================================================
   DB · миграция localStorage → IndexedDB (P0-3, шаг 2)
   Правило: сначала копия, потом проверка чтением, и только после
   успешного чтения на следующем запуске старые ключи убираются.
   Пока копия не подтверждена — localStorage остаётся бэкапом.
   ============================================================ */

import {
  META_LS_CLEANED,
  META_LS_MIGRATED,
  isMigratableKey,
} from './schema'
import { docGet, docPut, idbAvailable, metaGet, metaSet } from './idb'

export type MigrationReport = {
  copied: string[]
  skipped: string[]
  failed: string[]
  cleaned: string[]
}

function lsKeys(): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k) out.push(k)
    }
  } catch {
    /* приватный режим */
  }
  return out
}

/**
 * Переливает документы `wf.*` в IndexedDB.
 * Идемпотентна: то, что уже лежит в базе, повторно не перезаписывается.
 */
export async function migrateLocalStorage(): Promise<MigrationReport> {
  const report: MigrationReport = { copied: [], skipped: [], failed: [], cleaned: [] }
  if (!idbAvailable() || typeof localStorage === 'undefined') return report

  const already = (await metaGet<{ keys: string[]; at: number }>(META_LS_MIGRATED)) ?? null

  for (const key of lsKeys().filter(isMigratableKey)) {
    if ((await docGet(key)) !== undefined) {
      report.skipped.push(key)
      continue
    }
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      report.failed.push(key)
      continue
    }
    try {
      await docPut(key, parsed)
      // Проверка чтением: копия считается удачной только если читается обратно.
      if ((await docGet(key)) === undefined) throw new Error('копия не читается')
      report.copied.push(key)
    } catch {
      report.failed.push(key)
    }
  }

  const known = new Set([...(already?.keys ?? []), ...report.copied, ...report.skipped])
  await metaSet(META_LS_MIGRATED, { keys: [...known], at: Date.now() })

  /* Уборка бэкапа — на следующем запуске: к этому моменту приложение уже
     хотя бы раз прочитало данные из IndexedDB. */
  if (already && (await metaGet<number>(META_LS_CLEANED)) === undefined) {
    for (const key of already.keys) {
      if ((await docGet(key)) === undefined) continue
      try {
        localStorage.removeItem(key)
        report.cleaned.push(key)
      } catch {
        /* нет доступа — бэкап просто остаётся */
      }
    }
    await metaSet(META_LS_CLEANED, Date.now())
  }

  return report
}
