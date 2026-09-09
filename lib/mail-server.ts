/* ============================================================
   ПОЧТА · ящики пользователя на сервере, проверка и отправка
   accounts.json лежит в каталоге пользователя, пароль — AES-GCM.
   Пароль расшифровывается на время одного соединения и не кэшируется.
   SMTP — nodemailer; проверка IMAP — минимальный LOGIN на node:tls.
   ============================================================ */

import { promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { randomBytes } from 'node:crypto'
import nodemailer from 'nodemailer'
import { decryptSecret, encryptSecret } from './mail-crypto'
import { BRIDGE_PORTS, discover, isLoopback, splitEmail, type Source } from './mail-discovery'
import { PROTON_TOKEN_HINT, providerByDomain, type AuthHint, type Endpoint, type MailConfig } from './mail-providers'
import { requireUser } from './request-context'
import { userDir } from './users-server'

export type CheckState = 'ok' | 'fail' | 'unknown'

export type MailAccount = {
  id: string
  name: string
  email: string
  provider: string | null
  smtp: Endpoint
  imap: Endpoint | null
  user: string
  passwordEnc: string
  /** Ящик через Proton Bridge: разрешены порты 1025/1143 и самоподписанный сертификат Bridge. */
  bridge: boolean
  discovery: { source: Source | 'manual'; at: number }
  status: { smtp: CheckState; imap: CheckState; checkedAt: number; error?: string }
  /** Последняя удачная синхронизация по IMAP (фаза 2): когда, сколько непрочитанных и всего во «Входящих». */
  imapSync?: { at: number; unseen: number; total: number }
  createdAt: number
  sentCount: number
  lastSentAt: number | null
}

export type AccountView = Omit<MailAccount, 'passwordEnc'> & { hasPassword: true }

export type MailErrorCode =
  | 'AUTH_FAILED'
  | 'CONNECT_FAILED'
  | 'TLS_FAILED'
  | 'NEEDS_APP_PASSWORD'
  | 'NEEDS_BRIDGE'
  | 'NEEDS_OAUTH'
  | 'NO_CONFIG'
  | 'INVALID_ARGS'
  | 'SEND_FAILED'
  | 'NO_IMAP'
  | 'NOT_FOUND'
  | 'READ_FAILED'

export class MailError extends Error {
  constructor(
    public code: MailErrorCode,
    message: string,
    public hint?: AuthHint,
  ) {
    super(message)
  }
}

/* ---------- хранение ---------- */

function file(): string {
  const u = requireUser()
  return path.join(userDir(u.uid, u.legacy), 'mail', 'accounts.json')
}

async function readAll(): Promise<MailAccount[]> {
  try {
    const raw = await fs.readFile(file(), 'utf8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? (list as MailAccount[]) : []
  } catch {
    return []
  }
}

async function writeAll(list: MailAccount[]): Promise<void> {
  const p = file()
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, p)
}

export function toView(a: MailAccount): AccountView {
  const { passwordEnc: _drop, ...rest } = a
  void _drop
  return { ...rest, hasPassword: true }
}

export async function listAccounts(): Promise<AccountView[]> {
  return (await readAll()).map(toView)
}

async function getRaw(id: string): Promise<MailAccount | null> {
  return (await readAll()).find((a) => a.id === id) ?? null
}

/** Ящик с зашифрованным паролем — только для серверных сценариев (IMAP-чтение), наружу не отдавать. */
export const getAccountRaw = getRaw

/** Отметка удачного IMAP-обхода: статус IMAP «ok», время и счётчики «Входящих». */
export async function noteImapSync(id: string, patch: Partial<{ unseen: number; total: number }>): Promise<void> {
  const acc = await getRaw(id)
  if (!acc) return
  const prev = acc.imapSync ?? { at: 0, unseen: 0, total: 0 }
  acc.imapSync = { at: Date.now(), unseen: patch.unseen ?? prev.unseen, total: patch.total ?? prev.total }
  acc.status = { ...acc.status, imap: 'ok', error: acc.status.smtp === 'fail' ? acc.status.error : undefined }
  await upsert(acc)
}

/** IMAP-обход не удался: статус и текст ошибки на карточке. */
export async function noteImapError(id: string, error: string): Promise<void> {
  const acc = await getRaw(id)
  if (!acc) return
  acc.status = { ...acc.status, imap: 'fail', checkedAt: Date.now(), error: `IMAP: ${error}` }
  await upsert(acc)
}

export async function removeAccount(id: string): Promise<boolean> {
  const list = await readAll()
  const next = list.filter((a) => a.id !== id)
  if (next.length === list.length) return false
  await writeAll(next)
  return true
}

async function upsert(acc: MailAccount): Promise<void> {
  const list = await readAll()
  const i = list.findIndex((a) => a.id === acc.id)
  if (i < 0) list.push(acc)
  else list[i] = acc
  await writeAll(list)
}

/* ---------- валидация конфигурации ---------- */

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
const PUBLIC_PORTS = new Set([25, 465, 587, 143, 993])

export function normalizeEndpoint(raw: unknown, kind: 'smtp' | 'imap', bridge = false): Endpoint {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const host = String(o.host ?? '').trim().toLowerCase()
  const port = Number(o.port)
  const security = o.security === 'ssl' || o.security === 'starttls' || o.security === 'none' ? o.security : null
  if (!host || !(HOST_RE.test(host) || net.isIP(host))) throw new MailError('INVALID_ARGS', `Хост ${kind.toUpperCase()} указан неверно.`)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new MailError('INVALID_ARGS', `Порт ${kind.toUpperCase()} указан неверно.`)
  if (!security) throw new MailError('INVALID_ARGS', `Шифрование ${kind.toUpperCase()}: ssl, starttls или none.`)
  const loop = isLoopback(host)
  if (!loop && !PUBLIC_PORTS.has(port) && !(bridge && BRIDGE_PORTS.has(port))) {
    throw new MailError('INVALID_ARGS', `Порт ${port} не разрешён: допустимы 25, 465, 587, 143, 993${bridge ? ', для Bridge — 1025, 1143' : ''}.`)
  }
  if (!loop && security === 'none') throw new MailError('INVALID_ARGS', 'Без шифрования можно подключаться только к 127.0.0.1 (Proton Bridge).')
  return { host, port, security }
}

export type ServerConfig = MailConfig & { bridge: boolean }

export function normalizeConfig(raw: unknown): ServerConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bridge = o.bridge === true
  const smtp = normalizeEndpoint(o.smtp, 'smtp', bridge)
  const imap = o.imap === null || o.imap === undefined || o.imap === '' ? null : normalizeEndpoint(o.imap, 'imap', bridge)
  return { smtp, imap, bridge }
}

