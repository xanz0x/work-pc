/* ============================================================
   КОНТЕКСТ ЗАПРОСА (сервер)
   Кто сейчас делает запрос — известно proxy.ts; он кладёт id в заголовок,
   withRoute поднимает его в AsyncLocalStorage, а хранилища (диалоги,
   MCP-токены, синк) берут отсюда каталог пользователя. Маршруты не таскают
   uid через каждую сигнатуру.
   ============================================================ */

import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestUser = { uid: string; role: 'admin' | 'user'; legacy: boolean; sid: string }

const als = new AsyncLocalStorage<RequestUser | null>()

export function runWithUser<T>(user: RequestUser | null, fn: () => Promise<T>): Promise<T> {
  return als.run(user, fn)
}

export function currentUser(): RequestUser | null {
  return als.getStore() ?? null
}

/** Для маршрутов, которые обязаны знать пользователя: без него это ошибка конфигурации proxy. */
export function requireUser(): RequestUser {
  const u = currentUser()
  if (!u) throw new Error('маршрут вызван без пользователя: проверьте matcher в proxy.ts')
  return u
}

export function userFromHeaders(h: Headers): RequestUser | null {
  const uid = h.get('x-user-id')
  const sid = h.get('x-session-id')
  if (!uid || !sid) return null
  return { uid, sid, role: h.get('x-user-role') === 'admin' ? 'admin' : 'user', legacy: h.get('x-user-legacy') === '1' }
}
