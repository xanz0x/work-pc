/* ============================================================
   DB · синхронизация вкладок (§1.5 хвоста волны 2)
   Пока документы лежали в localStorage, вкладки синхронизировались
   бесплатно событием `storage`. В IndexedDB таких событий нет — две
   вкладки расходились молча. Продуктовое решение: живая синхронизация
   через BroadcastChannel. Пишущая вкладка объявляет ключ, остальные
   перечитывают именно его. Своя вкладка сообщение не получает.
   ============================================================ */

export const DOC_CHANNEL_ID = 'workflow-docs'

export type DocSyncMsg = { key: string; at: number }

export function readDocSyncMsg(data: unknown): DocSyncMsg | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Partial<DocSyncMsg>
  if (typeof m.key !== 'string' || !m.key) return null
  return { key: m.key, at: typeof m.at === 'number' ? m.at : 0 }
}

let channel: BroadcastChannel | null = null
const listeners = new Map<string, Set<() => void>>()

function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (channel) return channel
  channel = new BroadcastChannel(DOC_CHANNEL_ID)
  channel.onmessage = (e: MessageEvent) => {
    const msg = readDocSyncMsg(e.data)
    if (!msg) return
    listeners.get(msg.key)?.forEach((fn) => fn())
  }
  return channel
}

/** Объявить другим вкладкам: документ изменился. */
export function publishDocChange(key: string): void {
  try {
    ensureChannel()?.postMessage({ key, at: Date.now() } satisfies DocSyncMsg)
  } catch {
    /* канала нет — вкладка остаётся с локальной копией */
  }
}

/** Подписка на изменения одного документа из других вкладок. */
export function subscribeDocChange(key: string, fn: () => void): () => void {
  ensureChannel()
  const set = listeners.get(key) ?? new Set<() => void>()
  set.add(fn)
  listeners.set(key, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) listeners.delete(key)
  }
}

/** Только для тестов: закрыть канал и снять подписки. */
export function resetDocSync(): void {
  listeners.clear()
  try {
    channel?.close()
  } catch {
    /* уже закрыт */
  }
  channel = null
}
