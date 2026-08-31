/**
 * Лимиты запросов к ИИ-слою. Счётчики живут в памяти процесса: пода одна,
 * базы у продукта нет, а задача — не дать перебрать ключ и пароль.
 */

const MINUTE = 60_000
const DAY = 86_400_000

type Win = { at: number; n: number }

const minute = new Map<string, Win>()
const day = new Map<string, Win>()
const login = new Map<string, Win>()
const telemetry = new Map<string, Win>()

function bump(map: Map<string, Win>, key: string, windowMs: number, limit: number): number {
  const now = Date.now()
  if (map.size > 5000) for (const [k, w] of map) if (now - w.at > windowMs) map.delete(k)
  const cur = map.get(key)
  if (!cur || now - cur.at > windowMs) {
    map.set(key, { at: now, n: 1 })
    return 0
  }
  cur.n += 1
  if (cur.n > limit) return Math.max(1, Math.ceil((windowMs - (now - cur.at)) / 1000))
  return 0
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function clientIp(h: Headers): string {
  const fwd = h.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return h.get('x-real-ip') ?? 'local'
}

/** Ход диалога: N в минуту и суточный бюджет с одного адреса. */
export function limitChat(ip: string): { ok: boolean; scope: 'minute' | 'day'; retryAfter: number } {
  const perMin = bump(minute, ip, MINUTE, envInt('AI_RATE_PER_MIN', 10))
  if (perMin) return { ok: false, scope: 'minute', retryAfter: perMin }
  const perDay = bump(day, ip, DAY, envInt('AI_RATE_PER_DAY', 200))
  if (perDay) return { ok: false, scope: 'day', retryAfter: perDay }
  return { ok: true, scope: 'minute', retryAfter: 0 }
}

/** Подбор пароля: 10 неудачных попыток на 15 минут с адреса. */
export function limitLogin(ip: string): number {
  return bump(login, ip, 15 * MINUTE, 10)
}

/**
 * Клиентская телеметрия открыта без сессии (§3.5): ошибка на экране входа
 * тоже должна доходить. Поэтому жёсткий лимит — 30 записей за 5 минут с IP.
 */
export function limitTelemetry(ip: string): number {
  return bump(telemetry, ip, 5 * MINUTE, 30)
}

/** Успешный вход обнуляет счётчик: лимит считает только промахи. */
export function resetLogin(ip: string): void {
  login.delete(ip)
}
