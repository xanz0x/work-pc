/* ============================================================
   ВРЕМЕННАЯ ПОЧТА · генераторы одноразовых ящиков
   Провайдеры:
   • mailtm  — api.mail.tm, бесплатно и без ключа (нестандартный домен). Аккаунт создаётся
     на нашей стороне, пароль и токен лежат зашифрованными (AES-GCM, MAIL_SECRET).
   • temp / gmail / outlook — SmailPro через Sonjj (app.sonjj.com, заголовок X-Api-Key,
     переменная SONJJ_API_KEY). Только приём писем: отправлять с таких адресов нельзя.
   Ящики хранятся в temp.json каталога пользователя; тела писем не кэшируются.
   ============================================================ */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { decryptSecret, encryptSecret } from './mail-crypto'
import { sanitizeMailHtml } from './mail-html'
import { requireUser } from './request-context'
import { MID_RE, mtRows, sortRows, spRows, type TempRow } from './temp-mail-parse'

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')
import { userDir } from './users-server'

export type TempKind = 'mailtm' | 'temp' | 'gmail' | 'outlook'

export const TEMP_KINDS: TempKind[] = ['mailtm', 'gmail', 'outlook']

export const TEMP_LABEL: Record<TempKind, string> = {
  mailtm: 'Обычная · бесплатно',
  temp: 'Обычная',
  gmail: 'Gmail',
  outlook: 'Hotmail/Outlook',
}

/** Срок обычного временного ящика по умолчанию и шаг продления. */
export const TEMP_MINUTES = 10

export type TempBox = {
  id: string
  kind: TempKind
  address: string
  createdAt: number
  /** Когда адрес перестанет принимать письма (у пула Gmail/Outlook срока нет). */
  expiresAt: number | null
  /** mail.tm: id аккаунта для удаления. */
  accountId?: string
  /** mail.tm: {password, token} в AES-GCM. */
  secretEnc?: string
  /** SmailPro Gmail/Outlook: с какого времени показывать письма. */
  timestamp?: number
  lastSyncAt: number | null
  count: number
}

export type TempBoxView = Omit<TempBox, 'secretEnc' | 'accountId'>

export type { TempRow }
export type TempFull = { mid: string; subject: string; from: string; date: string | null; html: string | null; text: string | null }

export type TempErrorCode = 'NO_KEY' | 'PROVIDER' | 'NOT_FOUND' | 'INVALID_ARGS' | 'RATE_LIMITED' | 'NOT_SUPPORTED'

export class TempError extends Error {
  constructor(
    public code: TempErrorCode,
    message: string,
    public retryAfter?: number,
  ) {
    super(message)
  }
}

/* ---------- хранение ---------- */

const file = () => {
  const u = requireUser()
  return path.join(userDir(u.uid, u.legacy), 'mail', 'temp.json')
}

async function readAll(): Promise<TempBox[]> {
  try {
    const list = JSON.parse(await fs.readFile(file(), 'utf8'))
    return Array.isArray(list) ? (list as TempBox[]) : []
  } catch {
    return []
  }
}

async function writeAll(list: TempBox[]): Promise<void> {
  const p = file()
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, p)
}

export const toTempView = (b: TempBox): TempBoxView => {
  const { secretEnc: _s, accountId: _a, ...rest } = b
  void _s
  void _a
  return rest
}

async function upsert(box: TempBox): Promise<void> {
  const list = await readAll()
  const i = list.findIndex((b) => b.id === box.id)
  if (i < 0) list.push(box)
  else list[i] = box
  await writeAll(list)
}

export async function listTempBoxes(): Promise<TempBoxView[]> {
  return (await readAll()).map(toTempView)
}

async function getBox(id: string): Promise<TempBox> {
  const box = (await readAll()).find((b) => b.id === id)
  if (!box) throw new TempError('NOT_FOUND', 'Временный ящик не найден.')
  return box
}

/* ---------- сеть ---------- */

const MT = 'https://api.mail.tm'
const SONJJ = 'https://app.sonjj.com'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function jsonFetch(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown; retryAfter?: number }> {
  let r: Response
  try {
    r = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new TempError('PROVIDER', 'Сервис временной почты не отвечает.')
  }
  const text = await r.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  const ra = Number(r.headers.get('retry-after'))
  return { status: r.status, body, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined }
}

