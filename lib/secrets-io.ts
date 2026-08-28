/* ============================================================
   ИМПОРТ / ЭКСПОРТ · CSV (KeePassXC, Bitwarden, 1Password, LastPass)
   и Bitwarden JSON. Валидация руками (zero-dependency): лимит размера,
   лимит числа записей, whitelist полей — структуре файла не доверяем.
   ============================================================ */

import { TYPE_META, type FieldKind, type SecretType } from './secrets'
import { base32Decode, parseOtpauth } from './secrets-totp'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ENTRIES = 5000

export type DraftField = { name: string; kind: FieldKind; value: string; secret: boolean }
export type ImportDraft = {
  title: string
  type: SecretType
  tags: string[]
  folderName: string | null
  fields: DraftField[]
  totpSecret: string | null
  favorite: boolean
}

export type ImportPreview = {
  source: string
  total: number
  byType: Record<string, number>
  withTotp: number
  skipped: number
  drafts: ImportDraft[]
  errors: string[]
}

/* ---------- CSV ---------- */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Универсальная карта заголовков экспортов популярных менеджеров. */
const H = {
  title: ['name', 'title', 'account', 'item name', 'login_title', 'display name'],
  username: ['username', 'login_username', 'user name', 'login name', 'email', 'user'],
  password: ['password', 'login_password', 'pass'],
  url: ['url', 'login_uri', 'uri', 'website', 'urls', 'login_url'],
  notes: ['notes', 'note', 'comment', 'comments'],
  totp: ['totp', 'login_totp', 'otpauth', 'authenticator key', 'otp'],
  folder: ['folder', 'group', 'grouping', 'collection', 'path'],
  favorite: ['favorite', 'fav'],
  card: ['card number', 'number', 'cardnumber'],
  cvv: ['cvv', 'card_code', 'verification number', 'cvc'],
  expiry: ['expiry', 'exp date', 'expiration', 'card_expiry'],
}

function indexOfHeader(header: string[], names: string[]): number {
  return header.findIndex((h) => names.includes(h.trim().toLowerCase()))
}

export function importCsv(text: string, sourceName: string): ImportPreview {
  const errors: string[] = []
  const rows = parseCsv(text)
  if (rows.length < 2) {
    return emptyPreview(sourceName, ['В файле нет строк с данными'])
  }
  const header = rows[0]
  const idx = {
    title: indexOfHeader(header, H.title),
    username: indexOfHeader(header, H.username),
    password: indexOfHeader(header, H.password),
    url: indexOfHeader(header, H.url),
    notes: indexOfHeader(header, H.notes),
    totp: indexOfHeader(header, H.totp),
    folder: indexOfHeader(header, H.folder),
    favorite: indexOfHeader(header, H.favorite),
    card: indexOfHeader(header, H.card),
    cvv: indexOfHeader(header, H.cvv),
    expiry: indexOfHeader(header, H.expiry),
  }
  if (idx.title < 0 && idx.username < 0 && idx.password < 0) {
    return emptyPreview(sourceName, [
      'Не найдены колонки name/username/password — это не похоже на экспорт менеджера паролей',
    ])
  }

  const drafts: ImportDraft[] = []
  let skipped = 0
  for (const row of rows.slice(1)) {
    if (drafts.length >= MAX_IMPORT_ENTRIES) {
      errors.push(`Лимит ${MAX_IMPORT_ENTRIES} записей — остальные строки пропущены`)
      break
    }
    const cell = (i: number) => (i >= 0 && i < row.length ? row[i].trim() : '')
    const title = cell(idx.title) || cell(idx.url) || cell(idx.username)
    if (!title) {
      skipped++
      continue
    }
    const cardNumber = cell(idx.card)
    const isCard = cardNumber !== '' && cell(idx.password) === ''
    const fields: DraftField[] = []
    if (isCard) {
      fields.push({ name: 'Номер', kind: 'secret', value: cardNumber, secret: true })
      if (cell(idx.expiry)) fields.push({ name: 'Срок', kind: 'text', value: cell(idx.expiry), secret: false })
      if (cell(idx.cvv)) fields.push({ name: 'CVV', kind: 'secret', value: cell(idx.cvv), secret: true })
    } else {
      if (cell(idx.url)) fields.push({ name: 'Сайт', kind: 'url', value: cell(idx.url).split('\n')[0], secret: false })
      if (cell(idx.username)) fields.push({ name: 'Логин', kind: 'text', value: cell(idx.username), secret: false })
      if (cell(idx.password))
        fields.push({ name: 'Пароль', kind: 'password', value: cell(idx.password), secret: true })
    }
    if (cell(idx.notes)) fields.push({ name: 'Заметки', kind: 'multiline', value: cell(idx.notes), secret: false })

    drafts.push({
      title: title.slice(0, 200),
      type: isCard ? 'card' : 'login',
      tags: [],
      folderName: cell(idx.folder) || null,
      fields,
      totpSecret: normalizeTotp(cell(idx.totp)),
      favorite: /^(1|true|yes)$/i.test(cell(idx.favorite)),
    })
  }

  return buildPreview(sourceName, drafts, skipped, errors)
}