/* ---------- проверки соединения ---------- */

/* Сертификат проверяется всегда, кроме loopback и ящиков Bridge: у Bridge он самоподписанный. */
const tlsOpts = (host: string, bridge = false) => ({ servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !isLoopback(host) && !bridge })

function transportFor(smtp: Endpoint, user: string, pass: string, bridge = false) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'ssl',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: { user, pass },
    tls: tlsOpts(smtp.host, bridge),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
}

function classify(e: unknown): MailErrorCode {
  const err = e as { code?: string; responseCode?: number; message?: string }
  if (err.code === 'EAUTH' || (err.responseCode && err.responseCode >= 530 && err.responseCode <= 535)) return 'AUTH_FAILED'
  const msg = String(err.message ?? '').toLowerCase()
  if (/certificate|self.signed|tls|ssl|handshake/.test(msg) || err.code === 'ESOCKET') return 'TLS_FAILED'
  return 'CONNECT_FAILED'
}

const MESSAGES: Record<MailErrorCode, string> = {
  AUTH_FAILED: 'Сервер отклонил логин или пароль.',
  CONNECT_FAILED: 'Не удалось подключиться к серверу: хост, порт или сеть.',
  TLS_FAILED: 'Не удалось установить защищённое соединение (TLS).',
  NEEDS_APP_PASSWORD: 'Провайдер принимает только пароль приложения.',
  NEEDS_BRIDGE: 'Proton доступен только через Proton Bridge на этой машине.',
  NEEDS_OAUTH: 'Провайдер требует вход через OAuth2 — пока не поддерживается.',
  NO_CONFIG: 'Настройки сервера для этого адреса найти не удалось.',
  INVALID_ARGS: 'Неверные параметры.',
  SEND_FAILED: 'Письмо не отправлено.',
  NO_IMAP: 'У ящика не настроен IMAP.',
  NOT_FOUND: 'Папка или письмо не найдены.',
  READ_FAILED: 'IMAP-сервер вернул ошибку.',
}

