/* ============================================================
   NF-8 · ФЛАГИ И АВТОНОМНЫЙ РЕЖИМ
   Одно волатильное хранилище на весь продукт: `wf.flags.v1` в
   localStorage. Именно localStorage, а не IndexedDB — обёртка над fetch
   (lib/net.ts) обязана знать про автономный режим СИНХРОННО, до первого
   исходящего запроса, иначе запрет опаздывает на промис.

   Флаги переживают перезагрузку, потому что читаются из того же ключа,
   и переживают вторую вкладку, потому что на `storage` мы подписаны.
   ============================================================ */

import { useSyncExternalStore } from 'react'

export const FLAGS_KEY = 'wf.flags.v1'

export type FlagId = 'dev' | 'experimental' | 'mcp.skeleton'

export type FlagsState = {
  v: 1
  flags: Record<FlagId, boolean>
  /** Автономный режим: любой исходящий запрос запрещён (lib/net.ts). */
  offline: boolean
}

export const FLAG_META: { id: FlagId; label: string; note: string }[] = [
  {
    id: 'dev',
    label: 'Режим разработчика',
    note: 'Диагностическая строка в статус-баре: сборка, версия схемы, счётчик запрещённых запросов',
  },
  {
    id: 'experimental',
    label: 'Экспериментальные функции',
    note: 'Открывает слияние при восстановлении бэкапа: модуль дополняется снимком, а не заменяется им',
  },
  {
    id: 'mcp.skeleton',
    label: 'Каркас MCP',
    note: 'Открывает вкладку MCP в AI-центре и скилл notion_pull. Клиента MCP в сборке нет: ответы — макет, помеченный плашкой',
  },
]

export const DEFAULT_FLAGS: FlagsState = {
  v: 1,
  flags: { dev: false, experimental: false, 'mcp.skeleton': false },
  offline: false,
}

function normalize(raw: unknown): FlagsState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_FLAGS
  const box = raw as Partial<FlagsState>
  const flags = { ...DEFAULT_FLAGS.flags }
  if (typeof box.flags === 'object' && box.flags !== null) {
    for (const meta of FLAG_META) {
      flags[meta.id] = (box.flags as Record<string, unknown>)[meta.id] === true
    }
  }
  return { v: 1, flags, offline: box.offline === true }
}

/* Снимок кэшируется: useSyncExternalStore требует стабильной ссылки. */
let cached: FlagsState | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export function readFlags(): FlagsState {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(FLAGS_KEY)
    cached = raw === null ? DEFAULT_FLAGS : normalize(JSON.parse(raw))
  } catch {
    cached = DEFAULT_FLAGS
  }
  return cached
}

export function writeFlags(next: FlagsState): void {
  cached = normalize(next)
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(cached))
  } catch {
    /* приватный режим — флаги проживут сессию */
  }
  emit()
}

export function setFlag(id: FlagId, on: boolean): FlagsState {
  const cur = readFlags()
  const next: FlagsState = { ...cur, flags: { ...cur.flags, [id]: on } }
  writeFlags(next)
  return next
}

export function isFlagOn(id: FlagId): boolean {
  return readFlags().flags[id] === true
}

export function setOffline(on: boolean): FlagsState {
  const next: FlagsState = { ...readFlags(), offline: on }
  writeFlags(next)
  return next
}

export function isOffline(): boolean {
  return readFlags().offline
}

export function subscribeFlags(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Только для тестов и для события `storage`: следующий read перечитает ключ. */
export function resetFlagsCache(): void {
  cached = null
  emit()
}

let tabSync = false

/** Другая вкладка переключила флаг — забываем кэш и перерисовываемся. */
function ensureTabSync(): void {
  if (tabSync || typeof window === 'undefined') return
  tabSync = true
  window.addEventListener('storage', (e) => {
    if (e.key === FLAGS_KEY || e.key === null) resetFlagsCache()
  })
}

export function useFlags(): FlagsState {
  ensureTabSync()
  return useSyncExternalStore(
    (fn) => subscribeFlags(fn),
    () => readFlags(),
    () => DEFAULT_FLAGS,
  )
}
