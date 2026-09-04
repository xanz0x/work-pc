/* ============================================================
   НАСТРОЙКА БОКОВОГО МЕНЮ · порядок и скрытые пункты
   Чистая логика без React: её делят клиентский стор и серверный маршрут,
   поэтому любые данные из сети или диска проходят одну нормализацию.
   ============================================================ */

import type { ScreenId } from '@/lib/store/nav'

export type NavPrefs = { order: ScreenId[]; hidden: ScreenId[] }

export const NAV_DEFAULT_ORDER: ScreenId[] = ['library', 'map', 'chat', 'vault', 'mail', 'activity', 'settings', 'admin']

/** Пункты, которые нельзя скрыть: без «Настроек» меню не вернуть обратно. */
export const NAV_LOCKED: ScreenId[] = ['settings']

export const NAV_DEFAULT: NavPrefs = { order: NAV_DEFAULT_ORDER, hidden: [] }

const isId = (x: unknown): x is ScreenId =>
  typeof x === 'string' && (NAV_DEFAULT_ORDER as string[]).includes(x)

export function normalizeNavPrefs(input: unknown): NavPrefs {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const order = [...new Set(Array.isArray(o.order) ? o.order.filter(isId) : [])]
  for (const id of NAV_DEFAULT_ORDER) if (!order.includes(id)) order.push(id)
  const hidden = [...new Set(Array.isArray(o.hidden) ? o.hidden.filter(isId) : [])].filter(
    (id) => !NAV_LOCKED.includes(id),
  )
  return { order, hidden }
}

export function isDefaultNav(p: NavPrefs): boolean {
  return p.hidden.length === 0 && p.order.every((id, i) => NAV_DEFAULT_ORDER[i] === id)
}

/** Переставить `id` рядом с `target`: перед ним или сразу после. */
export function placeNav(order: ScreenId[], id: ScreenId, target: ScreenId, after: boolean): ScreenId[] {
  if (id === target) return order
  const rest = order.filter((x) => x !== id)
  const at = rest.indexOf(target)
  if (at < 0) return order
  rest.splice(after ? at + 1 : at, 0, id)
  return rest
}

export function toggleHidden(p: NavPrefs, id: ScreenId): NavPrefs {
  if (NAV_LOCKED.includes(id)) return p
  const hidden = p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id]
  return { order: p.order, hidden }
}