/** Ошибка соединения с учётом провайдера: Gmail → пароль приложения, Proton → Bridge или SMTP-токен. */
function refine(code: MailErrorCode, email: string, host = ''): MailError {
  const p = providerByDomain(splitEmail(email)?.domain ?? '')
  if (p?.hint.kind === 'bridge' && /protonmail\.ch$/.test(host)) {
    if (code === 'AUTH_FAILED') return new MailError('AUTH_FAILED', 'Proton отклонил SMTP-токен: проверьте токен, платный план и что адрес — на вашем собственном домене.', PROTON_TOKEN_HINT)
    return new MailError(code, MESSAGES[code], PROTON_TOKEN_HINT)
  }
  if (p?.hint.kind === 'bridge' && code !== 'AUTH_FAILED') {
    return new MailError('NEEDS_BRIDGE', `${MESSAGES.NEEDS_BRIDGE} Сервер не увидел Bridge по адресу ${host}.`, p.hint)
  }
  if (p && code === 'AUTH_FAILED') {
    if (p.hint.kind === 'app-password') return new MailError('NEEDS_APP_PASSWORD', `${MESSAGES.AUTH_FAILED} ${p.hint.title}.`, p.hint)
    if (p.hint.kind === 'oauth') return new MailError('NEEDS_OAUTH', MESSAGES.NEEDS_OAUTH, p.hint)
  }
  return new MailError(code, MESSAGES[code], p?.hint)
}

export async function verifySmtp(smtp: Endpoint, user: string, pass: string, email: string, bridge = false): Promise<void> {
  const t = transportFor(smtp, user, pass, bridge)
  try {
    await t.verify()
  } catch (e) {
    throw refine(classify(e), email, smtp.host)
  } finally {
    t.close()
  }
}

