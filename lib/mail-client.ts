/* ПОЧТА · клиентская обёртка над /ai-api/mail. Пароль уходит только в POST/PUT и никогда не возвращается. */

import type { AuthHint, Endpoint, MailConfig } from './mail-providers'

export type { AuthHint, Endpoint, MailConfig }

export type CheckState = 'ok' | 'fail' | 'unknown'

export type AccountView = {
  id: string
  name: string
  email: string
  provider: string | null
  smtp: Endpoint
  imap: Endpoint | null
  user: string
  bridge?: boolean
  discovery: { source: string; at: number }
  status: { smtp: CheckState; imap: CheckState; checkedAt: number; error?: string }
  imapSync?: { at: number; unseen: number; total: number }
  createdAt: number
  sentCount: number
  lastSentAt: number | null
}

export type Addr = { name: string; address: string }

export type FolderView = { path: string; name: string; delimiter: string; specialUse: string | null; total: number | null; unseen: number | null }

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

export type MessageFull = Omit<MessageRow, 'seq' | 'hasAttachments'> & {
  folder: string
  cc: Addr[]
  replyTo: Addr[]
  html: string | null
  text: string | null
  attachments: AttachmentView[]
  truncated: boolean
}

export type MessagePage = { folder: string; total: number; rows: MessageRow[]; nextCursor: number | null; syncedAt: number; folders?: FolderView[] }

export type Candidate = { source: string; confidence: number; providerId: string | null; config: MailConfig; user?: string }

export type Discovery = {
  email: string
  domain: string
  provider: { id: string; name: string } | null
  hint: AuthHint
  candidates: Candidate[]
  bridge?: { reachable: boolean; smtp: boolean; imap: boolean; serverHost: string }
  alt?: { id: string; label: string; config: MailConfig; hint: AuthHint }
  ms: number
}

export type Checks = { smtp: CheckState; imap: CheckState; error?: string; code?: string; hint?: AuthHint }

export type ClientConfig = MailConfig & { bridge?: boolean }

export type ApiFail = { ok: false; code: string; error: string; hint?: AuthHint; checks?: Checks; candidate?: MailConfig; retryAfter?: number }

export type CreateOk = { ok: true; account: AccountView; checks: Checks; source: string }

export const SOURCE_LABEL: Record<string, string> = {
  builtin: 'встроенный',
  ispdb: 'база Thunderbird',
  autoconfig: 'autoconfig домена',
  srv: 'DNS SRV',
  mx: 'по MX-записи',
  autodiscover: 'Autodiscover',
  guess: 'подбор хостов',
  manual: 'вручную',
}

async function call<T>(url: string, init?: RequestInit): Promise<T | ApiFail> {
  try {
    const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>
    if (!r.ok) {
      return {
        ok: false,
        code: String(data.code ?? 'UNKNOWN'),
        error: String(data.error ?? 'Сервер не ответил.'),
        hint: data.hint as AuthHint | undefined,
        checks: data.checks as Checks | undefined,
        candidate: data.candidate as MailConfig | undefined,
        retryAfter: typeof data.retryAfter === 'number' ? data.retryAfter : undefined,
      }
    }
    return data as T
  } catch {
    return { ok: false, code: 'NETWORK', error: 'Нет связи с сервером.' }
  }
}

export const isFail = (r: unknown): r is ApiFail => !!r && typeof r === 'object' && (r as ApiFail).ok === false

export type Attachment = { name: string; type: string; dataBase64: string; size: number }

export const mailApi = {
  discover: (email: string) => call<Discovery>('/ai-api/mail/discover', { method: 'POST', body: JSON.stringify({ email }) }),
  list: () => call<{ enabled: boolean; accounts: AccountView[] }>('/ai-api/mail/accounts'),
  create: (body: { name: string; email: string; password: string; user?: string; config?: ClientConfig | null; source?: string }) =>
    call<CreateOk>('/ai-api/mail/accounts', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ name: string; user: string; password: string; config: ClientConfig }>) =>
    call<{ account: AccountView; checks: Checks }>(`/ai-api/mail/accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => call<{ ok: true }>(`/ai-api/mail/accounts/${id}`, { method: 'DELETE' }),
  test: (id: string) => call<{ account: AccountView; checks: Checks }>(`/ai-api/mail/accounts/${id}/test`, { method: 'POST' }),
  send: (id: string, body: { to: string; cc?: string; subject: string; text: string; attachments?: Omit<Attachment, 'size'>[] }) =>
    call<{ ok: true; messageId: string; account: AccountView; recipients: number }>(`/ai-api/mail/accounts/${id}/send`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  folders: (id: string) => call<{ folders: FolderView[]; syncedAt: number }>(`/ai-api/mail/accounts/${id}/folders`),
  messages: (id: string, folder: string, cursor: number | null = null, opts: { limit?: number; withFolders?: boolean } = {}) => {
    const q = new URLSearchParams({ folder, limit: String(opts.limit ?? 30) })
    if (cursor) q.set('cursor', String(cursor))
    if (opts.withFolders) q.set('withFolders', '1')
    return call<MessagePage>(`/ai-api/mail/accounts/${id}/messages?${q}`)
  },
  message: (id: string, folder: string, uid: number) =>
    call<{ message: MessageFull }>(`/ai-api/mail/accounts/${id}/messages/${uid}?${new URLSearchParams({ folder })}`),
  flags: (id: string, folder: string, uid: number, patch: { seen?: boolean; flagged?: boolean }) =>
    call<{ ok: true; uid: number; seen: boolean; flagged: boolean }>(`/ai-api/mail/accounts/${id}/messages/${uid}/flags`, {
      method: 'POST',
      body: JSON.stringify({ folder, ...patch }),
    }),
}

export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(fr.error)
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
    fr.readAsDataURL(file)
  })
}
