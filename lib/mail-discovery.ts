/* ============================================================
   ПОЧТА · автопоиск настроек по адресу
   Цепочка источников от надёжных к догадкам: встроенная таблица →
   Mozilla ISPDB → autoconfig домена → DNS SRV → MX-эвристика →
   Microsoft Autodiscover → перебор типовых хостов с TCP-пробой.
   Только встроенные fetch / node:dns / node:net / node:tls.
   ============================================================ */

import { promises as dns } from 'node:dns'
import net from 'node:net'
import os from 'node:os'
import tls from 'node:tls'
import {
  PLAIN_HINT,
  providerByDomain,
  providerByMx,
  type AuthHint,
  type Endpoint,
  type MailConfig,
  type Provider,
  type Security,
} from './mail-providers'

export type Source = 'builtin' | 'ispdb' | 'autoconfig' | 'srv' | 'mx' | 'autodiscover' | 'guess'

export type Candidate = {
  source: Source
  confidence: number
  providerId: string | null
  config: MailConfig
  /** Логин, если источник его знает (обычно = email). */
  user?: string
}

export type Discovery = {
  email: string
  domain: string
  provider: { id: string; name: string } | null
  hint: AuthHint
  candidates: Candidate[]
  /** Проверка Bridge с сервера: виден ли локальный почтовый сервер Proton. */
  bridge?: { reachable: boolean; smtp: boolean; imap: boolean; serverHost: string }
  /** Альтернативный способ подключения провайдера (Proton: SMTP-токен). */
  alt?: { id: string; label: string; config: MailConfig; hint: AuthHint }
  ms: number
}

const CONFIDENCE: Record<Source, number> = {
  builtin: 0.95,
  ispdb: 0.9,
  autoconfig: 0.85,
  srv: 0.8,
  mx: 0.7,
  autodiscover: 0.65,
  guess: 0.4,
}

export const EMAIL_RE = /^[^\s@"'<>]+@([a-z0-9-]+\.)+[a-z]{2,}$/i

export function splitEmail(email: string): { local: string; domain: string } | null {
  const e = email.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return null
  const at = e.lastIndexOf('@')
  return { local: e.slice(0, at), domain: e.slice(at + 1) }
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

/* ---------- парсер clientConfig (Thunderbird / ISPDB / autoconfig) ---------- */

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, 'i'))
  return m ? m[1].trim() : null
}

const blocks = (xml: string, name: string, type: string): string[] => {
  const re = new RegExp(`<${name}\\s[^>]*type=["']${type}["'][^>]*>([\\s\\S]*?)</${name}>`, 'gi')
  const out: string[] = []
  for (const m of xml.matchAll(re)) out.push(m[1])
  return out
}

function socketToSecurity(s: string | null): Security {
  const v = (s ?? '').toUpperCase()
  if (v === 'SSL') return 'ssl'
  if (v === 'STARTTLS') return 'starttls'
  return 'none'
}

function endpointOf(block: string): Endpoint | null {
  const host = tag(block, 'hostname')
  const port = Number(tag(block, 'port'))
  if (!host || !Number.isInteger(port) || port <= 0) return null
  return { host: host.toLowerCase(), port, security: socketToSecurity(tag(block, 'socketType')) }
}

/** Подставить %EMAILADDRESS% / %EMAILLOCALPART% из шаблона логина. */
function userOf(block: string, email: string): string | undefined {
  const raw = tag(block, 'username')
  if (!raw) return undefined
  const parts = splitEmail(email)
  return raw
    .replace(/%EMAILADDRESS%/gi, email)
    .replace(/%EMAILLOCALPART%/gi, parts?.local ?? email)
    .replace(/%EMAILDOMAIN%/gi, parts?.domain ?? '')
}

/** Лучший IMAP + SMTP из clientConfig; SSL предпочитается STARTTLS. */
export function parseClientConfig(xml: string, email: string): { config: MailConfig; user?: string } | null {
  const rank = (e: Endpoint | null) => (e?.security === 'ssl' ? 2 : e?.security === 'starttls' ? 1 : 0)
  const pick = (list: string[]) =>
    list
      .map((b) => ({ ep: endpointOf(b), user: userOf(b, email) }))
      .filter((x) => x.ep && x.ep.security !== 'none')
      .sort((a, b) => rank(b.ep) - rank(a.ep))[0] ?? null
  const smtp = pick(blocks(xml, 'outgoingServer', 'smtp'))
  if (!smtp?.ep) return null
  const imap = pick(blocks(xml, 'incomingServer', 'imap'))
  return { config: { smtp: smtp.ep, imap: imap?.ep ?? null }, user: imap?.user ?? smtp.user }
}

/* ---------- DNS SRV (RFC 6186) ---------- */

export type SrvRecord = { name: string; port: number; priority: number }
export type SrvSet = Partial<Record<'imaps' | 'imap' | 'submissions' | 'submission', SrvRecord[]>>

