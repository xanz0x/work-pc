/* ============================================================
   NF-8 · АВТОНОМНЫЙ РЕЖИМ: ОБЁРТКА НАД СЕТЬЮ
   Один шлюз на все четыре способа сходить наружу из браузера:
   fetch, XMLHttpRequest, WebSocket, EventSource и sendBeacon.

   Что считается «наружу»:
     external — другой origin (в автономном режиме запрещён всегда);
     egress   — свой origin, но маршрут ХОДИТ наружу за нас
                (`/proxy/*` — иконки сайтов) либо тело запроса просит
                внешнюю модель (`/ai-api/chat` с engine ≠ local);
     local    — свой origin и локальная работа: экраны, ассеты, чат с
                локальным движком, журнал, телеметрия (она пишется в файл
                рядом, наружу не уезжает).

   Автономный режим запрещает external и egress, local не трогает —
   иначе «автономность» означала бы «приложение не работает».
   Каждый запрет попадает в счётчик: статус-бар показывает не обещание,
   а факт — сколько исходящих запросов было остановлено.
   ============================================================ */

import { isOffline } from './flags'

export type TargetKind = 'local' | 'egress' | 'external'
export type NetVia = 'fetch' | 'xhr' | 'websocket' | 'eventsource' | 'beacon'

export type BlockedAttempt = { at: number; target: string; kind: TargetKind; via: NetVia }

/** Свои маршруты, которые ходят наружу за клиента. */
export const EGRESS_PREFIXES = ['/proxy/']

const MAX_LOG = 20

export class NetBlockedError extends Error {
  readonly target: string
  readonly kind: TargetKind
  constructor(target: string, kind: TargetKind) {
    super('Автономный режим: исходящий запрос запрещён')
    this.name = 'NetBlockedError'
    this.target = target
    this.kind = kind
  }
}

function origin(): string {
  try {
    if (typeof location !== 'undefined' && location.origin) return location.origin
  } catch {
    /* нет location — тест или воркер */
  }
  return 'http://localhost'
}

function urlOf(input: unknown): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, origin())
    if (input instanceof URL) return input
    if (typeof input === 'object' && input !== null && 'url' in input) {
      return new URL(String((input as { url: unknown }).url), origin())
    }
  } catch {
    return null
  }
  return null
}

/** Тело запроса просит внешнюю модель — значит запрос исходящий по смыслу. */
function cloudChat(path: string, body: unknown): boolean {
  if (!path.startsWith('/ai-api/chat')) return false
  if (typeof body !== 'string') return false
  try {
    const parsed = JSON.parse(body) as { engine?: unknown }
    return parsed.engine === 'cloud' || parsed.engine === 'hybrid'
  } catch {
    return false
  }
}

export function classifyTarget(input: unknown, body?: unknown): TargetKind {
  const url = urlOf(input)
  /* Не разобрали адрес — считаем внешним: молчаливая щель хуже отказа. */
  if (!url) return 'external'
  const sameHost = url.origin === origin() || url.host === new URL(origin()).host
  if (!sameHost) return 'external'
  if (EGRESS_PREFIXES.some((p) => url.pathname.startsWith(p))) return 'egress'
  if (cloudChat(url.pathname, body)) return 'egress'
  return 'local'
}

export function targetLabel(input: unknown): string {
  const url = urlOf(input)
  if (!url) return String(input).slice(0, 120)
  return url.origin === origin() ? url.pathname : `${url.origin}${url.pathname}`
}

/* ---------- журнал запретов ---------- */

let blocked: BlockedAttempt[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export function subscribeNet(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function blockedAttempts(): BlockedAttempt[] {
  return blocked
}

export function blockedCount(): number {
  return blocked.length
}

export function clearBlocked(): void {
  if (blocked.length === 0) return
  blocked = []
  emit()
}

function note(target: string, kind: TargetKind, via: NetVia): void {
  blocked = [{ at: Date.now(), target, kind, via }, ...blocked].slice(0, MAX_LOG)
  emit()
}

/**
 * Единственная точка решения. Возвращает причину отказа или null.
 * Вызывается и обёртками, и кодом, который хочет спросить заранее.
 */
export function denyReason(input: unknown, via: NetVia, body?: unknown): NetBlockedError | null {
  if (!isOffline()) return null
  const kind = classifyTarget(input, body)
  if (kind === 'local') return null
  const target = targetLabel(input)
  note(target, kind, via)
  return new NetBlockedError(target, kind)
}

/* ---------- установка обёрток ---------- */

let installed = false

export function netGuardInstalled(): boolean {
  return installed
}

/**
 * Идемпотентно оборачивает всё, чем из браузера можно выйти в сеть.
 * Патчим только то, что существует: воркер без WebSocket остаётся собой.
 */
export function installNetGuard(): void {
  if (installed) return
  installed = true
  const g = globalThis as Record<string, unknown> & typeof globalThis

  if (typeof g.fetch === 'function') {
    const original = g.fetch.bind(g)
    g.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const deny = denyReason(input, 'fetch', init?.body)
      if (deny) return Promise.reject(deny)
      return original(input as RequestInfo, init)
    }) as typeof fetch
  }

  if (typeof g.XMLHttpRequest === 'function') {
    const proto = (g.XMLHttpRequest as unknown as { prototype: XMLHttpRequest }).prototype
    const open = proto.open
    proto.open = function patchedOpen(this: XMLHttpRequest, ...args: unknown[]) {
      const deny = denyReason(args[1], 'xhr')
      if (deny) throw deny
      return (open as (...a: unknown[]) => void).apply(this, args)
    } as typeof proto.open
  }

  const holder = g as unknown as Record<string, unknown>
  for (const [name, via] of [
    ['WebSocket', 'websocket'],
    ['EventSource', 'eventsource'],
  ] as const) {
    const ctor = holder[name]
    if (typeof ctor !== 'function') continue
    holder[name] = new Proxy(ctor as new (...args: unknown[]) => unknown, {
      construct(target, args) {
        const deny = denyReason(args[0], via)
        if (deny) throw deny
        return Reflect.construct(target, args) as object
      },
    })
  }

  const nav = g.navigator as Navigator | undefined
  if (nav && typeof nav.sendBeacon === 'function') {
    const beacon = nav.sendBeacon.bind(nav)
    nav.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      if (denyReason(url, 'beacon')) return false
      return beacon(url, data)
    }) as typeof nav.sendBeacon
  }
}

/** Только для тестов: снять отметку установки (сами обёртки остаются). */
export function resetNetGuardFlag(): void {
  installed = false
}
