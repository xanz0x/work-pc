'use client'

/* ============================================================
   TELEMETRY (клиент) · очередь на диске (§3.6 хвоста волны 2)
   Трекер локальный, внешних сервисов нет. Но если запрос не ушёл
   (офлайн, перезагрузка на середине), запись раньше терялась.
   Теперь она ложится в localStorage и уходит при следующем запуске.
   PII не пишем: только место и машинная причина, обрезанные.
   ============================================================ */

export const TELEMETRY_QUEUE_KEY = 'wf.telemetry.queue'
const MAX_QUEUE = 20

export type ClientErrorRec = { kind: string; where: string; message: string; at: number }

function readQueue(): ClientErrorRec[] {
  try {
    const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as ClientErrorRec[]) : []
  } catch {
    return []
  }
}

function writeQueue(items: ClientErrorRec[]): void {
  try {
    localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)))
  } catch {
    /* приватный режим — запись останется только в консоли */
  }
}

async function send(rec: ClientErrorRec): Promise<boolean> {
  try {
    const res = await fetch('/ai-api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: rec.kind, where: rec.where, message: rec.message }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Отправить сейчас; не ушло — положить в очередь до следующего запуска. */
export function reportClientError(rec: Omit<ClientErrorRec, 'at'>): void {
  const full: ClientErrorRec = { ...rec, message: rec.message.slice(0, 200), at: Date.now() }
  void send(full).then((ok) => {
    if (!ok) writeQueue([...readQueue(), full])
  })
}

/** Слить очередь при запуске приложения. Неудача оставляет запись на месте. */
export async function flushClientErrors(): Promise<number> {
  const items = readQueue()
  if (items.length === 0) return 0
  const left: ClientErrorRec[] = []
  let sent = 0
  for (const it of items) {
    if (await send(it)) sent += 1
    else left.push(it)
  }
  writeQueue(left)
  return sent
}
