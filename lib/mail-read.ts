/* ПОЧТА · чистые помощники чтения: разбивка на страницы и порядок папок. Общие для сервера и тестов. */

export const PAGE_LIMIT_MAX = 50
export const PAGE_LIMIT_DEFAULT = 30

/** Страница по номерам сообщений: от новых к старым. cursor — последний seq предыдущей страницы (исключительно). */
export function pageRange(total: number, cursor: number | null, limit: number): { start: number; end: number; nextCursor: number | null } {
  const lim = Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.floor(limit) || PAGE_LIMIT_DEFAULT))
  const end = Math.min(total, cursor === null ? total : cursor - 1)
  if (end < 1) return { start: 0, end: 0, nextCursor: null }
  const start = Math.max(1, end - lim + 1)
  return { start, end, nextCursor: start > 1 ? start : null }
}

const SPECIAL_ORDER: Record<string, number> = {
  '\\Inbox': 0,
  '\\Drafts': 1,
  '\\Sent': 2,
  '\\Archive': 3,
  '\\All': 4,
  '\\Junk': 5,
  '\\Trash': 6,
}

export type FolderLike = { path: string; specialUse: string | null }

export function folderRank(f: FolderLike): number {
  if (f.path.toUpperCase() === 'INBOX') return 0
  return f.specialUse && f.specialUse in SPECIAL_ORDER ? SPECIAL_ORDER[f.specialUse] : 50
}

export function sortFolders<T extends FolderLike>(list: T[]): T[] {
  return [...list].sort((a, b) => folderRank(a) - folderRank(b) || a.path.localeCompare(b.path, 'ru'))
}

export const SPECIAL_LABEL: Record<string, string> = {
  '\\Inbox': 'Входящие',
  '\\Drafts': 'Черновики',
  '\\Sent': 'Отправленные',
  '\\Archive': 'Архив',
  '\\All': 'Вся почта',
  '\\Junk': 'Спам',
  '\\Trash': 'Корзина',
  '\\Flagged': 'Помеченные',
}

export function folderLabel(f: { path: string; name: string; specialUse: string | null }): string {
  if (f.path.toUpperCase() === 'INBOX') return 'Входящие'
  return (f.specialUse && SPECIAL_LABEL[f.specialUse]) || f.name
}

export const FOLDER_RE = /^[^\r\n\u0000]{1,200}$/
