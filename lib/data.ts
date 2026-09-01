import type { ComponentType, SVGProps } from 'react'
import { iconOf, type IconId } from '@/components/icons'

/* ============================================================
   КОРПУС СЕЙФА
   Один источник истины для всех четырёх экранов. Здесь нет ни
   одного числа «на глаз»: библиотека, карта, чат и настройки
   считают свои счётчики из этого массива, поэтому они не могут
   разъехаться. Иконка хранится строковым id — состояние сейфа
   уезжает в localStorage, а компонент туда не положишь.
   ============================================================ */

/** Значения совпадают с фильтром кластеров карты памяти. */
export type ClusterId = 'docs' | 'fin' | 'img' | 'music' | 'proj' | 'misc'

export type Cluster = {
  id: ClusterId
  /** Человеческое имя: подпись в сайдбаре, библиотеке и на карте. */
  label: string
  /** Вторая строка в выпадающих списках. */
  note: string
  /** Палитра кластера «Графит» v3 — общая для канваса и легенд. */
  rgb: string
}

/**
 * Порядок важен: он же задаёт сетку кластеров на карте (3×2) и порядок
 * фильтров в сайдбаре. Индекс в этом массиве — единственный числовой
 * идентификатор кластера, который знает канвас.
 */
export const CLUSTERS: Cluster[] = [
  { id: 'docs', label: 'Документы', note: 'Договоры, акты, доверенности', rgb: '47,190,126' },
  { id: 'fin', label: 'Финансы', note: 'Бюджеты, выписки, сметы', rgb: '91,124,153' },
  { id: 'img', label: 'Изображения', note: 'Скриншоты, фото, схемы', rgb: '176,141,87' },
  { id: 'music', label: 'Музыка', note: 'Демо, голосовые заметки', rgb: '118,153,111' },
  { id: 'proj', label: 'Проекты', note: 'Питчи, роадмапы, ТЗ', rgb: '122,139,158' },
  { id: 'misc', label: 'Прочее', note: 'Архивы и разрозненные файлы', rgb: '143,120,133' },
]

const CLUSTER_BY_ID = new Map(CLUSTERS.map((c) => [c.id, c]))

export function clusterOf(id: ClusterId): Cluster {
  return CLUSTER_BY_ID.get(id) ?? CLUSTERS[CLUSTERS.length - 1]
}

/** Индекс кластера = его позиция на сетке карты. */
export function clusterIndex(id: ClusterId): number {
  const i = CLUSTERS.findIndex((c) => c.id === id)
  return i < 0 ? CLUSTERS.length - 1 : i
}

export function clusterByLabel(label: string): Cluster | undefined {
  return CLUSTERS.find((c) => c.label === label)
}

export type VaultFile = {
  id: string
  /** Строковый id иконки — разрешается через ICONS при отрисовке. */
  icon: IconId
  /** Идентификатор кластера: он же категория библиотеки и фильтр карты. */
  cluster: ClusterId
  name: string
  desc: string
  /** Настоящий размер в байтах: из него считается объём сейфа и доли категорий. */
  bytes: number
  /** Дата в том виде, в котором её показывают карточки. */
  date: string
  /** Сколько всего страниц/листов — нужно для ссылок на источник и узлов карты. */
  pages?: number
  /** Метки библиотеки: по ним же связываются стикеры. */
  tags?: string[]
  /** Файл ещё разбирается локальным движком. */
  processing?: boolean
  /* ---- NF-1: поля настоящего индексатора ---- */
  /** Относительный путь внутри подключённой папки. */
  path?: string
  /** Файл пришёл из реального индексатора, а не из демо-корпуса. */
  indexed?: boolean
  /** Почему у файла нет текстового слоя (скан PDF, бинарник). */
  noText?: string
  /** Частотные слова содержимого: подпись карточки и поиск. */
  keywords?: string[]
  /** Длина извлечённого текста в символах — источник для «есть текст». */
  textLen?: number
}

