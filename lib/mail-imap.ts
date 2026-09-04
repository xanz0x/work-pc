/* ============================================================
   ПОЧТА · чтение по IMAP (фаза 2): папки, список писем, письмо, флаги.
   Один клиент imapflow на запрос, пароль расшифровывается на время соединения.
   ============================================================ */

import net from 'node:net'
import { ImapFlow, type FetchMessageObject, type MessageAddressObject, type MessageStructureObject } from 'imapflow'
import { simpleParser, type AddressObject } from 'mailparser'
import { decryptSecret } from './mail-crypto'
import { isLoopback, splitEmail } from './mail-discovery'
import { sanitizeMailHtml } from './mail-html'
import { providerByDomain } from './mail-providers'
import { pageRange, sortFolders } from './mail-read'
import { MailError, noteImapSync, type MailAccount, type MailErrorCode } from './mail-server'

export const MAX_MESSAGE_BYTES = 6 * 1024 * 1024

export type Addr = { name: string; address: string }

export type FolderView = {
  path: string
  name: string
  delimiter: string
  specialUse: string | null
  total: number | null
  unseen: number | null
}

export type MessageRow = {
  uid: number
  seq: number
  subject: string
  from: Addr | null
  to: Addr[]
  date: string | null
  size: number
  seen: boolean
  flagged: boolean
  answered: boolean
  hasAttachments: boolean
}

export type AttachmentView = { filename: string; contentType: string; size: number; cid: string | null; inline: boolean }

export type MessageFull = {
  uid: number
  folder: string
  subject: string
  from: Addr | null
  to: Addr[]
  cc: Addr[]
  replyTo: Addr[]
  date: string | null
  size: number
  seen: boolean
  flagged: boolean
  answered: boolean
  html: string | null
  text: string | null
  attachments: AttachmentView[]
  truncated: boolean
}

function classifyImap(e: unknown, acc: MailAccount): MailError {
  if (e instanceof MailError) return e
  const err = e as { authenticationFailed?: boolean; code?: string; message?: string; responseStatus?: string; responseText?: string; serverResponseCode?: string; mailboxMissing?: boolean }
  const msg = `${err.message ?? ''} ${err.responseText ?? ''}`.toLowerCase()
  let code: MailErrorCode = 'READ_FAILED'
  if (err.authenticationFailed || /authenticat|login failed|invalid credentials/.test(msg)) code = 'AUTH_FAILED'
  else if (err.mailboxMissing || err.serverResponseCode === 'NONEXISTENT' || (err.responseStatus === 'NO' && /exist|unknown|not found|no such|invalid mailbox/.test(msg))) code = 'NOT_FOUND'
  else if (/certificate|self.signed|handshake|tls|ssl/.test(msg)) code = 'TLS_FAILED'
  else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|timeout|closed/i.test(String(err.code ?? '') + msg)) code = 'CONNECT_FAILED'
  const text: Record<string, string> = {
    AUTH_FAILED: 'IMAP-сервер отклонил логин или пароль.',
    TLS_FAILED: 'Не удалось установить защищённое соединение с IMAP (TLS).',
    CONNECT_FAILED: 'Не удалось подключиться к IMAP-серверу: хост, порт или сеть.',
    NOT_FOUND: 'Папка или письмо не найдены на сервере.',
    READ_FAILED: `IMAP-сервер вернул ошибку${err.responseText ? `: ${err.responseText.slice(0, 160)}` : '.'}`,
  }
  const p = providerByDomain(splitEmail(acc.email)?.domain ?? '')
  if (code === 'AUTH_FAILED' && p?.hint.kind === 'app-password') return new MailError('NEEDS_APP_PASSWORD', `${text.AUTH_FAILED} ${p.hint.title}.`, p.hint)
  return new MailError(code, text[code], code === 'AUTH_FAILED' ? p?.hint : undefined)
}

/* ---------- пул соединений ----------
   Одно живое соединение на ящик, команды в нём imapflow выстраивает в очередь сам. Логин + TLS стоят ~2 с,
   поэтому соединение держится 90 с после последнего запроса и закрывается само. Пароль живёт только
   внутри клиента; при смене настроек ящика (fingerprint) старое соединение выбрасывается. */

