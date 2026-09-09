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
  /** Файл живёт на сервере (папка хранения/облако), а не в локальном сейфе. */
  shared?: boolean
  /**
   * Серверный файл лежит на ОБЩЕМ диске (виден участникам). false — личный
   * файл в локальной папке на этом ПК: в общую папку он попадёт только по
   * прямому действию человека.
   */
  cloudShared?: boolean
  /** Исходное имя файла на диске, если в библиотеке показано название от ИИ. */
  fileName?: string
  /** Состояние разбора файла ИИ-архивариусом. */
  analysisStatus?: 'queued' | 'done' | 'partial' | 'failed'
  /** id файла в общем облаке — для скачивания и удаления. */
  cloudId?: string
  /** Абсолютный путь в папке хранения (только для админа общего диска). */
  absPath?: string
  /** Почему у файла нет текстового слоя (скан PDF, бинарник). */
  noText?: string
  /** Частотные слова содержимого: подпись карточки и поиск. */
  keywords?: string[]
  /** Длина извлечённого текста в символах — источник для «есть текст». */
  textLen?: number
  /**
   * UX-5: объект из демо-корпуса (lib/demo-seed.ts). Помечает карточку
   * плашкой «демо» и позволяет убрать показательные данные одним действием,
   * не задев ничего, что человек добавил или импортировал сам.
   */
  demo?: boolean
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

/* UX-5: демо-корпус переехал в lib/demo-seed.ts — он грузится динамически
   и только при первом запуске пустого сейфа, поэтому в основном бандле
   показательных файлов больше нет. */


/* ------------------------------------------------------------
   МОДЕЛИ
   Выбор в настройках меняет подписи в шапке чата и статус-баре,
   поэтому характеристики модели живут рядом с её id.
   ------------------------------------------------------------ */

export type ModelId = 'qwen-3b' | 'qwen-7b' | 'llama-8b' | 'mistral-7b'

/** Desktop build opts into the small model; existing web profiles are unchanged. */
export const DEFAULT_MODEL: ModelId = process.env.NEXT_PUBLIC_DEFAULT_MODEL === 'qwen-3b' ? 'qwen-3b' : 'qwen-7b'
export const DESKTOP_BUILD = process.env.NEXT_PUBLIC_DESKTOP === '1'

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
  { id: 'qwen-3b', label: 'Qwen 2.5 · 3B · Q4 · компактная', short: 'Qwen 2.5 3B', ram: null, tokensPerSec: null },
  { id: 'qwen-7b', label: 'Qwen 2.5 · 7B · Q4', short: 'Qwen 2.5 7B', ram: null, tokensPerSec: null },
  { id: 'llama-8b', label: 'Llama 3.1 · 8B · Q4', short: 'Llama 3.1 8B', ram: null, tokensPerSec: null },
  { id: 'mistral-7b', label: 'Mistral · 7B · Q5', short: 'Mistral 7B', ram: null, tokensPerSec: null },
]

/** Прочерк вместо выдуманного значения: у метрики нет источника. */
export const NO_DATA = '—'

/**
 * Единственная подпись подключённой модели на весь продукт, пока сервер не
 * сообщил настоящее имя. Берётся из окружения, чтобы подпись не расходилась
 * с тем, кто на самом деле отвечает (UX-1).
 */
export const CLOUD_MODEL_LABEL = process.env.NEXT_PUBLIC_AI_MODEL_LABEL || 'Модель не выбрана'

/** Пришло ли из клиента настоящее имя модели профиля (проверка на границе). */
export function isModelId(v: unknown): v is ModelId {
  return typeof v === 'string' && MODELS.some((m) => m.id === v)
}

export function modelOf(id: ModelId): Model {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]
}

/**
 * Режим работы с подключённой моделью. Локального движка в продукте нет:
 * модель всегда внешняя (свой сервер или OpenRouter), выбор — только в том,
 * сколько контекста уходит в запрос.
 */
export const ENGINES = [
  {
    id: 'hybrid',
    name: 'Гибридный режим',
    short: 'Гибридный',
    badge: 'рекомендуем',
    sub: 'Индексация и хранение локально, ответы — у подключённой модели по вашему ключу.',
    offline: false,
  },
  {
    id: 'cloud',
    name: 'Полный контекст',
    short: 'Полный контекст',
    badge: null,
    sub: 'Модель получает подобранные фрагменты файлов целиком — максимальное качество ответов.',
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
  const GB = MB * 1024
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace('.', ',')} ГБ`
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
