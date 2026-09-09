/* ============================================================
   NF-7 · РАСПИСАНИЕ СНИМКОВ
   Планировщик клиентский и честный: серверного cron у локального
   продукта нет, поэтому «раз в день» означает «при открытии приложения
   проверим, не просрочено ли». Просрочку считает чистая функция —
   её же проверяет тест, а не глаза.
   ============================================================ */

import type { BackupConfig, Schedule, SnapshotMeta } from './store'
import { readConfig, recallPassword, writeConfig } from './store'
import { createSnapshot } from './create'
import type { LiveState } from './snapshot'

export const DAY_MS = 24 * 60 * 60 * 1000
export const WEEK_MS = 7 * DAY_MS

export function intervalOf(schedule: Schedule): number | null {
  if (schedule === 'daily') return DAY_MS
  if (schedule === 'weekly') return WEEK_MS
  return null
}

export function scheduleLabel(schedule: Schedule): string {
  return schedule === 'daily' ? 'каждый день' : schedule === 'weekly' ? 'каждую неделю' : 'выключено'
}

/** Когда планировщик ждёт следующий снимок; null — расписания нет. */
export function nextDueAt(cfg: BackupConfig): number | null {
  const interval = intervalOf(cfg.schedule)
  if (interval === null) return null
  return (cfg.lastAt ?? 0) + interval
}

export function isDue(cfg: BackupConfig, now: number): boolean {
  const due = nextDueAt(cfg)
  return due !== null && now >= due
}

export type DueResult =
  | { ran: true; meta: SnapshotMeta }
  | { ran: false; reason: 'off' | 'not-due' | 'no-password' | 'failed' }

/**
 * Проверка при запуске приложения. Пароль берётся из обёртки под
 * мастер-ключом: без открытого сейфа авто-снимок не делается — и это
 * правильный отказ, а не молчание.
 */
export async function runDueBackup(
  now: number = Date.now(),
  live: LiveState = {},
): Promise<DueResult> {
  const cfg = await readConfig()
  if (cfg.schedule === 'off') return { ran: false, reason: 'off' }
  if (!isDue(cfg, now)) return { ran: false, reason: 'not-due' }
  const password = await recallPassword()
  if (!password) return { ran: false, reason: 'no-password' }
  const made = await createSnapshot(password, cfg.modules, true, live)
  if (!made) return { ran: false, reason: 'failed' }
  await writeConfig({ lastAt: made.meta.at })
  return { ran: true, meta: made.meta }
}