function sonjjKey(): string {
  const k = process.env.SONJJ_API_KEY?.trim()
  if (!k) {
    throw new TempError('NO_KEY', 'Генераторы SmailPro выключены: на сервере не задан SONJJ_API_KEY (ключ из my.sonjj.com). Бесплатный генератор «Обычная · бесплатно» работает без ключа.')
  }
  return k
}

async function sonjj(pathname: string, params: Record<string, string>): Promise<unknown> {
  const q = new URLSearchParams(params)
  const { status, body, retryAfter } = await jsonFetch(`${SONJJ}${pathname}?${q}`, { headers: { 'X-Api-Key': sonjjKey(), accept: 'application/json' } })
  if (status === 200) return body
  if (status === 401 || status === 403) throw new TempError('NO_KEY', 'SmailPro отклонил ключ SONJJ_API_KEY: проверьте ключ в my.sonjj.com.')
  if (status === 402) throw new TempError('NO_KEY', 'На счёте Sonjj закончились кредиты — пополните баланс в my.sonjj.com.')
  if (status === 404) throw new TempError('NOT_FOUND', 'Адрес или письмо у SmailPro не найдены: возможно, срок ящика истёк.')
  if (status === 429) throw new TempError('RATE_LIMITED', 'SmailPro просит подождать: слишком много запросов.', retryAfter ?? 30)
  throw new TempError('PROVIDER', `SmailPro вернул ошибку ${status}.`)
}

/* ---------- mail.tm ---------- */

type MtSecret = { password: string; token: string }

/** Ящик, зашифрованный прежним MAIL_SECRET, расшифровать нельзя: честно просим создать новый. */
const mtSecret = (box: TempBox): MtSecret => {
  try {
    return JSON.parse(decryptSecret(box.secretEnc ?? '')) as MtSecret
  } catch {
    throw new TempError('NOT_SUPPORTED', 'Доступ к этому ящику потерян: он был создан с другим ключом MAIL_SECRET. Удалите его и создайте новый бесплатный адрес.')
  }
}

/**
 * Логин в mail.tm по адресу и паролю. Ошибки — человекочитаемые и с кодом:
 * 429 (жёсткий лимит 8 QPS) отдаётся как RATE_LIMITED с retryAfter,
 * 401/403 — отдельный текст «логин не принят», остальное — PROVIDER со статусом.
 */
async function mtToken(address: string, password: string): Promise<string> {
  const { status, body, retryAfter } = await jsonFetch(`${MT}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password }) })
  const token = (body as { token?: string } | null)?.token
  if (status === 429)
    throw new TempError('RATE_LIMITED', 'mail.tm ограничил частоту запросов (лимит 8 в секунду): попробуйте ещё раз через несколько секунд.', retryAfter ?? 10)
  if (status === 401 || status === 403)
    throw new TempError('PROVIDER', `mail.tm не принял логин и пароль ящика (ошибка ${status}): возможно, адрес уже удалён — создайте новый.`)
  if (status >= 400 || !token)
    throw new TempError('PROVIDER', `mail.tm не выдал доступ к ящику (ошибка ${status}${token ? '' : ': токен в ответе не пришёл'}).`)
  return token
}

/** Токен mail.tm живёт недолго: при 401 берём новый по сохранённым логину и паролю. */
async function mtCall(box: TempBox, pathname: string, init: RequestInit = {}): Promise<unknown> {
  const s = mtSecret(box)
  const run = (token: string) => jsonFetch(`${MT}${pathname}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } })
  let r = await run(s.token)
  if (r.status === 401) {
    /* Токен живёт недолго: перевход по сохранённым логину и паролю,
       свежий токен сразу возвращаем в зашифрованное хранилище. */
    const token = await mtToken(box.address, s.password)
    box.secretEnc = encryptSecret(JSON.stringify({ password: s.password, token }))
    await upsert(box)
    r = await run(token)
    if (r.status === 401)
      throw new TempError('PROVIDER', 'mail.tm больше не принимает сохранённый пароль этого ящика (401): доступ к адресу потерян — создайте новый бесплатный адрес.')
  }
  if (r.status === 429) throw new TempError('RATE_LIMITED', 'mail.tm просит подождать: слишком много запросов (лимит 8 в секунду).', r.retryAfter ?? 10)
  if (r.status === 404) throw new TempError('NOT_FOUND', 'Письмо не найдено: mail.tm мог удалить его вместе с ящиком.')
  if (r.status >= 400) throw new TempError('PROVIDER', `mail.tm вернул ошибку ${r.status}.`)
  return r.body
}