const imapQuote = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`

/** Минимальная проверка IMAP: приветствие → (STARTTLS) → LOGIN → LOGOUT. */
export function verifyImap(imap: Endpoint, user: string, pass: string, email: string, bridge = false, ms = 12_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let sock: net.Socket | tls.TLSSocket
    let buf = ''
    let stage: 'greet' | 'starttls' | 'login' | 'done' = 'greet'
    let settled = false
    const fail = (code: MailErrorCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock?.destroy()
      reject(refine(code, email, imap.host))
    }
    const ok = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sock.write('a2 LOGOUT\r\n')
      } catch {
        /* уже закрыт */
      }
      setTimeout(() => sock.destroy(), 200)
      resolve()
    }
    const timer = setTimeout(() => fail('CONNECT_FAILED'), ms)

    const onLine = (line: string) => {
      if (stage === 'greet') {
        if (/^\* (OK|PREAUTH)/i.test(line)) {
          if (imap.security === 'starttls') {
            stage = 'starttls'
            sock.write('a0 STARTTLS\r\n')
          } else {
            stage = 'login'
            sock.write(`a1 LOGIN ${imapQuote(user)} ${imapQuote(pass)}\r\n`)
          }
        } else if (/^\* BYE/i.test(line)) fail('CONNECT_FAILED')
        return
      }
      if (stage === 'starttls') {
        if (!/^a0 /i.test(line)) return
        if (!/^a0 OK/i.test(line)) return fail('TLS_FAILED')
        sock.removeAllListeners('data')
        const upgraded = tls.connect({ socket: sock, ...tlsOpts(imap.host, bridge) }, () => {
          stage = 'login'
          upgraded.write(`a1 LOGIN ${imapQuote(user)} ${imapQuote(pass)}\r\n`)
        })
        upgraded.on('error', () => fail('TLS_FAILED'))
        upgraded.on('data', onData)
        sock = upgraded
        return
      }
      if (stage === 'login' && /^a1 /i.test(line)) {
        stage = 'done'
        if (/^a1 OK/i.test(line)) ok()
        else fail('AUTH_FAILED')
      }
    }
    const onData = (d: Buffer) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        onLine(line)
      }
    }

    if (imap.security === 'ssl') {
      sock = tls.connect({ host: imap.host, port: imap.port, ...tlsOpts(imap.host, bridge) })
      sock.on('error', (e: NodeJS.ErrnoException) => fail(/CERT|certificate|handshake|SSL|TLS/i.test(String(e.code ?? e.message)) ? 'TLS_FAILED' : 'CONNECT_FAILED'))
    } else {
      sock = net.connect({ host: imap.host, port: imap.port })
      sock.on('error', () => fail('CONNECT_FAILED'))
    }
    sock.on('data', onData)
    sock.on('close', () => {
      if (stage !== 'done') fail('CONNECT_FAILED')
    })
  })
}

export type Checks = { smtp: CheckState; imap: CheckState; error?: string; code?: MailErrorCode; hint?: AuthHint }

/** SMTP обязан пройти; IMAP проверяется и отмечается, но отправку не блокирует. */
export async function runChecks(cfg: ServerConfig, user: string, pass: string, email: string): Promise<Checks> {
  const out: Checks = { smtp: 'unknown', imap: 'unknown' }
  try {
    await verifySmtp(cfg.smtp, user, pass, email, cfg.bridge)
    out.smtp = 'ok'
  } catch (e) {
    const err = e as MailError
    return { smtp: 'fail', imap: 'unknown', error: err.message, code: err.code, hint: err.hint }
  }
  if (cfg.imap) {
    try {
      await verifyImap(cfg.imap, user, pass, email, cfg.bridge)
      out.imap = 'ok'
    } catch (e) {
      const err = e as MailError
      out.imap = 'fail'
      out.error = `IMAP: ${err.message}`
      out.code = err.code
      out.hint = err.hint
    }
  }
  return out
}

/* ---------- сценарии ---------- */

export type CreateInput = { name: string; email: string; password: string; user?: string; config?: ServerConfig | null; source?: string }

export type CreateResult =
  | { ok: true; account: AccountView; checks: Checks; source: Source | 'manual' }
  | { ok: false; code: MailErrorCode; error: string; hint?: AuthHint; checks: Checks; candidate?: MailConfig; source?: Source | 'manual' }

export async function createAccount(input: CreateInput): Promise<CreateResult> {
  const email = input.email.trim().toLowerCase()
  const empty: Checks = { smtp: 'unknown', imap: 'unknown' }
  if (!splitEmail(email)) return { ok: false, code: 'INVALID_ARGS', error: 'Адрес почты указан неверно.', checks: empty }
  if (!input.password) return { ok: false, code: 'INVALID_ARGS', error: 'Введите пароль.', checks: empty }

  const SOURCES: (Source | 'manual')[] = ['builtin', 'ispdb', 'autoconfig', 'srv', 'mx', 'autodiscover', 'guess', 'manual']
  let cfg: ServerConfig | null = input.config ?? null
  let source: Source | 'manual' = SOURCES.includes(input.source as Source) ? (input.source as Source) : 'manual'
  let user = (input.user ?? '').trim() || email
  let providerId: string | null = providerByDomain(splitEmail(email)!.domain)?.id ?? null

  if (!cfg) {
    const d = await discover(email)
    const best = d?.candidates[0]
    if (!best) {
      const p = providerByDomain(splitEmail(email)!.domain)
      return { ok: false, code: 'NO_CONFIG', error: MESSAGES.NO_CONFIG, hint: p?.hint, checks: empty }
    }
    cfg = { ...best.config, bridge: d?.hint.kind === 'bridge' }
    source = best.source
    if (!input.user && best.user) user = best.user
    providerId = best.providerId ?? d?.provider?.id ?? null
  }

  const checks = await runChecks(cfg, user, input.password, email)
  if (checks.smtp !== 'ok') {
    return { ok: false, code: checks.code ?? 'CONNECT_FAILED', error: checks.error ?? MESSAGES.CONNECT_FAILED, hint: checks.hint, checks, candidate: cfg, source }
  }

  const acc: MailAccount = {
    id: randomBytes(4).toString('hex'),
    name: input.name.trim().slice(0, 60) || email,
    email,
    provider: providerId,
    smtp: cfg.smtp,
    imap: cfg.imap,
    user,
    passwordEnc: encryptSecret(input.password),
    bridge: cfg.bridge,
    discovery: { source, at: Date.now() },
    status: { smtp: checks.smtp, imap: checks.imap, checkedAt: Date.now(), error: checks.error },
    createdAt: Date.now(),
    sentCount: 0,
    lastSentAt: null,
  }
  await upsert(acc)
  return { ok: true, account: toView(acc), checks, source }
}

export type UpdateInput = Partial<{ name: string; user: string; password: string; config: ServerConfig }>

export async function updateAccount(id: string, patch: UpdateInput): Promise<{ account: AccountView; checks: Checks; saved: boolean } | null> {
  const acc = await getRaw(id)
  if (!acc) return null
  const next: MailAccount = { ...acc }
  if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 60) || acc.email
  if (patch.user) next.user = patch.user.trim()
  if (patch.password) next.passwordEnc = encryptSecret(patch.password)
  if (patch.config) {
    next.smtp = patch.config.smtp
    next.imap = patch.config.imap
    next.bridge = patch.config.bridge
    next.discovery = { source: 'manual', at: Date.now() }
  }
  const checks = await runChecks({ smtp: next.smtp, imap: next.imap, bridge: next.bridge }, next.user, decryptSecret(next.passwordEnc), next.email)
  /* Новый пароль или хосты, с которыми SMTP не проходит, не сохраняем — старые остаются рабочими. */
  if (checks.smtp !== 'ok') return { account: toView(acc), checks, saved: false }
  next.status = { smtp: checks.smtp, imap: checks.imap, checkedAt: Date.now(), error: checks.error }
  await upsert(next)
  return { account: toView(next), checks, saved: true }
}

export async function testAccount(id: string): Promise<{ account: AccountView; checks: Checks } | null> {
  const acc = await getRaw(id)
  if (!acc) return null
  const checks = await runChecks({ smtp: acc.smtp, imap: acc.imap, bridge: acc.bridge }, acc.user, decryptSecret(acc.passwordEnc), acc.email)
  acc.status = { smtp: checks.smtp, imap: checks.imap, checkedAt: Date.now(), error: checks.error }
  await upsert(acc)
  return { account: toView(acc), checks }
}

export type Attachment = { name: string; type?: string; dataBase64: string }
export type SendInput = { to: string[]; cc?: string[]; subject: string; text: string; html?: string; attachments?: Attachment[] }

export const MAX_ATTACH_BYTES = 15 * 1024 * 1024

export async function sendMail(id: string, msg: SendInput): Promise<{ messageId: string; accepted: number; account: AccountView } | null> {
  const acc = await getRaw(id)
  if (!acc) return null
  const t = transportFor(acc.smtp, acc.user, decryptSecret(acc.passwordEnc), acc.bridge)
  try {
    const info = await t.sendMail({
      from: { name: acc.name, address: acc.email },
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments?.map((a) => ({
        filename: a.name,
        content: Buffer.from(a.dataBase64, 'base64'),
        contentType: a.type || undefined,
      })),
    })
    acc.sentCount += 1
    acc.lastSentAt = Date.now()
    acc.status = { ...acc.status, smtp: 'ok', checkedAt: Date.now() }
    await upsert(acc)
    return { messageId: String(info.messageId ?? ''), accepted: info.accepted?.length ?? msg.to.length + (msg.cc?.length ?? 0), account: toView(acc) }
  } catch (e) {
    const code = classify(e)
    const err = refine(code, acc.email, acc.smtp.host)
    acc.status = { ...acc.status, smtp: code === 'AUTH_FAILED' ? 'fail' : acc.status.smtp, checkedAt: Date.now(), error: err.message }
    await upsert(acc)
    throw new MailError(code === 'AUTH_FAILED' ? err.code : 'SEND_FAILED', `${MESSAGES.SEND_FAILED} ${err.message}`, err.hint)
  } finally {
    t.close()
  }
}