/** Дата файла в подписи карточки: из времени изменения на диске. */
export function dateLabel(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const days = Math.floor((now - ts) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  const month = [
    'янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
  ][d.getMonth()]
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${month}${year}`
}

const KB = 1024
const MB = 1024 * KB

/**
 * Демо-корпус. Байты подобраны так, чтобы совпадать с подписями карточек:
 * размер файла считается из bytes, а не хранится строкой.
 */
export const VAULT_FILES: VaultFile[] = [
  {
    id: 'rent-2026',
    icon: 'doc',
    cluster: 'docs',
    name: 'договор_аренды_2026.pdf',
    desc: 'Договор аренды офиса на год, подписан 12 февраля',
    bytes: Math.round(4.2 * MB),
    date: '12 фев',
    pages: 18,
    tags: ['документы', 'аренда'],
  },
  {
    id: 'rent-2025',
    icon: 'doc',
    cluster: 'docs',
    name: 'договор_аренды_2025.pdf',
    desc: 'Прошлогодний договор на то же помещение',
    bytes: Math.round(3.9 * MB),
    date: '14 фев 2025',
    pages: 16,
    tags: ['документы', 'аренда'],
  },
  {
    id: 'protocol',
    icon: 'docDraft',
    cluster: 'docs',
    name: 'протокол_разногласий.pdf',
    desc: 'Правки к договору аренды, согласованы обеими сторонами',
    bytes: 640 * KB,
    date: '13 фев',
    pages: 6,
    tags: ['документы', 'аренда'],
  },
  {
    id: 'act',
    icon: 'doc',
    cluster: 'docs',
    name: 'акт_приёмки.pdf',
    desc: 'Приёмка помещения, подписан 14 февраля',
    bytes: 820 * KB,
    date: '14 фев',
    pages: 3,
    tags: ['документы'],
  },
  {
    id: 'estimate',
    icon: 'spreadsheetFin',
    cluster: 'fin',
    name: 'смета_офис.xlsx',
    desc: 'Смета ремонта и мебели, итог 1,24 млн ₽',
    bytes: Math.round(1.2 * MB),
    date: '16 фев',
    pages: 4,
    tags: ['финансы', 'аренда'],
  },
  {
    id: 'budget',
    icon: 'sheet',
    cluster: 'fin',
    name: 'бюджет_2026.xlsx',
    desc: 'Личный бюджет на 2026 год, листы по месяцам',
    bytes: 860 * KB,
    date: '3 фев',
    pages: 12,
    tags: ['финансы', 'план'],
  },
  {
    id: 'q1',
    icon: 'sheetSmall',
    cluster: 'fin',
    name: 'отчёт_квартал1.xlsx',
    desc: 'Расходы по офису за первый квартал',
    bytes: 540 * KB,
    date: '2 апр',
    pages: 5,
    tags: ['финансы'],
  },
  {
    id: 'office-photo',
    icon: 'image',
    cluster: 'img',
    name: 'фото_офиса.jpg',
    desc: 'Съёмка помещения до ремонта, 12 февраля',
    bytes: Math.round(3.4 * MB),
    date: '12 фев',
    tags: ['аренда'],
  },
  {
    id: 'build-error',
    icon: 'image',
    cluster: 'img',
    name: 'скрин_ошибки_сборки.png',
    desc: 'Скриншот ошибки сборки проекта «Сайт», строка 142',
    bytes: Math.round(1.1 * MB),
    date: 'вчера',
    tags: ['скриншот', 'баг'],
  },
  {
    id: 'meeting-notes',
    icon: 'docDraft',
    cluster: 'proj',
    name: 'заметки_встречи.txt',
    desc: 'Обсуждение условий с арендодателем',
    bytes: 18 * KB,
    date: '11 фев',
    tags: ['аренда'],
  },
  {
    id: 'pitch',
    icon: 'presentation',
    cluster: 'proj',
    name: 'презентация_стартап.pptx',
    desc: 'Питч-дек стартапа: 14 слайдов, для инвесторов',
    bytes: Math.round(14.7 * MB),
    date: '18 фев',
    pages: 14,
    tags: ['проект', 'питч'],
  },
  {
    id: 'ideas',
    icon: 'docCheck',
    cluster: 'misc',
    name: 'заметки_идеи.md',
    desc: 'Черновик идей: демо-запись без прочитанного содержимого',
    bytes: 12 * KB,
    date: 'только что',
    tags: ['новое', 'продукт'],
  },
  {
    id: 'demo-track',
    icon: 'music',
    cluster: 'music',
    name: 'демо_трек.mp3',
    desc: 'Черновик музыкальной идеи: гитара + бит, 3 минуты',
    bytes: Math.round(6.8 * MB),
    date: '20 фев',
    tags: ['музыка', 'черновик'],
  },
]

/* ------------------------------------------------------------
   МОДЕЛИ
   Выбор в настройках меняет подписи в шапке чата и статус-баре,
   поэтому характеристики модели живут рядом с её id.
   ------------------------------------------------------------ */

export type ModelId = 'qwen-7b' | 'llama-8b' | 'mistral-7b'

export type Model = {
  id: ModelId
  /** Полное имя для выпадающего списка настроек. */
  label: string
  /** Короткое имя для шапки чата и статус-бара. */
  short: string
  /**
   * Требования и скорость появятся из настоящего локального движка (NF-2).
   * До него источника у этих чисел нет, поэтому здесь null, а в UI — «—».
   */
  ram: string | null
  tokensPerSec: number | null
}

export const MODELS: Model[] = [
  { id: 'qwen-7b', label: 'Qwen 2.5 · 7B · Q4', short: 'Qwen 2.5 7B', ram: null, tokensPerSec: null },
  { id: 'llama-8b', label: 'Llama 3.1 · 8B · Q4', short: 'Llama 3.1 8B', ram: null, tokensPerSec: null },
  { id: 'mistral-7b', label: 'Mistral · 7B · Q5', short: 'Mistral 7B', ram: null, tokensPerSec: null },
]

/** Прочерк вместо выдуманного значения: у метрики нет источника. */
export const NO_DATA = '—'

/**
 * Локального движка в сборке ещё нет (задача NF-2). Пока флаг выключен,
 * продукт не имеет права писать «модель загружена» и показывать скорость.
 */
export const LOCAL_ENGINE_READY = false

/**
 * Единственная подпись облачной модели на весь продукт. Берётся из окружения
 * рядом с самим идентификатором модели, чтобы подпись не расходилась с тем,
 * кто на самом деле отвечает (UX-1).
 */
export const CLOUD_MODEL_LABEL = process.env.NEXT_PUBLIC_AI_MODEL_LABEL || 'Claude Sonnet 4.5'

/** Пришло ли из клиента настоящее имя модели профиля (проверка на границе). */
export function isModelId(v: unknown): v is ModelId {
  return typeof v === 'string' && MODELS.some((m) => m.id === v)
}

export function modelOf(id: ModelId): Model {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]
}

/** Движки ИИ: где именно считается индексация и генерация. */
export const ENGINES = [
  {
    id: 'local',
    name: 'Локальный движок',
    short: 'Локальный',
    badge: 'рекомендуем',
    sub: 'Всё считается на этом устройстве. Файлы и запросы не покидают диск.',
    offline: true,
  },
  {
    id: 'hybrid',
    name: 'Гибридный режим',
    short: 'Гибридный',
    badge: null,
    sub: 'Индексация локально, тяжёлые ответы — во внешней модели по вашему ключу.',
    offline: false,
  },
  {
    id: 'cloud',
    name: 'Внешняя модель',
    short: 'Внешняя',
    badge: null,
    sub: 'Максимальное качество ответов, но содержимое файлов уходит провайдеру.',
    offline: false,
  },
] as const

export type EngineId = (typeof ENGINES)[number]['id']

export function engineOf(id: EngineId) {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0]
}

/** Объём демо-профиля: с ним доли категорий в настройках читаются осмысленно. */
export const VAULT_QUOTA = 128 * MB

/* ------------------------------------------------------------
   ФОРМАТ
   ------------------------------------------------------------ */

export function fmtBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace('.', ',')} МБ`
  if (bytes >= KB) return `${Math.round(bytes / KB)} КБ`
  return `${bytes} Б`
}

/** Подпись карточки: размер и дата собираются из полей, а не хранятся строкой. */
export function fileMeta(f: VaultFile): string {
  return `${fmtBytes(f.bytes)} · ${f.date}`
}

/** Категория файла для библиотеки — это имя его кластера. */
export function fileCat(f: VaultFile): string {
  return clusterOf(f.cluster).label
}

export function fileTags(f: VaultFile): string[] {
  return f.tags ?? [clusterOf(f.cluster).label.toLowerCase()]
}

/** Тип файла по расширению: подпись в инспекторе узла карты. */
export function kindOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['pdf', 'docx', 'doc', 'txt', 'md', 'rtf'].includes(ext)) return 'ДОКУМЕНТ'
  if (['xlsx', 'xls', 'csv', 'numbers'].includes(ext)) return 'ТАБЛИЦА'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'ИЗОБРАЖЕНИЕ'
  if (['mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(ext)) return 'АУДИО'
  if (['pptx', 'ppt', 'key'].includes(ext)) return 'ПРЕЗЕНТАЦИЯ'
  return 'ФАЙЛ'
}

/** Кластер и иконка по расширению: загруженный файл сразу ложится в нужный слой. */
export function classify(name: string): { cluster: ClusterId; icon: IconId } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['pdf', 'doc', 'docx', 'rtf'].includes(ext)) return { cluster: 'docs', icon: 'doc' }
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return { cluster: 'fin', icon: 'sheet' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext))
    return { cluster: 'img', icon: 'image' }
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) return { cluster: 'music', icon: 'music' }
  if (['ppt', 'pptx', 'key'].includes(ext)) return { cluster: 'proj', icon: 'presentation' }
  if (['txt', 'md'].includes(ext)) return { cluster: 'proj', icon: 'docDraft' }
  return { cluster: 'misc', icon: 'docCheck' }
}

