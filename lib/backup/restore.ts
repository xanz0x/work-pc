/* ============================================================
   NF-7 · ВОССТАНОВЛЕНИЕ
   Два режима:
     replace — модуль становится ровно таким, каким он был в снимке
               (round-trip: состояние идентично);
     merge   — снимок ДОПОЛНЯЕТ текущее состояние (флаг experimental):
               существующая версия записи побеждает, отсутствующие
               добавляются.

   Журнал безопасности не заменяется никогда: лента append-only, поэтому
   из снимка в неё доливаются только записи, которых на устройстве нет.
   ============================================================ */

import { docs } from '@/lib/db'
import { journalAppend } from '@/lib/db/idb'
import { mergeById } from '@/lib/db/merge'
import { logJournal, readJournal } from '@/lib/journal'
import { applyKeyMaterial, type KeyReport } from './keys'
import { moduleLabel, moduleOf, type ModuleId } from './registry'
import type { SnapshotPayload } from './snapshot'

export type RestoreMode = 'replace' | 'merge'

export type RestoreReport = {
  modules: ModuleId[]
  docs: number
  local: number
  journal: number
  keys: KeyReport
  mode: RestoreMode
}

function lsSet(key: string, raw: string): boolean {
  try {
    localStorage.setItem(key, raw)
    return true
  } catch {
    return false
  }
}

/**
 * Записать выбранные модули снимка в сейф.
 * Ключевой материал применяется последним: он правит уже записанные
 * обёртки файловых ключей и секреты стикеров.
 */
export async function restoreSnapshot(
  payload: SnapshotPayload,
  ids: ModuleId[],
  mode: RestoreMode = 'replace',
): Promise<RestoreReport> {
  const report: RestoreReport = {
    modules: [],
    docs: 0,
    local: 0,
    journal: 0,
    keys: { sek: false, files: 0, notes: 0, broken: 0 },
    mode,
  }

  for (const id of ids) {
    const data = payload.modules[id]
    const mod = moduleOf(id)
    if (!data || !mod) continue
    report.modules.push(id)

    for (const [key, value] of Object.entries(data.docs)) {
      if (mode === 'merge') {
        const current = await docs.get(key)
        await docs.put(key, current === undefined ? value : mergeById(value, current))
      } else {
        await docs.put(key, value)
      }
      report.docs++
    }
    for (const [key, raw] of Object.entries(data.local)) {
      if (lsSet(key, raw)) report.local++
    }
    if (mod.journal && data.journal) {
      const known = new Set((await readJournal()).map((e) => e.id))
      for (const entry of data.journal) {
        if (known.has(entry.id)) continue
        const { seq: _drop, ...rest } = entry
        await journalAppend(rest).catch(() => {})
        report.journal++
      }
    }
  }

  if (payload.keys) report.keys = await applyKeyMaterial(payload.keys)

  const names = report.modules.map(moduleLabel).join(', ')
  await logJournal(
    'backup-restore',
    'Сейф восстановлен из снимка',
    `Снимок от ${new Date(payload.at).toLocaleString('ru-RU')}, режим «${
      mode === 'merge' ? 'слияние' : 'замена'
    }». Модули: ${names || '—'}. Документов записано: ${report.docs}, ключей переупаковано: ${
      report.keys.files
    }.`,
  )

  return report
}
