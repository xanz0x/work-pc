/* ============================================================
   ВТОРОЙ СЛОЙ ПАМЯТИ
   Файл — это то, что вам прислали. Стикер — то, что вы подумали.
   Оба слоя лежат в одном сейфе, индексируются одним движком и
   связываются на карте памяти. Раньше стикеры жили внутри одного
   экрана; теперь они часть общего состояния, поэтому их видят и
   карта, и поиск, и чат.
   ============================================================ */

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export type Note = {
  id: string
  title: string
  body: string
  tags: string[]
  /** null — постоянный стикер; число — момент самоуничтожения (ms). */
  expiresAt: number | null
  /** Полная длительность жизни, нужна для полосы распада. */
  lifeSpan: number | null
  /** Пароль включён — тело размывается до ввода ключа. */
  locked: boolean
  /** Локальный ключ. null у демо-стикеров: подойдёт любой непустой ключ. */
  secret: string | null
  /** id файла, к которому приколот стикер. Ссылаемся на id, а не на имя. */
  pinnedTo?: string
  /** Момент создания: подпись собирается из него, а не хранится строкой. */
  createdAt: number
}

export const TTL_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1 час', value: HOUR },
  { label: '24 часа', value: DAY },
  { label: '7 дней', value: 7 * DAY },
  { label: 'навсегда', value: null },
]

/** Демо-стикеры первого запуска: приколоты к настоящим id файлов сейфа. */
export function seedNotes(t0: number): Note[] {
  return [
    {
      id: 'n-key',
      title: 'Ключ от сейфа арендодателя',
      body: 'Код домофона 41К, ключ у охраны на первом этаже. Стереть сразу после переезда.',
      tags: ['аренда', 'секрет'],
      expiresAt: t0 + 2 * MIN + 45_000,
      lifeSpan: 6 * HOUR,
      locked: true,
      secret: null,
      pinnedTo: 'rent-2026',
      createdAt: t0 - 5 * HOUR,
    },
    {
      id: 'n-pitch',
      title: 'Что переписать в питче',
      body: 'Слайд 7 — убрать три графика, оставить один. Слайд 11 — цифры за январь уже устарели, взять из бюджета.',
      tags: ['питч', 'правки'],
      expiresAt: null,
      lifeSpan: null,
      locked: false,
      secret: null,
      pinnedTo: 'pitch',
      createdAt: t0 - 6 * DAY,
    },
    {
      id: 'n-idea',
      title: 'Идея на утро',
      body: 'Сделать так, чтобы ИИ сам предлагал приколоть стикер к файлу, если текст пересекается по смыслу.',
      tags: ['продукт', 'идея'],
      expiresAt: t0 + 18 * HOUR,
      lifeSpan: DAY,
      locked: false,
      secret: null,
      createdAt: t0 - 7 * HOUR,
    },
    {
      id: 'n-money',
      title: 'Разговор с бухгалтером',
      body: 'Просил пересчитать налог по новой ставке, обещал прислать таблицу до пятницы. Проверить бюджет после.',
      tags: ['финансы'],
      expiresAt: t0 + 5 * DAY,
      lifeSpan: 7 * DAY,
      locked: true,
      secret: null,
      pinnedTo: 'budget',
      createdAt: t0 - 4 * DAY,
    },
  ]
}

export function isAlive(n: Note, now: number): boolean {
  return n.expiresAt === null || n.expiresAt > now
}

export function fmtLeft(ms: number): string {
  if (ms <= 0) return '0 сек'
  const d = Math.floor(ms / DAY)
  const h = Math.floor((ms % DAY) / HOUR)
  const m = Math.floor((ms % HOUR) / MIN)
  const s = Math.floor((ms % MIN) / 1000)
  if (d > 0) return `${d} д ${h} ч`
  if (h > 0) return `${h} ч ${m} мин`
  if (m > 0) return `${m} мин ${String(s).padStart(2, '0')} сек`
  return `${s} сек`
}

/** Человеческая подпись «когда создан» — считается от текущего времени. */
export function fmtWhen(at: number, now: number): string {
  const diff = now - at
  if (diff < MIN) return 'только что'
  if (diff < HOUR) return `${Math.floor(diff / MIN)} мин назад`
  if (diff < DAY) {
    return `сегодня, ${new Date(at).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }
  const days = Math.floor(diff / DAY)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