type Pooled = { client: ImapFlow; fp: string; busy: number; lastUsed: number; connecting: Promise<void> | null; queue: Promise<unknown>; folders: { at: number; list: FolderView[] } | null }

const pool = new Map<string, Pooled>()
const POOL_IDLE_MS = 90_000

const fingerprint = (acc: MailAccount) => JSON.stringify([acc.imap, acc.user, acc.passwordEnc, acc.bridge])

function dropPooled(id: string, p?: Pooled) {
  const cur = pool.get(id)
  if (!cur || (p && cur !== p)) return
  pool.delete(id)
  try {
    cur.client.close()
  } catch {
    /* уже закрыт */
  }
}

/** Ящик удалён — закрыть его соединение немедленно. */
export const dropImapConnection = (id: string) => dropPooled(id)

function sweepPool() {
  const now = Date.now()
  for (const [id, p] of pool) {
    if (p.busy === 0 && now - p.lastUsed > POOL_IDLE_MS) {
      pool.delete(id)
      void Promise.race([p.client.logout(), new Promise((r) => setTimeout(r, 1_500))]).catch(() => undefined).finally(() => p.client.close())
    }
  }
}

const sweeper = globalThis as unknown as { __wsxMailSweeper?: NodeJS.Timeout }
if (!sweeper.__wsxMailSweeper) sweeper.__wsxMailSweeper = setInterval(sweepPool, 15_000).unref()

function makeClient(acc: MailAccount): ImapFlow {
  const { host, port, security } = acc.imap!
  return new ImapFlow({
    host,
    port,
    secure: security === 'ssl',
    doSTARTTLS: security === 'starttls' ? true : security === 'none' ? false : undefined,
    auth: { user: acc.user, pass: decryptSecret(acc.passwordEnc) },
    tls: { servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !isLoopback(host) && !acc.bridge },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
  })
}

async function acquire(acc: MailAccount): Promise<Pooled> {
  const fp = fingerprint(acc)
  let p = pool.get(acc.id)
  if (p && (p.fp !== fp || (!p.connecting && !p.client.usable))) {
    dropPooled(acc.id, p)
    p = undefined
  }
  if (!p) {
    const client = makeClient(acc)
    const fresh: Pooled = { client, fp, busy: 0, lastUsed: Date.now(), connecting: null, queue: Promise.resolve(), folders: null }
    client.on('error', () => dropPooled(acc.id, fresh))
    client.on('close', () => dropPooled(acc.id, fresh))
    fresh.connecting = client.connect().finally(() => {
      fresh.connecting = null
    })
    pool.set(acc.id, fresh)
    p = fresh
  }
  if (p.connecting) {
    try {
      await p.connecting
    } catch (e) {
      dropPooled(acc.id, p)
      throw classifyImap(e, acc)
    }
  }
  return p
}

export async function withImap<T>(acc: MailAccount, fn: (c: ImapFlow, p: Pooled) => Promise<T>): Promise<T> {
  try {
    return await runOnce(acc, fn)
  } catch (e) {
    /* Один повтор на сетевой сбой: соединение из пула могло умереть, свежий заход обычно проходит. */
    if (e instanceof MailError && (e.code === 'CONNECT_FAILED' || e.code === 'READ_FAILED') && !pool.has(acc.id)) return runOnce(acc, fn)
    throw e
  }
}

/** Операции на одном соединении идут строго по очереди: выбранная папка не «уезжает» под соседним запросом. */
async function runOnce<T>(acc: MailAccount, fn: (c: ImapFlow, p: Pooled) => Promise<T>): Promise<T> {
  if (!acc.imap) throw new MailError('NO_IMAP', 'У ящика не настроен IMAP — читать письма нельзя. Укажите сервер IMAP в настройках ящика.')
  const p = await acquire(acc)
  p.busy += 1
  const run = p.queue.then(() => fn(p.client, p))
  p.queue = run.catch(() => undefined)
  try {
    return await run
  } catch (e) {
    if (!p.client.usable) dropPooled(acc.id, p)
    throw classifyImap(e, acc)
  } finally {
    p.busy -= 1
    p.lastUsed = Date.now()
  }
}

/* ---------- преобразования ---------- */