/* ------------------------------------------------------------
   ДОСТУП ПО ID
   Чат ссылается на файл по id, карта — тоже. Один индекс на весь
   прототип: если файла нет, вызывающий обязан это обработать.
   ------------------------------------------------------------ */

const SEED_BY_ID = new Map(VAULT_FILES.map((f) => [f.id, f]))

/** Файл демо-корпуса по id. Живой сейф ищет в своём списке (см. vault-store). */
export function fileById(id: string): VaultFile | undefined {
  return SEED_BY_ID.get(id)
}

/* ------------------------------------------------------------
   ВИД ФАЙЛА
   В состоянии лежит только строковый id иконки — компонент туда
   не положишь, он не переживёт localStorage. Всё, что нужно для
   отрисовки (иконка, категория, подпись, метки), собирается здесь
   одной функцией. Библиотека, чат и карта берут именно её, поэтому
   один и тот же файл выглядит одинаково на всех экранах.
   ------------------------------------------------------------ */

export type FileView = VaultFile & {
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Имя кластера — категория в библиотеке. */
  cat: string
  /** «4,2 МБ · 12 фев» — собрано из bytes и date. */
  meta: string
  /** Метки с гарантированным значением по умолчанию. */
  tagList: string[]
}

export function viewOf(f: VaultFile): FileView {
  return { ...f, Icon: iconOf(f.icon), cat: fileCat(f), meta: fileMeta(f), tagList: fileTags(f) }
}

