/* ============================================================
   ЖУРНАЛ БЕЗОПАСНОСТИ (LG-3)
   Append-only лента критических действий: смена мастера, сброс замка,
   экспорт без шифрования, восстановление бэкапа, стирание сейфа,
   «ИИ сохранил пароль», согласие и каждый исходящий облачный запрос.

   Три правила, из которых состоит смысл журнала:
     1. Только добавление. API удаления и очистки здесь нет — ни для UI,
        ни для другого кода. Записи живут в отдельном сторе IndexedDB
        (`journal`, autoIncrement), поэтому wipe сейфа, очистка ленты
        уведомлений и retention их не касаются.
     2. Записи ничего не раскрывают: в журнал идут факты и числа, а не
        пароли, значения полей и содержимое файлов.
     3. Журнал — источник ссылок для уведомлений: каждое событие имеет id,
        и уведомление ведёт на конкретную запись.
   ============================================================ */

import { journalAll, journalAppend } from './db/idb'

export type JournalKind =
  | 'lock-setup'
  | 'master-changed'
  | 'lock-disabled'
  | 'lock-reset'
  | 'key-declined'
  | 'plaintext-export'
  | 'backup-restore'
  | 'vault-wipe'
  | 'ai-saved-password'
  | 'cloud-consent'
  | 'cloud-request'
  | 'mcp-token-issued'
  | 'mcp-token-revoked'
  | 'mcp-call'
  | 'mcp-denied'
  | 'mcp-approval'
  | 'sync-enabled'
  | 'sync-disabled'
  | 'sync-device-revoked'
  | 'mail-account-added'
  | 'mail-account-removed'
  | 'mail-sent'
  | 'mail-auth-failed'

export type JournalEntry = {
  id: string
  kind: JournalKind
  at: number
  title: string
  /** Человеческое пояснение: что именно случилось и чем это стоит владельцу. */
  detail: string
  /** Номер в append-only ленте: ставит IndexedDB, задаёт порядок внутри одной миллисекунды. */
  seq?: number
}

/** Порядок — как в фильтре: сначала замок, затем данные, затем облако. */
export const JOURNAL_KINDS: { id: JournalKind; label: string; severe: boolean }[] = [
  { id: 'lock-setup', label: 'Замок включён', severe: false },
  { id: 'master-changed', label: 'Смена мастер-ключа', severe: true },
  { id: 'lock-disabled', label: 'Замок выключен', severe: true },
  { id: 'lock-reset', label: 'Сброс замка', severe: true },
  { id: 'key-declined', label: 'Отказ от мастер-ключа', severe: true },
  { id: 'plaintext-export', label: 'Экспорт без шифрования', severe: true },
  { id: 'backup-restore', label: 'Восстановление бэкапа', severe: false },
  { id: 'vault-wipe', label: 'Стирание сейфа', severe: true },
  { id: 'ai-saved-password', label: 'ИИ сохранил пароль', severe: false },
  { id: 'cloud-consent', label: 'Согласие на облако', severe: false },
  { id: 'cloud-request', label: 'Облачный запрос', severe: false },
  { id: 'mcp-token-issued', label: 'MCP · токен выдан', severe: false },
  { id: 'mcp-token-revoked', label: 'MCP · токен отозван', severe: false },
  { id: 'mcp-call', label: 'MCP · вызов агента', severe: false },
  { id: 'mcp-denied', label: 'MCP · отказ агенту', severe: false },
  { id: 'mcp-approval', label: 'MCP · подтверждение', severe: true },
  { id: 'sync-enabled', label: 'Синхронизация включена', severe: false },
  { id: 'sync-disabled', label: 'Синхронизация выключена', severe: false },
  { id: 'sync-device-revoked', label: 'Устройство отозвано', severe: true },
  { id: 'mail-account-added', label: 'Почта · ящик добавлен', severe: false },
  { id: 'mail-account-removed', label: 'Почта · ящик удалён', severe: false },
  { id: 'mail-sent', label: 'Почта · письмо отправлено', severe: false },
  { id: 'mail-auth-failed', label: 'Почта · отказ в авторизации', severe: false },
]

export function journalKindLabel(kind: JournalKind): string {
  return JOURNAL_KINDS.find((k) => k.id === kind)?.label ?? kind
}

/** Необратимое: то, что нельзя отменить и о чём стоит знать без захода в настройки. */
export function isSevereKind(kind: JournalKind): boolean {
  return JOURNAL_KINDS.find((k) => k.id === kind)?.severe === true
}

let seq = 0
const uid = () => `j-${Date.now().toString(36)}-${(seq++).toString(36)}`

/* Подписка для интерфейса: панель журнала перечитывает ленту по сигналу. */
const listeners = new Set<() => void>()

export function subscribeJournal(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Записать событие. Возвращает id записи — уведомление ссылается на него.
 * Ошибка записи не должна ломать действие пользователя: журнал честно
 * сообщает о провале в консоль, а само действие уже произошло.
 */
export async function logJournal(
  kind: JournalKind,
  title: string,
  detail: string,
): Promise<string> {
  const entry: JournalEntry = { id: uid(), kind, at: Date.now(), title, detail }
  try {
    await journalAppend(entry)
  } catch (e) {
    console.warn('[journal] запись не сохранена', kind, e)
  }
  for (const fn of listeners) fn()
  return entry.id
}

/** Вся лента, свежие сверху. */
export async function readJournal(): Promise<JournalEntry[]> {
  try {
    const all = await journalAll<JournalEntry>()
    return all.sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0))
  } catch {
    return []
  }
}

/** Файл для выгрузки: JSON с версией схемы, чтобы его можно было читать позже. */
export function journalToFile(entries: JournalEntry[]): { name: string; text: string } {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return {
    name: `workflow-journal-${stamp}.json`,
    text: JSON.stringify(
      {
        kind: 'workflow-journal',
        version: 1,
        exportedAt: Date.now(),
        count: entries.length,
        entries: entries.map((e) => ({ ...e, kindLabel: journalKindLabel(e.kind) })),
      },
      null,
      2,
    ),
  }
}