const bestSrv = (list?: SrvRecord[]) =>
  (list ?? []).filter((r) => r.name && r.name !== '.' && r.port > 0).sort((a, b) => a.priority - b.priority)[0]

export function configFromSrv(srv: SrvSet): MailConfig | null {
  const s465 = bestSrv(srv.submissions)
  const s587 = bestSrv(srv.submission)
  const smtp: Endpoint | null = s465
    ? { host: s465.name.replace(/\.$/, ''), port: s465.port, security: 'ssl' }
    : s587
      ? { host: s587.name.replace(/\.$/, ''), port: s587.port, security: 'starttls' }
      : null
  if (!smtp) return null
  const i993 = bestSrv(srv.imaps)
  const i143 = bestSrv(srv.imap)
  const imap: Endpoint | null = i993
    ? { host: i993.name.replace(/\.$/, ''), port: i993.port, security: 'ssl' }
    : i143
      ? { host: i143.name.replace(/\.$/, ''), port: i143.port, security: 'starttls' }
      : null
  return { smtp, imap }
}

/* ---------- Microsoft Autodiscover (POX) ---------- */

export function parseAutodiscover(xml: string): MailConfig | null {
  const protocols = [...xml.matchAll(/<Protocol>([\s\S]*?)<\/Protocol>/gi)].map((m) => m[1])
  const find = (type: string): Endpoint | null => {
    for (const p of protocols) {
      if ((tag(p, 'Type') ?? '').toUpperCase() !== type) continue
      const host = tag(p, 'Server')
      const port = Number(tag(p, 'Port'))
      if (!host || !port) continue
      const enc = (tag(p, 'Encryption') ?? tag(p, 'SSL') ?? '').toLowerCase()
      const security: Security = enc === 'tls' || enc === 'auto' ? 'starttls' : enc === 'off' ? 'none' : 'ssl'
      return { host: host.toLowerCase(), port, security: port === 587 || port === 143 ? 'starttls' : security }
    }
    return null
  }
  const smtp = find('SMTP')
  if (!smtp) return null
  return { smtp, imap: find('IMAP') }
}

/* ---------- сетевые помощники ---------- */

async function fetchText(url: string, ms: number): Promise<string | null> {
  if (!url.startsWith('https://')) return null
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { accept: 'text/xml,application/xml' } })
    if (!r.ok) return null
    const text = await r.text()
    return text.length > 200_000 ? null : text
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const ALLOWED_PORTS = new Set([25, 465, 587, 143, 993])
/** Порты Proton Bridge: разрешены только для проб Bridge и ящиков с флагом bridge. */
export const BRIDGE_PORTS = new Set([1025, 1143])

/** TCP-проба: TLS-handshake для 465/993, баннер для 587/143 и портов Bridge. */
export function probe(host: string, port: number, ms = 3000): Promise<boolean> {
  if (!ALLOWED_PORTS.has(port) && !BRIDGE_PORTS.has(port)) return Promise.resolve(false)
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      resolve(ok)
    }
    const secure = port === 465 || port === 993
    const sock = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => finish(true))
      : net.connect({ host, port })
    if (!secure) sock.once('data', (d) => finish(/^(\* OK|220)/.test(d.toString('latin1'))))
    sock.once('error', () => finish(false))
    const timer = setTimeout(() => finish(false), ms)
  })
}

async function srvLookup(domain: string): Promise<SrvSet> {
  const q = async (name: string): Promise<SrvRecord[]> => {
    try {
      return await dns.resolveSrv(`${name}.${domain}`)
    } catch {
      return []
    }
  }
  const [imaps, imap, submissions, submission] = await Promise.all([
    q('_imaps._tcp'),
    q('_imap._tcp'),
    q('_submissions._tcp'),
    q('_submission._tcp'),
  ])
  return { imaps, imap, submissions, submission }
}

async function mxLookup(domain: string): Promise<string[]> {
  try {
    const mx = await dns.resolveMx(domain)
    return mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange)
  } catch {
    return []
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

/* ---------- источники ---------- */

async function fromIspdb(domain: string, email: string): Promise<Candidate | null> {
  const xml = await fetchText(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, 3500)
  const parsed = xml && parseClientConfig(xml, email)
  return parsed ? { source: 'ispdb', confidence: CONFIDENCE.ispdb, providerId: null, ...parsed } : null
}

async function fromAutoconfig(domain: string, email: string): Promise<Candidate | null> {
  const urls = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
  ]
  const results = await Promise.all(urls.map((u) => fetchText(u, 3500)))
  for (const xml of results) {
    const parsed = xml && parseClientConfig(xml, email)
    if (parsed) return { source: 'autoconfig', confidence: CONFIDENCE.autoconfig, providerId: null, ...parsed }
  }
  return null
}

async function fromSrv(domain: string): Promise<Candidate | null> {
  const cfg = configFromSrv(await srvLookup(domain))
  return cfg ? { source: 'srv', confidence: CONFIDENCE.srv, providerId: null, config: cfg } : null
}

