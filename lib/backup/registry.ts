/* ============================================================
   NF-7 · РЕЕСТР МОДУЛЕЙ БЭКАПА
   Снимок делается на уровне ДОКУМЕНТОВ хранилища, а не на уровне
   продуктовых сущностей: что лежит в сейфе, то и уезжает в снимок.
   Поэтому round-trip даёт идентичное состояние, а не «похожее».

   Чего в снимке нет намеренно:
   — `wf.lock.*`: мастер-ключ и его состояние остаются на устройстве.
     Снимок открывается СВОИМ паролем, и на чистом устройстве он ложится
     под новый мастер-ключ (см. lib/backup/keys.ts).
   ============================================================ */

import { isLocalOnly } from '@/lib/db/schema'

/** Сборка продукта: та же строка, что в подвале рельса настроек. */
export const APP_BUILD = '3.0.7'

export const NOTES_DOC = 'wf.notes.v1'
export const FILE_KEYS_DOC = 'wf.filekeys.map.v1'

export type ModuleId = 'secrets' | 'library' | 'chats' | 'index' | 'settings' | 'notifs' | 'journal'

export type BackupModule = {
  id: ModuleId
  label: string
  note: string
  /** Точные ключи: маршрутизация по isLocalOnly (localStorage или IndexedDB). */
  keys: string[]
  /** Префиксы документов IndexedDB: индекс содержимого — тысячи ключей. */
  prefixes: string[]
  /** Append-only лента журнала безопасности живёт в своём сторе. */
  journal: boolean
}

export const MODULES: BackupModule[] = [
  {
    id: 'secrets',
    label: 'Менеджер секретов',
    note: 'Записи, папки, настройки модуля и ключ сейфа секретов',
    keys: [
      'wf.secrets.v1',
      'wf.secrets.folders.v1',
      'wf.secrets.settings.v1',
      'wf.secrets.backups.v1',
      'wf.secrets.expiry.v1',
      'wf.secrets.sek.v1',
    ],
    prefixes: [],
    journal: false,
  },
  {
    id: 'library',
    label: 'Библиотека и стикеры',
    note: 'Файлы сейфа, заметки-стикеры и обёртки файловых ключей',
    keys: ['wf.files.v1', NOTES_DOC, FILE_KEYS_DOC, 'wf.filekeys.lockedlist'],
    prefixes: [],
    journal: false,
  },
  {
    id: 'chats',
    label: 'Разговоры с ИИ',
    note: 'История сессий, черновики композера и позиции прокрутки',
    keys: ['wf.chat.v1', 'wf.chat.active', 'wf.chat.drafts', 'wf.chat.scroll', 'wf.chat.rail'],
    prefixes: [],
    journal: false,
  },
  {
    id: 'index',
    label: 'Индекс содержимого',
    note: 'Прочитанный локально текст файлов и поисковый индекс',
    keys: ['wf.idx.manifest.v1', 'wf.idx.search.v1'],
    prefixes: ['wf.idx.doc.'],
    journal: false,
  },
  {
    id: 'settings',
    label: 'Настройки и профиль',
    note: 'Конфигурация движка, конвейера, приватности и недавние команды',
    keys: ['wf.settings.v1', 'wf.commands.recent.v1', 'wf.flags.v1', 'wf-nav'],
    prefixes: [],
    journal: false,
  },
  {
    id: 'notifs',
    label: 'Лента событий',
    note: 'Уведомления сейфа и отметка о первичном наполнении',
    keys: ['wf.notifs.v1', 'wf.notifs.seeded.v1'],
    prefixes: [],
    journal: false,
  },
  {
    id: 'journal',
    label: 'Журнал безопасности',
    note: 'Append-only лента критических действий: при восстановлении только дополняется',
    keys: [],
    prefixes: [],
    journal: true,
  },
]

export const ALL_MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id)

export function moduleOf(id: ModuleId): BackupModule | undefined {
  return MODULES.find((m) => m.id === id)
}

export function moduleLabel(id: ModuleId): string {
  return moduleOf(id)?.label ?? id
}

export function docKeysOf(mod: BackupModule): string[] {
  return mod.keys.filter((k) => !isLocalOnly(k))
}

export function localKeysOf(mod: BackupModule): string[] {
  return mod.keys.filter((k) => isLocalOnly(k))
}

/** Сколько сущностей в документе: список — длина, сейф секретов — записи. */
export function itemsIn(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'object' && value !== null) {
    const box = value as Record<string, unknown>
    if (Array.isArray(box.entries)) return box.entries.length
    return Object.keys(box).length
  }
  return value === undefined ? 0 : 1
}
