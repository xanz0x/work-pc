'use client'

/* ============================================================
   NF-6 · КОМАНДНЫЙ ЦЕНТР
   Реестр команд палитры Ctrl+K. Здесь только описания: что команда
   делает, как называется, когда доступна и какая у неё подсказка.
   Ничего своего команда не знает — всё, что ей нужно, приходит
   в контексте (`CommandCtx`), который собирает палитра из сейфа.
   Поэтому один и тот же реестр работает с любого экрана, а тесты
   могут прогнать его без React.

   Часть команд живёт внутри экрана (композер стикера, генератор
   пароля). Для них есть «намерение»: палитра переключает экран и
   оставляет заявку, экран её подхватывает при монтировании —
   поэтому команда работает и с того экрана, где её нет.
   ============================================================ */

import { useEffect, useRef } from 'react'
import type { ScopeId } from './search'
import type { ScreenId } from './store/nav'
import type { ToggleId } from './store/settings'

/* ---------- намерения экранов ---------- */

export type IntentName =
  | 'library.newNote'
  | 'library.addFile'
  | 'library.select'
  | 'library.density'
  | 'library.resetBoard'
  | 'vault.new'
  | 'vault.generator'
  | 'vault.io'
  | 'vault.select'

/** Заявка живёт недолго: экран, открытый через минуту, её не исполнит. */
const INTENT_TTL = 4000
const pending = new Map<IntentName, number>()
const listeners = new Map<IntentName, Set<() => void>>()

/** Попросить экран сделать своё действие. Если экран уже открыт — сразу. */
export function requestIntent(name: IntentName): void {
  const set = listeners.get(name)
  if (set && set.size > 0) {
    set.forEach((fn) => fn())
    return
  }
  pending.set(name, Date.now())
}

/** Подписка экрана на своё намерение: заявка, оставленная до монтирования, исполняется. */
export function useIntent(name: IntentName, run: () => void): void {
  const ref = useRef(run)
  useEffect(() => {
    ref.current = run
  }, [run])
  useEffect(() => {
    const set = listeners.get(name) ?? new Set<() => void>()
    listeners.set(name, set)
    const fn = () => ref.current()
    set.add(fn)
    const at = pending.get(name)
    if (at !== undefined) {
      pending.delete(name)
      if (Date.now() - at < INTENT_TTL) fn()
    }
    return () => {
      set.delete(fn)
    }
  }, [name])
}

/* ---------- контекст ---------- */

export type CommandCtx = {
  screen: ScreenId
  lockStatus: 'off' | 'locked' | 'unlocked'
  /** Сейф секретов расшифрован в этой вкладке. */
  secretsReady: boolean
  folderConnected: boolean
  indexBusy: boolean
  unread: number
  clipActive: boolean
  telemetry: boolean

  go: (screen: ScreenId) => void
  openSetting: (id: string) => void
  flash: (msg: string) => void
  setQuery: (q: string) => void
  setScope: (s: ScopeId) => void
  setToggle: (id: ToggleId, value: boolean) => void
  lockNow: () => void
  markAllRead: () => void
  hideSecrets: () => void
  clearClipboard: () => void
  backupSecrets: () => void
  connectFolder: () => void
  reindex: () => void
}

export type CommandGroup = 'action' | 'nav' | 'setting'

export type CommandIcon =
  | 'doc'
  | 'sticker'
  | 'chat'
  | 'layers'
  | 'gear'
  | 'shield'
  | 'key'
  | 'search'
  | 'refresh'
  | 'trash'
  | 'plus'
  | 'lock'
  | 'bell'
  | 'graph'
  | 'database'
  | 'eye'
  | 'clip'
  | 'folder'
  | 'spark'
  | 'grid'
  | 'pipeline'

export type Command = {
  id: string
  group: CommandGroup
  title: string
  /** Подсказка: что произойдёт. Показывается второй строкой. */
  hint: string
  icon: CommandIcon
  /** Сочетание клавиш, если оно есть у действия вне палитры. */
  keys?: string
  /** Слова для поиска сверх заголовка. */
  words?: string[]
  /** Доступность по контексту. Недоступная команда видна, но не запускается. */
  when?: (c: CommandCtx) => boolean
  /** Почему недоступна — человеку, а не в консоль. */
  blocked?: string
  run: (c: CommandCtx) => void
}

export const GROUP_LABEL: Record<CommandGroup, string> = {
  action: 'Действия',
  nav: 'Переходы',
  setting: 'Настройки',
}