async function fromMx(domain: string): Promise<{ candidate: Candidate | null; provider: Provider | null; mx: string[] }> {
  const mx = await mxLookup(domain)
  const provider = providerByMx(mx)
  return {
    mx,
    provider,
    candidate: provider ? { source: 'mx', confidence: CONFIDENCE.mx, providerId: provider.id, config: provider.config } : null,
  }
}

async function fromAutodiscover(domain: string, email: string): Promise<Candidate | null> {
  const body = `<?xml version="1.0" encoding="utf-8"?><Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006"><Request><EMailAddress>${email}</EMailAddress><AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema></Request></Autodiscover>`
  const urls = [`https://autodiscover.${domain}/autodiscover/autodiscover.xml`, `https://${domain}/autodiscover/autodiscover.xml`]
  for (const url of urls) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 3500)
    try {
      const r = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/xml' }, signal: ctl.signal })
      if (!r.ok) continue
      const cfg = parseAutodiscover(await r.text())
      if (cfg) return { source: 'autodiscover', confidence: CONFIDENCE.autodiscover, providerId: null, config: cfg }
    } catch {
      /* следующий адрес */
    } finally {
      clearTimeout(t)
    }
  }
  return null
}

async function fromGuess(domain: string): Promise<Candidate | null> {
  const imapHosts = [`imap.${domain}`, `mail.${domain}`, domain]
  const smtpHosts = [`smtp.${domain}`, `mail.${domain}`, domain]
  const tries = <T extends { host: string; port: number }>(list: T[]) =>
    Promise.all(list.map(async (t) => ((await probe(t.host, t.port)) ? t : null)))
  const [smtpHits, imapHits] = await Promise.all([
    tries(smtpHosts.flatMap((host) => [{ host, port: 465 }, { host, port: 587 }])),
    tries(imapHosts.flatMap((host) => [{ host, port: 993 }, { host, port: 143 }])),
  ])
  const s = smtpHits.find(Boolean)
  if (!s) return null
  const i = imapHits.find(Boolean)
  return {
    source: 'guess',
    confidence: CONFIDENCE.guess,
    providerId: null,
    config: {
      smtp: { host: s.host, port: s.port, security: s.port === 465 ? 'ssl' : 'starttls' },
      imap: i ? { host: i.host, port: i.port, security: i.port === 993 ? 'ssl' : 'starttls' } : null,
    },
  }
}

/* ---------- цепочка ---------- */

/** Виден ли Proton Bridge с сервера: баннеры SMTP «220» и IMAP «* OK» на loopback. */
export async function probeBridge(cfg: MailConfig): Promise<NonNullable<Discovery['bridge']>> {
  const [smtp, imap] = await Promise.all([
    probe(cfg.smtp.host, cfg.smtp.port, 1500),
    cfg.imap ? probe(cfg.imap.host, cfg.imap.port, 1500) : Promise.resolve(false),
  ])
  return { reachable: smtp, smtp, imap, serverHost: os.hostname() }
}

export async function discover(emailRaw: string): Promise<Discovery | null> {
  const t0 = Date.now()
  const parts = splitEmail(emailRaw)
  if (!parts) return null
  const email = emailRaw.trim().toLowerCase()
  const { domain } = parts
  const done = (provider: Provider | null, candidates: Candidate[]): Discovery => ({
    email,
    domain,
    provider: provider ? { id: provider.id, name: provider.name } : null,
    hint: provider?.hint ?? PLAIN_HINT,
    candidates: candidates.sort((a, b) => b.confidence - a.confidence),
    ms: Date.now() - t0,
  })

  const builtin = providerByDomain(domain)
  if (builtin) {
    const d = done(builtin, [
      { source: 'builtin', confidence: CONFIDENCE.builtin, providerId: builtin.id, config: builtin.config, user: email },
    ])
    if (builtin.alt) d.alt = builtin.alt
    if (builtin.hint.kind === 'bridge') d.bridge = await probeBridge(builtin.config)
    d.ms = Date.now() - t0
    return d
  }

  const [ispdb, autoconfig, srv, mx] = await Promise.all([
    withTimeout(fromIspdb(domain, email), 4000, null),
    withTimeout(fromAutoconfig(domain, email), 4000, null),
    withTimeout(fromSrv(domain), 4000, null),
    withTimeout(fromMx(domain), 4000, { candidate: null, provider: null, mx: [] as string[] }),
  ])
  const found = [ispdb, autoconfig, srv, mx.candidate].filter((c): c is Candidate => c !== null)
  if (found.length > 0) return done(mx.provider, found)

  const microsoft = mx.mx.some((h) => /outlook\.com$|office365\.com$/i.test(h))
  if (microsoft) {
    const ad = await withTimeout(fromAutodiscover(domain, email), 5000, null)
    if (ad) return done(mx.provider, [ad])
  }

  const guess = await withTimeout(fromGuess(domain), 6000, null)
  return done(mx.provider, guess ? [guess] : [])
}