const addr = (a?: MessageAddressObject | null): Addr | null => (a && a.address ? { name: a.name ?? '', address: a.address } : null)
const addrs = (list?: MessageAddressObject[] | null): Addr[] => (list ?? []).map(addr).filter((x): x is Addr => !!x)

function fromParsed(v?: AddressObject | AddressObject[]): Addr[] {
  const list = Array.isArray(v) ? v : v ? [v] : []
  return list.flatMap((o) => o.value.map((x) => ({ name: x.name ?? '', address: x.address ?? '' }))).filter((x) => x.address)
}

function hasAttachments(node?: MessageStructureObject): boolean {
  if (!node) return false
  if (node.childNodes?.length) return node.childNodes.some(hasAttachments)
  const type = (node.type ?? '').toLowerCase()
  if (node.disposition?.toLowerCase() === 'attachment') return true
  return !!type && !type.startsWith('text/') && !type.startsWith('multipart/')
}

function toRow(m: FetchMessageObject): MessageRow {
  const flags = m.flags ?? new Set<string>()
  const env = m.envelope
  const date = env?.date ?? m.internalDate
  return {
    uid: m.uid,
    seq: m.seq,
    subject: env?.subject ?? '',
    from: addr(env?.from?.[0]) ?? addr(env?.sender?.[0]),
    to: addrs(env?.to),
    date: date ? new Date(date).toISOString() : null,
    size: m.size ?? 0,
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    answered: flags.has('\\Answered'),
    hasAttachments: hasAttachments(m.bodyStructure),
  }
}

/* ---------- сценарии ---------- */

/** LIST + STATUS по всем папкам стоит дорого; при частом переключении папок отдаём результат из кэша соединения. */
const FOLDERS_TTL_MS = 8_000

const cloneFolders = (list: FolderView[]): FolderView[] => list.map((f) => ({ ...f }))

async function foldersOn(c: ImapFlow, acc: MailAccount, p?: Pooled): Promise<FolderView[]> {
  if (p?.folders && Date.now() - p.folders.at < FOLDERS_TTL_MS) return cloneFolders(p.folders.list)
  const raw = await c.list({ statusQuery: { messages: true, unseen: true } })
  const out: FolderView[] = raw
    .filter((f) => !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
    .map((f) => ({
      path: f.path,
      name: f.name,
      delimiter: f.delimiter,
      specialUse: f.specialUse ?? (f.path.toUpperCase() === 'INBOX' ? '\\Inbox' : null),
      total: f.status?.messages ?? null,
      unseen: f.status?.unseen ?? null,
    }))
  const sorted = sortFolders(out)
  const inbox = sorted.find((f) => f.path.toUpperCase() === 'INBOX')
  if (inbox) await noteImapSync(acc.id, { unseen: inbox.unseen ?? 0, total: inbox.total ?? 0 })
  if (p) p.folders = { at: Date.now(), list: cloneFolders(sorted) }
  return sorted
}

export async function listFolders(acc: MailAccount): Promise<FolderView[]> {
  return withImap(acc, (c, p) => foldersOn(c, acc, p))
}

export type MessagePage = { folder: string; total: number; rows: MessageRow[]; nextCursor: number | null; folders?: FolderView[] }

async function pageOn(c: ImapFlow, acc: MailAccount, folder: string, cursor: number | null, limit: number): Promise<MessagePage> {
  const lock = await c.getMailboxLock(folder, { readOnly: true })
  try {
    const total = c.mailbox && typeof c.mailbox === 'object' ? c.mailbox.exists : 0
    const { start, end, nextCursor } = pageRange(total, cursor, limit)
    if (end < 1) return { folder, total, rows: [], nextCursor: null }
    const msgs = await c.fetchAll(`${start}:${end}`, { uid: true, flags: true, envelope: true, size: true, bodyStructure: true })
    const rows = msgs.map(toRow).sort((a, b) => b.seq - a.seq)
    if (folder.toUpperCase() === 'INBOX') await noteImapSync(acc.id, { total })
    return { folder, total, rows, nextCursor }
  } finally {
    lock.release()
  }
}

/** Страница писем; с withFolders — в том же соединении и список папок (один логин на обновление). */
export async function listMessages(acc: MailAccount, folder: string, cursor: number | null, limit: number, withFolders = false): Promise<MessagePage> {
  return withImap(acc, async (c, p) => {
    const page = await pageOn(c, acc, folder, cursor, limit)
    if (!withFolders) return page
    const folders = await foldersOn(c, acc, p)
    /* Счётчик STATUS у некоторых серверов запаздывает: для полностью загруженной папки считаем по строкам. */
    if (page.nextCursor === null) {
      const unseen = page.rows.filter((r) => !r.seen).length
      for (const f of folders) if (f.path === folder) f.unseen = unseen
    }
    return { ...page, folders }
  })
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const ch of stream) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch))
  return Buffer.concat(chunks)
}

