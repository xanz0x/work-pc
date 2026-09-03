/* ============================================================
   NF-9 · ТЕЛЕМЕТРИЯ ПО СОГЛАСИЮ
   Правило одно: наружу не может уйти то, чего человек не видел.
   Отсюда устройство модуля.

   — Считаем ТОЛЬКО счётчики и ТОЛЬКО из закрытого словаря имён.
     Произвольная строка сюда не попадёт даже по ошибке разработчика:
     `track` молча отбрасывает всё, чего нет в словаре, поэтому имя файла,
     текст запроса или id записи физически не могут стать событием.
   — Никакого идентификатора устройства, сессии или пользователя.
     Отправка анонимна не на словах: в payload нечему быть уникальным.
   — Агрегат живёт в localStorage этого браузера. Пока согласия нет,
     он никуда не уходит — но человек может посмотреть его целиком
     и стереть одной кнопкой.

   Модуль намеренно без React: те же функции проверяются юнит-тестом,
   а компоненты подписываются на снимок через `useSyncExternalStore`.
   ============================================================ */

export const TELEMETRY_KEY = 'wf.telemetry.v1'

/** Экраны продукта. Всё остальное игнорируется. */
export const TELEMETRY_SCREENS = ['library', 'map', 'chat', 'activity', 'settings', 'vault'] as const

/** Ключевые действия: что человек реально делает в продукте. */
export const TELEMETRY_ACTIONS = [
  'files.intake',
  'files.reindex',
  'search.run',
  'chat.turn',
  'lock.unlock',
  'vault.entry.create',
  'backup.export',
  'demo.clear',
] as const

/** Обрывы сценариев: где путь ломается и человек уходит ни с чем. */
export const TELEMETRY_DROPS = [
  'chat.turn.aborted',
  'chat.turn.error',
  'files.intake.failed',
  'lock.unlock.failed',
  'search.empty',
] as const

export type TelemetryScreen = (typeof TELEMETRY_SCREENS)[number]
export type TelemetryAction = (typeof TELEMETRY_ACTIONS)[number]
export type TelemetryDrop = (typeof TELEMETRY_DROPS)[number]

export type TelemetryState = {
  v: 1
  /** С какого момента копится этот агрегат. */
  since: number
  screens: Record<string, number>
  actions: Record<string, number>
  drops: Record<string, number>
  /** Момент последней успешной отправки и сколько их было всего. */
  lastSentAt: number | null
  sent: number
}

export type TelemetryPayload = {
  v: 1
  app: 'workspacex'
  /** Период агрегата в ISO — без времени суток отдельных событий. */
  from: string
  to: string
  screens: Record<string, number>
  actions: Record<string, number>
  drops: Record<string, number>
  totals: { screens: number; actions: number; drops: number }
}

export function emptyTelemetry(now: number): TelemetryState {
  return { v: 1, since: now, screens: {}, actions: {}, drops: {}, lastSentAt: null, sent: 0 }
}

const KNOWN: Record<'screen' | 'action' | 'drop', readonly string[]> = {
  screen: TELEMETRY_SCREENS,
  action: TELEMETRY_ACTIONS,
  drop: TELEMETRY_DROPS,
}

const BUCKET = { screen: 'screens', action: 'actions', drop: 'drops' } as const

/**
 * Чистое сложение события в агрегат. Неизвестное имя не считается вовсе:
 * лучше потерять счётчик, чем однажды записать в телеметрию содержимое.
 */
export function track(
  state: TelemetryState,
  kind: 'screen' | 'action' | 'drop',
  name: string,
): TelemetryState {
  if (!KNOWN[kind].includes(name)) return state
  const key = BUCKET[kind]
  const bucket = { ...state[key], [name]: (state[key][name] ?? 0) + 1 }
  return { ...state, [key]: bucket }
}

function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0)
}

/** Ровно то, что уйдёт на сервер. Экран настроек показывает этот же объект. */
export function buildPayload(state: TelemetryState, now: number): TelemetryPayload {
  return {
    v: 1,
    app: 'workspacex',
    from: new Date(state.since).toISOString(),
    to: new Date(now).toISOString(),
    screens: { ...state.screens },
    actions: { ...state.actions },
    drops: { ...state.drops },
    totals: {
      screens: sum(state.screens),
      actions: sum(state.actions),
      drops: sum(state.drops),
    },
  }
}

/** Сколько событий накоплено — для подписи «отправлять пока нечего». */
export function totalEvents(state: TelemetryState): number {
  return sum(state.screens) + sum(state.actions) + sum(state.drops)
}

/* ---------- хранилище: localStorage + подписка ---------- */

let cache: TelemetryState | null = null
const listeners = new Set<() => void>()

function read(): TelemetryState {
  if (cache) return cache
  if (typeof window === 'undefined') return (cache = emptyTelemetry(0))
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && (parsed as TelemetryState).v === 1) {
      cache = parsed as TelemetryState
      return cache
    }
  } catch {
    /* повреждённый агрегат — начинаем заново, это всего лишь счётчики */
  }
  cache = emptyTelemetry(Date.now())
  return cache
}

function write(next: TelemetryState): void {
  cache = next
  try {
    localStorage.setItem(TELEMETRY_KEY, JSON.stringify(next))
  } catch {
    /* приватный режим — агрегат останется только в памяти вкладки */
  }
  for (const fn of listeners) fn()
}

export function telemetrySnapshot(): TelemetryState {
  return read()
}

export function subscribeTelemetry(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function bump(kind: 'screen' | 'action' | 'drop', name: string): void {
  if (typeof window === 'undefined') return
  const cur = read()
  const next = track(cur, kind, name)
  if (next !== cur) write(next)
}

export function trackScreen(name: string): void {
  bump('screen', name)
}

export function trackAction(name: TelemetryAction): void {
  bump('action', name)
}

export function trackDrop(name: TelemetryDrop): void {
  bump('drop', name)
}

/** Стереть накопленное: выключение согласия и кнопка «Очистить». */
export function clearTelemetry(): void {
  const prev = read()
  write({ ...emptyTelemetry(Date.now()), lastSentAt: prev.lastSentAt, sent: prev.sent })
}

/** Полный сброс, включая историю отправок (используется тестами). */
export function resetTelemetry(): void {
  write(emptyTelemetry(Date.now()))
}

/**
 * Отправка. Уходит ровно тот payload, который показан на экране, и только
 * когда вызывающий подтвердил согласие: аргумент `consent` существует
 * именно для того, чтобы отправку нельзя было вызвать «между делом».
 */
export async function sendTelemetry(consent: boolean): Promise<
  { ok: true; payload: TelemetryPayload } | { ok: false; error: string }
> {
  if (!consent) return { ok: false, error: 'Нет согласия на отправку.' }
  const state = read()
  if (totalEvents(state) === 0) return { ok: false, error: 'Отправлять пока нечего.' }
  const payload = buildPayload(state, Date.now())
  try {
    const res = await fetch('/ai-api/telemetry/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status === 401) {
      return { ok: false, error: 'Нужен вход в приложение: откройте /login и повторите.' }
    }
    if (res.status === 429) {
      return { ok: false, error: 'Слишком часто. Попробуйте через несколько минут.' }
    }
    if (!res.ok) return { ok: false, error: `Сервер ответил ${res.status}.` }
  } catch {
    return { ok: false, error: 'Сеть недоступна.' }
  }
  /* Отправленное не отправляем второй раз: счётчики обнуляются. */
  write({ ...emptyTelemetry(Date.now()), lastSentAt: Date.now(), sent: state.sent + 1 })
  return { ok: true, payload }
}