function normalizeTotp(raw: string): string | null {
  if (!raw) return null
  const parsed = parseOtpauth(raw)
  if (parsed) return parsed.secret
  const cleaned = raw.replace(/\s+/g, '').toUpperCase()
  return base32Decode(cleaned) ? cleaned : null
}

/* ---------- Bitwarden JSON ---------- */

type BwItem = {
  name?: unknown
  type?: unknown
  favorite?: unknown
  notes?: unknown
  folderId?: unknown
  login?: { username?: unknown; password?: unknown; totp?: unknown; uris?: unknown }
  card?: { cardholderName?: unknown; number?: unknown; code?: unknown; expMonth?: unknown; expYear?: unknown }
  fields?: unknown
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '')

export function importBitwardenJson(text: string, sourceName: string): ImportPreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return emptyPreview(sourceName, ['Файл не является корректным JSON'])
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyPreview(sourceName, ['Пустой JSON'])
  const box = parsed as { items?: unknown; folders?: unknown }
  if (!Array.isArray(box.items)) return emptyPreview(sourceName, ['В JSON нет массива items'])

  const folders = new Map<string, string>()
  if (Array.isArray(box.folders)) {
    for (const f of box.folders) {
      if (typeof f === 'object' && f !== null) {
        const rec = f as { id?: unknown; name?: unknown }
        if (typeof rec.id === 'string') folders.set(rec.id, str(rec.name))
      }
    }
  }

  const errors: string[] = []
  const drafts: ImportDraft[] = []
  let skipped = 0

  for (const raw of box.items) {
    if (drafts.length >= MAX_IMPORT_ENTRIES) {
      errors.push(`Лимит ${MAX_IMPORT_ENTRIES} записей — остальные пропущены`)
      break
    }
    if (typeof raw !== 'object' || raw === null) {
      skipped++
      continue
    }
    const item = raw as BwItem
    const title = str(item.name)
    if (!title) {
      skipped++
      continue
    }
    const kind = typeof item.type === 'number' ? item.type : 1
    const fields: DraftField[] = []
    let type: SecretType = 'note'
    let totpSecret: string | null = null

    if (kind === 3 && item.card) {
      type = 'card'
      if (str(item.card.cardholderName))
        fields.push({ name: 'Держатель', kind: 'text', value: str(item.card.cardholderName), secret: false })
      if (str(item.card.number))
        fields.push({ name: 'Номер', kind: 'secret', value: str(item.card.number), secret: true })
      const exp = [item.card.expMonth, item.card.expYear].filter(Boolean).join('/')
      if (exp) fields.push({ name: 'Срок', kind: 'text', value: exp, secret: false })
      if (str(item.card.code))
        fields.push({ name: 'CVV', kind: 'secret', value: str(item.card.code), secret: true })
    } else if (kind === 4) {
      type = 'identity'
    } else if (item.login) {
      type = 'login'
      const uris = Array.isArray(item.login.uris) ? item.login.uris : []
      const firstUri = uris.length > 0 && typeof uris[0] === 'object' && uris[0] !== null
        ? str((uris[0] as { uri?: unknown }).uri)
        : ''
      if (firstUri) fields.push({ name: 'Сайт', kind: 'url', value: firstUri, secret: false })
      if (str(item.login.username))
        fields.push({ name: 'Логин', kind: 'text', value: str(item.login.username), secret: false })
      if (str(item.login.password))
        fields.push({ name: 'Пароль', kind: 'password', value: str(item.login.password), secret: true })
      totpSecret = normalizeTotp(str(item.login.totp))
    }

    if (str(item.notes)) {
      fields.push({
        name: 'Заметки',
        kind: 'multiline',
        value: str(item.notes),
        secret: type === 'note',
      })
    }

    /* Свои поля Bitwarden — только whitelist: имя, значение, признак секретности. */
    if (Array.isArray(item.fields)) {
      for (const f of item.fields.slice(0, 40)) {
        if (typeof f !== 'object' || f === null) continue
        const rec = f as { name?: unknown; value?: unknown; type?: unknown }
        const name = str(rec.name)
        const value = str(rec.value)
        if (!name || !value) continue
        const hidden = rec.type === 1
        fields.push({
          name: name.slice(0, 60),
          kind: hidden ? 'secret' : 'text',
          value: value.slice(0, 5000),
          secret: hidden,
        })
      }
    }

    drafts.push({
      title: title.slice(0, 200),
      type,
      tags: [],
      folderName: typeof item.folderId === 'string' ? folders.get(item.folderId) ?? null : null,
      fields: fields.length > 0 ? fields : [{ name: 'Текст', kind: 'multiline', value: '', secret: true }],
      totpSecret,
      favorite: item.favorite === true,
    })
  }

  return buildPreview(sourceName, drafts, skipped, errors)
}

