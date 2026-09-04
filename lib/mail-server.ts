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
import { discover, isLoopback, splitEmail, type Source } from './mail-discovery'
import { providerByDomain, type AuthHint, type Endpoint, type MailConfig } from './mail-providers'
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
  discovery: { source: Source | 'manual'; at: number }
  status: { smtp: CheckState; imap: CheckState; checkedAt: number; error?: string }
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

export function normalizeEndpoint(raw: unknown, kind: 'smtp' | 'imap'): Endpoint {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const host = String(o.host ?? '').trim().toLowerCase()
  const port = Number(o.port)
  const security = o.security === 'ssl' || o.security === 'starttls' || o.security === 'none' ? o.security : null
  if (!host || !(HOST_RE.test(host) || net.isIP(host))) throw new MailError('INVALID_ARGS', `Хост ${kind.toUpperCase()} указан неверно.`)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new MailError('INVALID_ARGS', `Порт ${kind.toUpperCase()} указан неверно.`)
  if (!security) throw new MailError('INVALID_ARGS', `Шифрование ${kind.toUpperCase()}: ssl, starttls или none.`)
  const loop = isLoopback(host)
  if (!loop && !PUBLIC_PORTS.has(port)) throw new MailError('INVALID_ARGS', `Порт ${port} не разрешён: допустимы 25, 465, 587, 143, 993.`)
  if (!loop && security === 'none') throw new MailError('INVALID_ARGS', 'Без шифрования можно подключаться только к 127.0.0.1 (Proton Bridge).')
  return { host, port, security }
}

export function normalizeConfig(raw: unknown): MailConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const smtp = normalizeEndpoint(o.smtp, 'smtp')
  const imap = o.imap === null || o.imap === undefined || o.imap === '' ? null : normalizeEndpoint(o.imap, 'imap')
  return { smtp, imap }
}

/* ---------- проверки соединения ---------- */

const tlsOpts = (host: string) => ({ servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !isLoopback(host) })

function transportFor(smtp: Endpoint, user: string, pass: string) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'ssl',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: { user, pass },
    tls: tlsOpts(smtp.host),
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
}

/** Ошибка соединения с учётом провайдера: Gmail → пароль приложения, Proton → Bridge. */
function refine(code: MailErrorCode, email: string): MailError {
  const p = providerByDomain(splitEmail(email)?.domain ?? '')
  if (p && code === 'AUTH_FAILED') {
    if (p.hint.kind === 'app-password') return new MailError('NEEDS_APP_PASSWORD', `${MESSAGES.AUTH_FAILED} ${p.hint.title}.`, p.hint)
    if (p.hint.kind === 'oauth') return new MailError('NEEDS_OAUTH', MESSAGES.NEEDS_OAUTH, p.hint)
  }
  if (p?.hint.kind === 'bridge' && code !== 'AUTH_FAILED') return new MailError('NEEDS_BRIDGE', MESSAGES.NEEDS_BRIDGE, p.hint)
  return new MailError(code, MESSAGES[code], p?.hint)
}

export async function verifySmtp(smtp: Endpoint, user: string, pass: string, email: string): Promise<void> {
  const t = transportFor(smtp, user, pass)
  try {
    await t.verify()
  } catch (e) {
    throw refine(classify(e), email)
  } finally {
    t.close()
  }
}

const imapQuote = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`

/** Минимальная проверка IMAP: приветствие → (STARTTLS) → LOGIN → LOGOUT. */
export function verifyImap(imap: Endpoint, user: string, pass: string, email: string, ms = 12_000): Promise<void> {
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
      reject(refine(code, email))
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
        const upgraded = tls.connect({ socket: sock, ...tlsOpts(imap.host) }, () => {
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
      sock = tls.connect({ host: imap.host, port: imap.port, ...tlsOpts(imap.host) })
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
export async function runChecks(cfg: MailConfig, user: string, pass: string, email: string): Promise<Checks> {
  const out: Checks = { smtp: 'unknown', imap: cfg.imap ? 'unknown' : 'unknown' }
  try {
    await verifySmtp(cfg.smtp, user, pass, email)
    out.smtp = 'ok'
  } catch (e) {
    const err = e as MailError
    return { smtp: 'fail', imap: 'unknown', error: err.message, code: err.code, hint: err.hint }
  }
  if (cfg.imap) {
    try {
      await verifyImap(cfg.imap, user, pass, email)
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

export type CreateInput = { name: string; email: string; password: string; user?: string; config?: MailConfig | null }

export type CreateResult =
  | { ok: true; account: AccountView; checks: Checks; source: Source | 'manual' }
  | { ok: false; code: MailErrorCode; error: string; hint?: AuthHint; checks: Checks; candidate?: MailConfig; source?: Source | 'manual' }

export async function createAccount(input: CreateInput): Promise<CreateResult> {
  const email = input.email.trim().toLowerCase()
  const empty: Checks = { smtp: 'unknown', imap: 'unknown' }
  if (!splitEmail(email)) return { ok: false, code: 'INVALID_ARGS', error: 'Адрес почты указан неверно.', checks: empty }
  if (!input.password) return { ok: false, code: 'INVALID_ARGS', error: 'Введите пароль.', checks: empty }

  let cfg = input.config ?? null
  let source: Source | 'manual' = 'manual'
  let user = (input.user ?? '').trim() || email
  let providerId: string | null = providerByDomain(splitEmail(email)!.domain)?.id ?? null

  if (!cfg) {
    const d = await discover(email)
    const best = d?.candidates[0]
    if (!best) {
      const p = providerByDomain(splitEmail(email)!.domain)
      return { ok: false, code: 'NO_CONFIG', error: MESSAGES.NO_CONFIG, hint: p?.hint, checks: empty }
    }
    cfg = best.config
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
    discovery: { source, at: Date.now() },
    status: { smtp: checks.smtp, imap: checks.imap, checkedAt: Date.now(), error: checks.error },
    createdAt: Date.now(),
    sentCount: 0,
    lastSentAt: null,
  }
  await upsert(acc)
  return { ok: true, account: toView(acc), checks, source }
}

export type UpdateInput = Partial<{ name: string; user: string; password: string; config: MailConfig }>

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
    next.discovery = { source: 'manual', at: Date.now() }
  }
  const checks = await runChecks({ smtp: next.smtp, imap: next.imap }, next.user, decryptSecret(next.passwordEnc), next.email)
  /* Новый пароль или хосты, с которыми SMTP не проходит, не сохраняем — старые остаются рабочими. */
  if (checks.smtp !== 'ok') return { account: toView(acc), checks, saved: false }
  next.status = { smtp: checks.smtp, imap: checks.imap, checkedAt: Date.now(), error: checks.error }
  await upsert(next)
  return { account: toView(next), checks, saved: true }
}

export async function testAccount(id: string): Promise<{ account: AccountView; checks: Checks } | null> {
  const acc = await getRaw(id)
  if (!acc) return null
  const checks = await runChecks({ smtp: acc.smtp, imap: acc.imap }, acc.user, decryptSecret(acc.passwordEnc), acc.email)
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
  const t = transportFor(acc.smtp, acc.user, decryptSecret(acc.passwordEnc))
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
    const err = refine(code, acc.email)
    acc.status = { ...acc.status, smtp: code === 'AUTH_FAILED' ? 'fail' : acc.status.smtp, checkedAt: Date.now(), error: err.message }
    await upsert(acc)
    throw new MailError(code === 'AUTH_FAILED' ? err.code : 'SEND_FAILED', `${MESSAGES.SEND_FAILED} ${err.message}`, err.hint)
  } finally {
    t.close()
  }
}
