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
  /** UX-5: стикер из демо-корпуса — помечен плашкой и снимается одним действием. */
  demo?: boolean
}

export const TTL_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1 час', value: HOUR },
  { label: '24 часа', value: DAY },
  { label: '7 дней', value: 7 * DAY },
  { label: 'навсегда', value: null },
]

/* UX-5: демо-стикеры первого запуска живут в lib/demo-seed.ts —
   отдельным модулем вне основного бандла. */


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