/** Наш собственный (расшифрованный) JSON-снимок — им же восстанавливаем бэкапы. */
export function importNativeJson(text: string, sourceName: string): ImportPreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return emptyPreview(sourceName, ['Файл не является корректным JSON'])
  }
  const box = parsed as { kind?: unknown; entries?: unknown }
  if (box.kind !== 'workflow-secrets-plain' || !Array.isArray(box.entries)) {
    return emptyPreview(sourceName, ['Это не снимок WorkfloW (kind ≠ workflow-secrets-plain)'])
  }
  const drafts: ImportDraft[] = []
  let skipped = 0
  for (const raw of box.entries) {
    if (typeof raw !== 'object' || raw === null) {
      skipped++
      continue
    }
    const e = raw as {
      title?: unknown
      type?: unknown
      tags?: unknown
      folderName?: unknown
      favorite?: unknown
      totpSecret?: unknown
      fields?: unknown
    }
    const title = str(e.title)
    const type = (typeof e.type === 'string' && e.type in TYPE_META ? e.type : 'custom') as SecretType
    if (!title) {
      skipped++
      continue
    }
    const fields: DraftField[] = Array.isArray(e.fields)
      ? e.fields.flatMap((f) => {
          if (typeof f !== 'object' || f === null) return []
          const rec = f as { name?: unknown; kind?: unknown; value?: unknown; secret?: unknown }
          if (!str(rec.name)) return []
          return [
            {
              name: str(rec.name).slice(0, 60),
              kind: (typeof rec.kind === 'string' ? rec.kind : 'text') as FieldKind,
              value: str(rec.value).slice(0, 20000),
              secret: rec.secret === true,
            },
          ]
        })
      : []
    drafts.push({
      title: title.slice(0, 200),
      type,
      tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : [],
      folderName: typeof e.folderName === 'string' ? e.folderName : null,
      fields,
      totpSecret: normalizeTotp(str(e.totpSecret)),
      favorite: e.favorite === true,
    })
  }
  return buildPreview(sourceName, drafts, skipped, [])
}

export function detectAndImport(text: string, fileName: string): ImportPreview {
  if (text.length > MAX_IMPORT_BYTES) {
    return emptyPreview(fileName, [`Файл больше ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} МБ`])
  }
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{')) {
    const native = importNativeJson(text, fileName)
    if (native.total > 0) return native
    return importBitwardenJson(text, fileName)
  }
  return importCsv(text, fileName)
}

function emptyPreview(source: string, errors: string[]): ImportPreview {
  return { source, total: 0, byType: {}, withTotp: 0, skipped: 0, drafts: [], errors }
}

function buildPreview(
  source: string,
  drafts: ImportDraft[],
  skipped: number,
  errors: string[],
): ImportPreview {
  const byType: Record<string, number> = {}
  let withTotp = 0
  for (const d of drafts) {
    const label = TYPE_META[d.type].label
    byType[label] = (byType[label] ?? 0) + 1
    if (d.totpSecret) withTotp++
  }
  return { source, total: drafts.length, byType, withTotp, skipped, drafts, errors }
}

/* ---------- экспорт ---------- */

export function toCsv(rows: string[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join(','),
    )
    .join('\n')
}

export function download(name: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