/** Открыть экран и оставить ему заявку на действие. */
function onScreen(screen: ScreenId, intent: IntentName) {
  return (c: CommandCtx) => {
    c.go(screen)
    requestIntent(intent)
  }
}

export const COMMANDS: Command[] = [
  /* ---------- действия ---------- */
  {
    id: 'library.new-note',
    group: 'action',
    title: 'Новый стикер',
    hint: 'Библиотека · открыть композер и писать сразу в сейф',
    icon: 'sticker',
    words: ['заметка', 'note', 'стикер', 'создать'],
    run: onScreen('library', 'library.newNote'),
  },
  {
    id: 'library.add-file',
    group: 'action',
    title: 'Добавить файл',
    hint: 'Библиотека · выбрать файлы и прочитать их индексатором',
    icon: 'plus',
    words: ['файл', 'upload', 'загрузить', 'импорт'],
    run: onScreen('library', 'library.addFile'),
  },
  {
    id: 'library.select',
    group: 'action',
    title: 'Массовое выделение',
    hint: 'Библиотека · включить режим выбора и панель массовых действий',
    icon: 'grid',
    words: ['bulk', 'выделить', 'выбрать', 'массово', 'группа'],
    run: onScreen('library', 'library.select'),
  },
  {
    id: 'library.density',
    group: 'action',
    title: 'Плотность доски',
    hint: 'Библиотека · переключить «свободно / плотно»',
    icon: 'grid',
    words: ['доска', 'сетка', 'компактно'],
    run: onScreen('library', 'library.density'),
  },
  {
    id: 'library.reset-board',
    group: 'action',
    title: 'Сбросить раскладку доски',
    hint: 'Библиотека · вернуть сортировку по умолчанию',
    icon: 'refresh',
    words: ['раскладка', 'порядок', 'плитки'],
    run: onScreen('library', 'library.resetBoard'),
  },
  {
    id: 'index.connect-folder',
    group: 'action',
    title: 'Подключить папку',
    hint: 'Выбрать папку на диске и построить индекс по содержимому',
    icon: 'folder',
    words: ['индекс', 'папка', 'источник', 'диск'],
    when: (c) => !c.indexBusy,
    blocked: 'индексация уже идёт',
    run: (c) => {
      c.go('library')
      c.connectFolder()
    },
  },
  {
    id: 'index.reindex',
    group: 'action',
    title: 'Переиндексировать',
    hint: 'Перечитать подключённую папку: изменённые файлы читаются заново',
    icon: 'refresh',
    words: ['индекс', 'обновить', 'reindex'],
    when: (c) => c.folderConnected && !c.indexBusy,
    blocked: 'папка не подключена',
    run: (c) => c.reindex(),
  },
  {
    id: 'vault.new',
    group: 'action',
    title: 'Новая запись секрета',
    hint: 'Менеджер секретов · создать логин, карту, ключ или заметку',
    icon: 'key',
    words: ['пароль', 'секрет', 'создать', 'логин'],
    when: (c) => c.secretsReady,
    blocked: 'сейф секретов закрыт',
    run: onScreen('vault', 'vault.new'),
  },
  {
    id: 'vault.generator',
    group: 'action',
    title: 'Генератор пароля',
    hint: 'Менеджер секретов · длина, наборы символов, парольные фразы',
    icon: 'spark',
    words: ['пароль', 'сгенерировать', 'password', 'фраза'],
    when: (c) => c.secretsReady,
    blocked: 'сейф секретов закрыт',
    run: onScreen('vault', 'vault.generator'),
  },
  {
    id: 'vault.io',
    group: 'action',
    title: 'Импорт и экспорт секретов',
    hint: 'Менеджер секретов · перенос из другого менеджера и выгрузка',
    icon: 'database',
    words: ['импорт', 'экспорт', 'csv', 'json', 'перенос'],
    when: (c) => c.secretsReady,
    blocked: 'сейф секретов закрыт',
    run: onScreen('vault', 'vault.io'),
  },
  {
    id: 'vault.select',
    group: 'action',
    title: 'Массовое выделение записей',
    hint: 'Менеджер секретов · выбрать несколько записей и действовать разом',
    icon: 'grid',
    words: ['bulk', 'выделить', 'папка', 'метка', 'массово'],
    when: (c) => c.secretsReady,
    blocked: 'сейф секретов закрыт',
    run: onScreen('vault', 'vault.select'),
  },
  {
    id: 'vault.backup',
    group: 'action',
    title: 'Бэкап сейфа секретов',
    hint: 'Снимок записей, зашифрованный мастер-ключом этого устройства',
    icon: 'shield',
    words: ['бэкап', 'backup', 'снимок', 'резерв'],
    when: (c) => c.secretsReady,
    blocked: 'сейф секретов закрыт',
    run: (c) => c.backupSecrets(),
  },
  {
    id: 'vault.hide-all',
    group: 'action',
    title: 'Скрыть все значения',
    hint: 'Погасить раскрытые пароли и коды во всех карточках',
    icon: 'eye',
    words: ['скрыть', 'спрятать', 'reveal', 'маска'],
    run: (c) => {
      c.hideSecrets()
      c.flash('Раскрытые значения скрыты')
    },
  },
  {
    id: 'vault.clear-clip',
    group: 'action',
    title: 'Очистить буфер обмена',
    hint: 'Стереть скопированный секрет из буфера прямо сейчас',
    icon: 'clip',
    words: ['буфер', 'clipboard', 'копия', 'очистить'],
    run: (c) => {
      c.clearClipboard()
      c.flash('Буфер обмена очищен')
    },
  },
  {
    id: 'lock.now',
    group: 'action',
    title: 'Заблокировать сейф',
    hint: 'Закрыть замок: ключи из памяти вкладки уходят немедленно',
    icon: 'lock',
    keys: 'Ctrl+Shift+L',
    words: ['замок', 'lock', 'закрыть', 'паника'],
    when: (c) => c.lockStatus !== 'off',
    blocked: 'замок выключен в настройках',
    run: (c) => c.lockNow(),
  },
  {
    id: 'notifs.read-all',
    group: 'action',
    title: 'Отметить события прочитанными',
    hint: 'Снять непрочитанное со всей ленты уведомлений',
    icon: 'bell',
    words: ['уведомления', 'события', 'прочитано'],
    when: (c) => c.unread > 0,
    blocked: 'непрочитанных событий нет',
    run: (c) => {
      c.markAllRead()
      c.flash('Все события отмечены прочитанными')
    },
  },
  {
    id: 'search.semantic',
    group: 'action',
    title: 'Искать по смыслу',
    hint: 'Область поиска → смысловой режим: «где деньги» найдёт смету',
    icon: 'search',
    words: ['поиск', 'смысл', 'семантика', 'область'],
    run: (c) => {
      c.setScope('semantic')
      c.flash('Область поиска: смысловой режим')
    },
  },
  {
    id: 'search.notes',
    group: 'action',
    title: 'Искать только по заметкам',
    hint: 'Область поиска → «Мои заметки»: только то, что вы написали сами',
    icon: 'sticker',
    words: ['поиск', 'заметки', 'стикеры', 'область'],
    run: (c) => {
      c.setScope('notes')
      c.flash('Область поиска: мои заметки')
    },
  },
  {
    id: 'search.reset',
    group: 'action',
    title: 'Сбросить поиск',
    hint: 'Очистить строку запроса и вернуть область «Везде»',
    icon: 'refresh',
    words: ['сброс', 'очистить', 'поиск'],
    run: (c) => {
      c.setQuery('')
      c.setScope('all')
    },
  },
  {
    id: 'privacy.telemetry-off',
    group: 'action',
    title: 'Выключить телеметрию',
    hint: 'Ни одного исходящего запроса с этого устройства',
    icon: 'shield',
    words: ['телеметрия', 'приватность', 'офлайн', 'сеть'],
    when: (c) => c.telemetry,
    blocked: 'телеметрия уже выключена',
    run: (c) => {
      c.setToggle('telemetry', false)
      c.flash('Телеметрия выключена')
    },
  },

  /* ---------- переходы ---------- */
  {
    id: 'go.library',
    group: 'nav',
    title: 'Библиотека',
    hint: 'Два слоя памяти: файлы и стикеры',
    icon: 'doc',
    words: ['файлы', 'стикеры', 'library'],
    run: (c) => c.go('library'),
  },
  {
    id: 'go.map',
    group: 'nav',
    title: 'Карта памяти',
    hint: 'Граф связей сейфа: кластеры, узлы, соседи',
    icon: 'graph',
    words: ['граф', 'связи', 'карта', 'map'],
    run: (c) => c.go('map'),
  },
  {
    id: 'go.chat',
    group: 'nav',
    title: 'Чат с ИИ',
    hint: 'Разговор с локальной моделью по содержимому сейфа',
    icon: 'chat',
    words: ['чат', 'ии', 'модель', 'разговор'],
    run: (c) => c.go('chat'),
  },
  {
    id: 'go.vault',
    group: 'nav',
    title: 'Менеджер секретов',
    hint: 'Пароли, карты, ключи и TOTP под мастер-ключом',
    icon: 'key',
    words: ['секреты', 'пароли', 'vault'],
    run: (c) => c.go('vault'),
  },
  {
    id: 'go.activity',
    group: 'nav',
    title: 'Центр активности',
    hint: 'Лента событий и живое состояние процессов',
    icon: 'pipeline',
    words: ['события', 'журнал', 'лента', 'активность'],
    run: (c) => c.go('activity'),
  },
  {
    id: 'go.settings',
    group: 'nav',
    title: 'Настройки',
    hint: 'Движок, индексация, приватность, хранилище',
    icon: 'gear',
    words: ['настройки', 'settings', 'параметры'],
    run: (c) => c.go('settings'),
  },

  /* ---------- настройки ---------- */
  {
    id: 'set.engine',
    group: 'setting',
    title: 'Движок ИИ',
    hint: 'Где считается модель: на устройстве, в облаке или гибридно',
    icon: 'chat',
    words: ['движок', 'модель', 'ollama', 'облако'],
    run: (c) => c.openSetting('engine'),
  },
  {
    id: 'set.index',
    group: 'setting',
    title: 'Индексация',
    hint: 'Автометки, наблюдение за папкой, состав индекса',
    icon: 'pipeline',
    words: ['индекс', 'автометки', 'папка'],
    run: (c) => c.openSetting('index'),
  },
  {
    id: 'set.privacy',
    group: 'setting',
    title: 'Приватность',
    hint: 'Шифрование, маскирование, телеметрия и журнал',
    icon: 'shield',
    words: ['приватность', 'шифрование', 'телеметрия', 'журнал'],
    run: (c) => c.openSetting('privacy'),
  },
  {
    id: 'set.security',
    group: 'setting',
    title: 'Мастер-ключ и замок',
    hint: 'Настроить замок сейфа, автоблокировку и файловые ключи',
    icon: 'lock',
    words: ['замок', 'мастер', 'пароль', 'ключ', 'безопасность'],
    run: (c) => c.openSetting('security'),
  },
  {
    id: 'set.storage',
    group: 'setting',
    title: 'Хранилище',
    hint: 'Сколько занято, из чего состоит сейф, что можно стереть',
    icon: 'database',
    words: ['хранилище', 'место', 'объём', 'квота'],
    run: (c) => c.openSetting('storage'),
  },
  {
    id: 'set.notifs',
    group: 'setting',
    title: 'Уведомления',
    hint: 'Какие события показывать и что складывать в сводку',
    icon: 'bell',
    words: ['уведомления', 'события', 'сводка'],
    run: (c) => c.openSetting('notifs'),
  },
  {
    id: 'set.secrets',
    group: 'setting',
    title: 'Настройки менеджера секретов',
    hint: 'Буфер обмена, авто-скрытие, иконки сайтов, бэкапы',
    icon: 'key',
    words: ['секреты', 'буфер', 'иконки', 'totp'],
    run: (c) => c.openSetting('secrets'),
  },
]

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