export async function getMessage(acc: MailAccount, folder: string, uid: number, markSeen: boolean): Promise<MessageFull> {
  return withImap(acc, async (c, p) => {
    const lock = await c.getMailboxLock(folder, { readOnly: !markSeen })
    try {
      const meta = await c.fetchOne(String(uid), { uid: true, flags: true, size: true, envelope: true }, { uid: true })
      if (!meta) throw new MailError('NOT_FOUND', 'Письмо не найдено: возможно, оно перемещено или удалено.')
      const dl = await c.download(String(uid), undefined, { uid: true, maxBytes: MAX_MESSAGE_BYTES })
      if (!dl?.content) throw new MailError('NOT_FOUND', 'Письмо не найдено: возможно, оно перемещено или удалено.')
      const buf = await readAll(dl.content)
      const parsed = await simpleParser(buf, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })
      let flags = meta.flags ?? new Set<string>()
      if (markSeen && !flags.has('\\Seen')) {
        await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
        flags = new Set([...flags, '\\Seen'])
        p.folders = null /* счётчик непрочитанных изменился */
      }
      const date = parsed.date ?? meta.envelope?.date ?? meta.internalDate
      const html = typeof parsed.html === 'string' && parsed.html ? sanitizeMailHtml(parsed.html) : null
      return {
        uid,
        folder,
        subject: parsed.subject ?? meta.envelope?.subject ?? '',
        from: fromParsed(parsed.from)[0] ?? addr(meta.envelope?.from?.[0]),
        to: fromParsed(parsed.to),
        cc: fromParsed(parsed.cc),
        replyTo: fromParsed(parsed.replyTo),
        date: date ? new Date(date).toISOString() : null,
        size: meta.size ?? buf.length,
        seen: flags.has('\\Seen'),
        flagged: flags.has('\\Flagged'),
        answered: flags.has('\\Answered'),
        html,
        text: html ? null : parsed.text ?? '',
        attachments: parsed.attachments.map((a) => ({
          filename: a.filename ?? 'без имени',
          contentType: a.contentType,
          size: a.size,
          cid: a.cid ?? null,
          inline: a.contentDisposition === 'inline' || (!!a.cid && !!a.related),
        })),
        truncated: (meta.size ?? 0) > MAX_MESSAGE_BYTES,
      }
    } finally {
      lock.release()
    }
  })
}

export type FlagPatch = { seen?: boolean; flagged?: boolean }

export async function setFlags(acc: MailAccount, folder: string, uid: number, patch: FlagPatch): Promise<{ uid: number; seen: boolean; flagged: boolean }> {
  return withImap(acc, async (c, p) => {
    const lock = await c.getMailboxLock(folder)
    try {
      const add: string[] = []
      const remove: string[] = []
      if (patch.seen === true) add.push('\\Seen')
      if (patch.seen === false) remove.push('\\Seen')
      if (patch.flagged === true) add.push('\\Flagged')
      if (patch.flagged === false) remove.push('\\Flagged')
      if (add.length) await c.messageFlagsAdd(String(uid), add, { uid: true })
      if (remove.length) await c.messageFlagsRemove(String(uid), remove, { uid: true })
      if (patch.seen !== undefined) p.folders = null /* счётчик непрочитанных изменился */
      const m = await c.fetchOne(String(uid), { uid: true, flags: true }, { uid: true })
      if (!m) throw new MailError('NOT_FOUND', 'Письмо не найдено: возможно, оно перемещено или удалено.')
      const flags = m.flags ?? new Set<string>()
      return { uid, seen: flags.has('\\Seen'), flagged: flags.has('\\Flagged') }
    } finally {
      lock.release()
    }
  })
}
