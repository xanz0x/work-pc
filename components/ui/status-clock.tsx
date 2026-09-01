'use client'

import { useNow } from '@/lib/store/clock'

/**
 * Часы статус-бара (AR-1). Секундный тик приходит из ClockContext и
 * перерисовывает ровно этот элемент: каркас, сайдбар и экраны о нём
 * не знают. Пустая строка до первого клиентского тика — чтобы сервер
 * и клиент не спорили о текущей секунде при гидрации.
 */
export function StatusClock() {
  const now = useNow()
  return (
    <span className="sb-clock num" data-testid="status-clock">
      {now === 0 ? '' : new Date(now).toLocaleTimeString('ru-RU', { hour12: false })}
    </span>
  )
}