export function commandById(id: string): Command | undefined {
  return BY_ID.get(id)
}

export function isAvailable(cmd: Command, ctx: CommandCtx): boolean {
  return cmd.when ? cmd.when(ctx) : true
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim()

/** Совпадение по заголовку, подсказке и словам — с обрубкой окончаний. */
export function matchCommand(cmd: Command, query: string): boolean {
  const q = norm(query)
  if (q === '') return true
  const hay = norm([cmd.title, cmd.hint, ...(cmd.words ?? [])].join(' '))
  return q
    .split(/[^\p{L}\p{N}+]+/u)
    .filter(Boolean)
    .every((w) => hay.includes(w.length > 5 ? w.slice(0, w.length - 2) : w))
}

/** Команды под запрос: доступные впереди, недоступные в конце своей группы. */
export function filterCommands(
  query: string,
  ctx: CommandCtx,
): { cmd: Command; available: boolean }[] {
  return COMMANDS.filter((c) => matchCommand(c, query))
    .map((cmd) => ({ cmd, available: isAvailable(cmd, ctx) }))
    .sort((a, b) => Number(b.available) - Number(a.available))
}

/* ---------- недавнее ---------- */

export const RECENT_KEY = 'wf.commands.recent.v1'
const RECENT_MAX = 5

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && BY_ID.has(x)).slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

export function pushRecent(id: string): string[] {
  const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* приватный режим — недавнее просто не переживёт перезагрузку */
  }
  return next
}
