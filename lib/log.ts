/* ============================================================
   LOG · структурированный лог с request-id (AR-5)
   Одна строка JSON на событие. Фильтр PII встроен в тип: логируются
   только перечисленные поля — ни содержимого запросов, ни имён файлов,
   ни значений переменных окружения. IP пишется хешем, не как есть.
   ============================================================ */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  return ORDER[(raw as LogLevel) in ORDER ? (raw as LogLevel) : 'info']
}

/** Разрешённые поля. Всё остальное в лог не попадает — это и есть фильтр PII. */
export type LogFields = {
  rid?: string
  route?: string
  method?: string
  status?: number
  ms?: number
  code?: string
  /** Признак, а не значение: сколько символов, сколько записей и т.п. */
  count?: number
  chars?: number
  tokens?: number
  where?: string
  /** Короткое машинное описание причины; текст пользователя сюда не кладём. */
  reason?: string
}

const ALLOWED: (keyof LogFields)[] = [
  'rid',
  'route',
  'method',
  'status',
  'ms',
  'code',
  'count',
  'chars',
  'tokens',
  'where',
  'reason',
]

export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Хеш адреса: связать серию запросов можно, установить владельца — нет. */
export function ipTag(ip: string): string {
  let h = 2166136261
  for (let i = 0; i < ip.length; i += 1) {
    h ^= ip.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (ORDER[level] < threshold()) return
  const safe: Record<string, unknown> = { t: new Date().toISOString(), level, event }
  for (const k of ALLOWED) if (fields[k] !== undefined) safe[k] = fields[k]
  const line = JSON.stringify(safe)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** Обёртка на серверный маршрут: request-id, латентность, статус. */
export function startRequest(route: string, method: string): {
  rid: string
  done: (status: number, extra?: LogFields) => number
} {
  const rid = newRequestId()
  const t0 = Date.now()
  log('debug', 'request.start', { rid, route, method })
  return {
    rid,
    done: (status, extra = {}) => {
      const ms = Date.now() - t0
      log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request.done', {
        rid,
        route,
        method,
        status,
        ms,
        ...extra,
      })
      return ms
    },
  }
}