/** Демо-корпус, готовый к отрисовке. Живой сейф отдаёт свой (см. vault-store). */
export const VAULT_VIEWS: FileView[] = VAULT_FILES.map(viewOf)

const SEED_VIEW_BY_ID = new Map(VAULT_VIEWS.map((v) => [v.id, v]))

/** Готовый к отрисовке файл демо-корпуса по id. */
export function viewById(id: string): FileView | undefined {
  return SEED_VIEW_BY_ID.get(id)
}

export function totalBytes(files: VaultFile[]): number {
  return files.reduce((n, f) => n + f.bytes, 0)
}

/**
 * Доли кластеров по объёму: полоса состава сейфа в настройках.
 * Проценты нормализованы так, чтобы в сумме дать ровно 100 — иначе полоса
 * из шести округлённых кусков вылезает за свою ширину.
 */
export function clusterMix(files: VaultFile[]) {
  const total = Math.max(1, totalBytes(files))
  const rows = CLUSTERS.map((c) => {
    const own = files.filter((f) => f.cluster === c.id)
    const bytes = totalBytes(own)
    return {
      id: c.id,
      label: c.label,
      rgb: c.rgb,
      count: own.length,
      bytes,
      pct: Math.round((bytes / total) * 100),
    }
  }).filter((m) => m.count > 0)

  if (rows.length === 0) return rows
  const drift = 100 - rows.reduce((n, r) => n + r.pct, 0)
  if (drift !== 0) {
    // Расхождение округления отдаём самому большому кластеру: там оно незаметно.
    const biggest = rows.reduce((a, b) => (b.bytes > a.bytes ? b : a))
    biggest.pct = Math.max(0, biggest.pct + drift)
  }
  return rows
}

/**
 * Стартовая справка о сейфе: используется там, где нужен снимок на момент
 * сборки (сохранённая демо-сессия чата). Живые числа отдаёт vault-store.
 */
export const VAULT_STATS = {
  files: VAULT_FILES.length,
  bytes: totalBytes(VAULT_FILES),
  quota: VAULT_QUOTA,
  model: MODELS[0].short,
  indexedAgo: '2 мин назад',
}