async function mtCreate(): Promise<TempBox> {
  const dm = await jsonFetch(`${MT}/domains`)
  if (dm.status === 429)
    throw new TempError('RATE_LIMITED', 'mail.tm ограничил частоту запросов: попробуйте создать ящик через несколько секунд.', dm.retryAfter ?? 10)
  if (dm.status >= 400)
    throw new TempError('PROVIDER', `mail.tm не отдал список доменов (ошибка ${dm.status}).`)
  const list = (Array.isArray(dm.body) ? dm.body : ((dm.body as { 'hydra:member'?: unknown[] } | null)?.['hydra:member'] ?? [])) as { domain?: string; isActive?: boolean }[]
  const domain = list.find((x) => x.isActive && x.domain)?.domain ?? list.find((x) => x.domain)?.domain
  if (!domain) throw new TempError('PROVIDER', 'mail.tm не отдал ни одного рабочего домена.')
  const password = randomBytes(18).toString('base64url')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const address = `${randomBytes(6).toString('hex')}@${domain}`
    const { status, body, retryAfter } = await jsonFetch(`${MT}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password }) })
    if (status === 429)
      throw new TempError('RATE_LIMITED', 'mail.tm ограничил частоту запросов при создании ящика: попробуйте через несколько секунд.', retryAfter ?? 10)
    if (status === 422 || status === 409) continue
    if (status >= 400) throw new TempError('PROVIDER', `mail.tm не создал ящик (ошибка ${status}).`)
    const accountId = String((body as { id?: string } | null)?.id ?? '')
    /* Аккаунт создаётся мгновенно, но первый логин сразу после POST /accounts
       иногда падает с 401 — аккаунт ещё не активирован на стороне mail.tm.
       Повторяем вход с паузами, прежде чем честно признать поражение. */
    let token: string | null = null
    let lastErr: TempError | null = null
    for (let login = 0; login < 3 && token === null; login += 1) {
      if (login > 0) await sleep(login === 1 ? 300 : 800)
      try {
        token = await mtToken(address, password)
      } catch (e) {
        if (e instanceof TempError && e.code === 'RATE_LIMITED') throw e
        lastErr = e instanceof TempError ? e : new TempError('PROVIDER', 'mail.tm не выдал доступ к ящику.')
      }
    }
    if (token === null)
      throw lastErr ?? new TempError('PROVIDER', 'mail.tm не выдал доступ к ящику сразу после его создания.')
    return {
      id: randomBytes(4).toString('hex'),
      kind: 'mailtm',
      address,
      accountId,
      secretEnc: encryptSecret(JSON.stringify({ password, token })),
      createdAt: Date.now(),
      expiresAt: null,
      lastSyncAt: null,
      count: 0,
    }
  }
  throw new TempError('PROVIDER', 'mail.tm занял все предложенные адреса — попробуйте ещё раз.')
}

/* ---------- SmailPro ---------- */

const spInboxPath: Record<Exclude<TempKind, 'mailtm'>, string> = {
  temp: '/v1/temp_email/inbox',
  gmail: '/v1/temp_gmail/inbox',
  outlook: '/v1/temp_outlook/inbox',
}

const spMessagePath: Record<Exclude<TempKind, 'mailtm'>, string> = {
  temp: '/v1/temp_email/message',
  gmail: '/v1/temp_gmail/message',
  outlook: '/v1/temp_outlook/message',
}

async function spCreateTemp(minutes: number): Promise<TempBox> {
  const d = (await sonjj('/v1/temp_email/domains', {})) as { domains?: string[] } | null
  const domain = d?.domains?.[0]
  if (!domain) throw new TempError('PROVIDER', 'SmailPro не отдал ни одного домена.')
  const address = `${randomBytes(5).toString('hex')}@${domain}`
  await sonjj('/v1/temp_email/create', { email: address, expiry_minutes: String(minutes) })
  return { id: randomBytes(4).toString('hex'), kind: 'temp', address, createdAt: Date.now(), expiresAt: Date.now() + minutes * 60_000, lastSyncAt: null, count: 0 }
}

async function spRandom(kind: 'gmail' | 'outlook'): Promise<TempBox> {
  const r = (await sonjj(kind === 'gmail' ? '/v1/temp_gmail/random' : '/v1/temp_outlook/random', { type: 'alias' })) as { email?: string; timestamp?: number } | null
  const address = r?.email
  if (!address) throw new TempError('PROVIDER', 'SmailPro не выдал адрес из пула.')
  return {
    id: randomBytes(4).toString('hex'),
    kind,
    address,
    timestamp: Number(r?.timestamp) || Math.floor(Date.now() / 1000),
    createdAt: Date.now(),
    expiresAt: null,
    lastSyncAt: null,
    count: 0,
  }
}

/* ---------- сценарии ---------- */

export async function createTempBox(kind: TempKind): Promise<TempBoxView> {
  const box = kind === 'mailtm' ? await mtCreate() : kind === 'temp' ? await spCreateTemp(TEMP_MINUTES) : await spRandom(kind)
  await upsert(box)
  return toTempView(box)
}

/** Продлить можно только обычный ящик SmailPro: у mail.tm срока нет, пул Gmail/Outlook живёт сам. */
export async function extendTempBox(id: string, minutes = TEMP_MINUTES): Promise<TempBoxView> {
  const box = await getBox(id)
  if (box.kind !== 'temp') throw new TempError('NOT_SUPPORTED', 'Этот ящик продлевать не нужно: у него нет срока.')
  await sonjj('/v1/temp_email/create', { email: box.address, expiry_minutes: String(minutes) })
  box.expiresAt = Math.max(Date.now(), box.expiresAt ?? 0) + minutes * 60_000
  await upsert(box)
  return toTempView(box)
}

export async function removeTempBox(id: string): Promise<boolean> {
  const list = await readAll()
  const box = list.find((b) => b.id === id)
  if (!box) return false
  await writeAll(list.filter((b) => b.id !== id))
  /* Ящик у провайдера закрываем следом: локальная запись уже удалена, чтобы кнопка не «залипала». */
  try {
    if (box.kind === 'mailtm' && box.accountId) await mtCall(box, `/accounts/${encodeURIComponent(box.accountId)}`, { method: 'DELETE' })
    if (box.kind === 'temp') await sonjj('/v1/temp_email/create', { email: box.address, expiry_minutes: '-1' })
  } catch {
    /* провайдер сам закроет по сроку */
  }
  return true
}

export async function tempInbox(id: string): Promise<{ box: TempBoxView; rows: TempRow[] }> {
  const box = await getBox(id)
  let rows: TempRow[]
  if (box.kind === 'mailtm') rows = mtRows(await mtCall(box, '/messages'))
  else if (box.kind === 'temp') rows = spRows(await sonjj(spInboxPath.temp, { email: box.address }))
  else rows = spRows(await sonjj(spInboxPath[box.kind], { email: box.address, timestamp: String(box.timestamp ?? 0) }))
  rows = sortRows(rows)
  box.lastSyncAt = Date.now()
  box.count = rows.length
  await upsert(box)
  return { box: toTempView(box), rows }
}

export async function tempMessage(id: string, mid: string): Promise<TempFull> {
  if (!MID_RE.test(mid)) throw new TempError('INVALID_ARGS', 'Идентификатор письма указан неверно.')
  const box = await getBox(id)
  if (box.kind === 'mailtm') {
    const m = (await mtCall(box, `/messages/${encodeURIComponent(mid)}`)) as { subject?: string; from?: { address?: string; name?: string }; createdAt?: string; text?: string; html?: string[] } | null
    const html = Array.isArray(m?.html) ? m?.html.join('\n') : ''
    return {
      mid,
      subject: asStr(m?.subject),
      from: asStr(m?.from?.name).trim() || asStr(m?.from?.address) || '—',
      date: m?.createdAt ? new Date(m.createdAt).toISOString() : null,
      html: html ? sanitizeMailHtml(html) : null,
      text: html ? null : asStr(m?.text),
    }
  }
  const row = (await tempInbox(id)).rows.find((r) => r.mid === mid) ?? null
  const m = (await sonjj(spMessagePath[box.kind], { email: box.address, mid })) as { body?: string } | null
  const body = asStr(m?.body)
  const looksHtml = /<[a-z!/]/i.test(body)
  return {
    mid,
    subject: row?.subject ?? '',
    from: row?.from ?? '—',
    date: row?.date ?? null,
    html: looksHtml ? sanitizeMailHtml(body) : null,
    text: looksHtml ? null : body,
  }
}

export const sonjjConfigured = (): boolean => (process.env.SONJJ_API_KEY?.trim().length ?? 0) > 0
