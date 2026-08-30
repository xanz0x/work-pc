/* ============================================================
   Обёртка серверного маршрута (AR-5, шаг 2)
   Один request-id на запрос: он приходит из proxy.ts, попадает в лог,
   в трекер ошибок и в заголовок ответа — по нему ошибку можно найти.
   ============================================================ */

import { log, newRequestId } from './log'
import { countLatency, trackError } from './metrics'

type Handler<Req extends Request, Ctx> = (req: Req, ctx: Ctx, rid: string) => Promise<Response>

export function withRoute<Req extends Request, Ctx>(route: string, handler: Handler<Req, Ctx>) {
  return async (req: Req, ctx: Ctx): Promise<Response> => {
    const rid = req.headers.get('x-request-id') ?? newRequestId()
    const t0 = Date.now()
    try {
      const res = await handler(req, ctx, rid)
      const ms = Date.now() - t0
      countLatency(ms)
      log(res.status >= 500 ? 'error' : res.status >= 400 ? 'warn' : 'info', 'request.done', {
        rid,
        route,
        method: req.method,
        status: res.status,
        ms,
      })
      res.headers.set('X-Request-Id', rid)
      return res
    } catch (e) {
      const ms = Date.now() - t0
      countLatency(ms)
      trackError({
        rid,
        where: route,
        code: 'UNKNOWN',
        reason: e instanceof Error ? e.message : 'необработанное исключение',
      })
      log('error', 'request.fail', { rid, route, method: req.method, status: 500, ms })
      return new Response(
        JSON.stringify({ code: 'UNKNOWN', error: 'Внутренняя ошибка сервера.', requestId: rid }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'X-Request-Id': rid } },
      )
    }
  }
}
