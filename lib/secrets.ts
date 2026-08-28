/* ============================================================
   SECRETS v1 · модель данных менеджера секретов
   Формат хранилища всегда с полем version — миграции через
   migrateSecrets() (образец: migrateLockedNotes замка).
   Секретные значения полей лежат как `ct:iv` (lib/secrets-crypto).
   ============================================================ */

import type { IconId } from '@/components/icons'

export const SECRETS_KEY = 'wf.secrets.v1'
export const SECRETS_FOLDERS_KEY = 'wf.secrets.folders.v1'
export const SECRETS_SETTINGS_KEY = 'wf.secrets.settings.v1'
export const SECRETS_BACKUPS_KEY = 'wf.secrets.backups.v1'

export type SecretType =
  | 'login'
  | 'note'
  | 'card'
  | 'api'
  | 'ssh'
  | 'seed'
  | 'wifi'
  | 'license'
  | 'identity'
  | 'recovery'
  | 'passkey-meta'
  | 'custom'

export type FieldKind =
  | 'text'
  | 'password'
  | 'url'
  | 'email'
  | 'number'
  | 'date'
  | 'secret'
  | 'multiline'
  | 'boolean'
  | 'file'

export type SecretField = {
  id: string
  name: string
  kind: FieldKind
  /** Секретные значения хранятся в формате `ct:iv`, открытые — как есть. */
  value: string
  secret: boolean
}

export type TotpConfig = {
  /** Base32-секрет, хранится зашифрованным (`ct:iv`). */
  secret: string
  issuer: string
  account: string
  period: number
  digits: number
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
}

export type Attachment = { id: string; name: string; size: number; ct: string; iv: string }

export type HistoryEntry = { at: number; fieldId: string; fieldName: string; prevCt: string }

export type SecretRecord = {
  id: string
  version: 1
  type: SecretType
  title: string
  folderId: string | null
  tags: string[]
  favorite: boolean
  fields: SecretField[]
  totp?: TotpConfig | null
  attachments: Attachment[]
  icon?: { domain: string; b64: string } | null
  createdAt: number
  updatedAt: number
  history: HistoryEntry[]
  expiredAfter: number | null
  deletedAt: number | null
}

export type SecretFolder = { id: string; name: string; rgb: string }

export type SecretsFile = { version: 1; entries: SecretRecord[] }

export const EMPTY_SECRETS: SecretsFile = { version: 1, entries: [] }

/* ---------- настройки модуля ---------- */

export type ClipTarget = 'password' | 'totp' | 'cvv' | 'username' | 'other'

export type SecretsSettings = {
  clipboard: Record<ClipTarget, number>
  /** Загружать иконки сайтов (единственный сетевой вызов; наружу только домен). */
  favicons: boolean
  /** true — пользователь сам трогал тумблер favicons (иначе действует дефолт «вкл»). */
  faviconsSet?: boolean
  /** Исключать секреты из ИИ-чата. Выключить нельзя — защита жёсткая. */
  excludeFromAi: true
  revealSeconds: number
  autoBackup: boolean
}

export const DEFAULT_SECRETS_SETTINGS: SecretsSettings = {
  clipboard: { password: 10, totp: 5, cvv: 5, username: 30, other: 10 },
  favicons: true,
  excludeFromAi: true,
  revealSeconds: 8,
  autoBackup: true,
}

export const CLIP_CHOICES = [5, 10, 30, 60, 0] as const

/* ---------- шаблоны типов ---------- */

type Tpl = { name: string; kind: FieldKind; secret?: boolean }

export const TYPE_META: Record<
  SecretType,
  { label: string; icon: IconId; note: string; fields: Tpl[]; totp?: boolean }
> = {
  login: {
    label: 'Пароль',
    icon: 'key',
    note: 'Сайт, логин, пароль, TOTP',
    totp: true,
    fields: [
      { name: 'Сайт', kind: 'url' },
      { name: 'Логин', kind: 'text' },
      { name: 'Пароль', kind: 'password', secret: true },
      { name: 'Заметки', kind: 'multiline' },
    ],
  },
  note: {
    label: 'Заметка',
    icon: 'sticker',
    note: 'Защищённый текст без подсветки синтаксиса',
    fields: [{ name: 'Текст', kind: 'multiline', secret: true }],
  },
  card: {
    label: 'Карта',
    icon: 'card',
    note: 'Номер, срок, CVV, PIN',
    fields: [
      { name: 'Держатель', kind: 'text' },
      { name: 'Номер', kind: 'secret', secret: true },
      { name: 'Срок', kind: 'text' },
      { name: 'CVV', kind: 'secret', secret: true },
      { name: 'PIN', kind: 'secret', secret: true },
      { name: 'Банк', kind: 'text' },
    ],
  },
  api: {
    label: 'API-ключ',
    icon: 'chipAi',
    note: 'Провайдер, ключ, окружение, срок',
    fields: [
      { name: 'Провайдер', kind: 'text' },
      { name: 'Ключ', kind: 'secret', secret: true },
      { name: 'Окружение', kind: 'text' },
      { name: 'Endpoint', kind: 'url' },
    ],
  },
  ssh: {
    label: 'SSH',
    icon: 'terminal',
    note: 'Хост, пользователь, приватный ключ',
    fields: [
      { name: 'Хост', kind: 'text' },
      { name: 'Пользователь', kind: 'text' },
      { name: 'Порт', kind: 'number' },
      { name: 'Приватный ключ', kind: 'multiline', secret: true },
      { name: 'Публичный ключ', kind: 'multiline' },
      { name: 'Passphrase', kind: 'password', secret: true },
    ],
  },
  seed: {
    label: 'Seed-фраза',
    icon: 'seed',
    note: 'Сеть, адрес, seed, passphrase',
    fields: [
      { name: 'Сеть', kind: 'text' },
      { name: 'Адрес', kind: 'text' },
      { name: 'Seed', kind: 'multiline', secret: true },
      { name: 'Passphrase (25-е слово)', kind: 'password', secret: true },
      { name: 'Derivation path', kind: 'text' },
    ],
  },
  wifi: {
    label: 'Wi-Fi',
    icon: 'wifi',
    note: 'SSID, пароль, тип защиты',
    fields: [
      { name: 'SSID', kind: 'text' },
      { name: 'Пароль', kind: 'password', secret: true },
      { name: 'Защита', kind: 'text' },
    ],
  },
  license: {
    label: 'Лицензия',
    icon: 'docCheck',
    note: 'Продукт, ключ, покупка',
    fields: [
      { name: 'Продукт', kind: 'text' },
      { name: 'Ключ', kind: 'secret', secret: true },
      { name: 'Вендор', kind: 'text' },
      { name: 'Куплено', kind: 'date' },
    ],
  },
  identity: {
    label: 'Личные данные',
    icon: 'user',
    note: 'Документы, телефон, адрес',
    fields: [
      { name: 'Имя', kind: 'text' },
      { name: 'Дата рождения', kind: 'date' },
      { name: 'Телефон', kind: 'text' },
      { name: 'Документ', kind: 'secret', secret: true },
      { name: 'Адрес', kind: 'multiline' },
    ],
  },
  recovery: {
    label: 'Коды восстановления',
    icon: 'shield',
    note: 'Список одноразовых кодов',
    fields: [
      { name: 'Сервис', kind: 'text' },
      { name: 'Коды', kind: 'multiline', secret: true },
      { name: 'Использовано', kind: 'number' },
    ],
  },
  'passkey-meta': {
    label: 'Passkey (метаданные)',
    icon: 'fingerprint',
    note: 'Только метаданные: приватный материал остаётся в браузере',
    fields: [
      { name: 'Сайт', kind: 'url' },
      { name: 'Логин', kind: 'text' },
      { name: 'Relying party', kind: 'text' },
      { name: 'Заметки', kind: 'multiline' },
    ],
  },
  custom: {
    label: 'Своя запись',
    icon: 'sparkText',
    note: 'Конструктор полей: 10 видов, любое можно сделать секретным',
    fields: [{ name: 'Значение', kind: 'secret', secret: true }],
  },
}

export const TYPE_ORDER: SecretType[] = [
  'login',
  'api',
  'seed',
  'card',
  'ssh',
  'note',
  'recovery',
  'wifi',
  'license',
  'identity',
  'passkey-meta',
  'custom',
]

/** Стабильный тон иконки типа: запись без favicon узнаваема по цвету. */
export const TYPE_HUE: Record<SecretType, number> = {
  login: 152,
  api: 205,
  seed: 42,
  card: 262,
  ssh: 95,
  note: 25,
  recovery: 0,
  wifi: 190,
  license: 58,
  identity: 300,
  'passkey-meta': 170,
  custom: 330,
}

/** ДД.ММ.ГГГГ → timestamp полуночи локального времени; иначе null. */
export function parseRuDate(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  const y = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
    ? dt.getTime()
    : null
}

let seq = 0
export const sid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function blankRecord(type: SecretType, folderId: string | null = null): SecretRecord {
  const meta = TYPE_META[type]
  const at = Date.now()
  return {
    id: sid('sec'),
    version: 1,
    type,
    title: '',
    folderId,
    tags: [],
    favorite: false,
    fields: meta.fields.map((f) => ({
      id: sid('fld'),
      name: f.name,
      kind: f.kind,
      value: '',
      secret: f.secret === true,
    })),
    totp: null,
    attachments: [],
    icon: null,
    createdAt: at,
    updatedAt: at,
    history: [],
    expiredAfter: null,
    deletedAt: null,
  }
}

/* ---------- миграции формата ---------- */

/** Идемпотентно: приводит любое прочитанное значение к SecretsFile v1. */
export function migrateSecrets(raw: unknown): SecretsFile {
  if (typeof raw !== 'object' || raw === null) return EMPTY_SECRETS
  const box = raw as Partial<SecretsFile>
  if (!Array.isArray(box.entries)) return EMPTY_SECRETS
  const entries = box.entries
    .filter((e): e is SecretRecord => typeof e === 'object' && e !== null && typeof e.id === 'string')
    .map((e) => ({
      ...blankRecord(e.type ?? 'custom'),
      ...e,
      version: 1 as const,
      tags: Array.isArray(e.tags) ? e.tags : [],
      fields: Array.isArray(e.fields) ? e.fields : [],
      attachments: Array.isArray(e.attachments) ? e.attachments : [],
      history: Array.isArray(e.history) ? e.history : [],
    }))
  return { version: 1, entries }
}

/* ---------- производные ---------- */

export const isLive = (e: SecretRecord) => e.deletedAt === null

export function isExpired(e: SecretRecord, now: number): boolean {
  return e.expiredAfter !== null && e.expiredAfter < now
}

/** Стадия срока записи для вида «Истекающие» и бейджей. */
export type ExpiryStage = 'expired' | 'd1' | 'd7' | 'd30' | 'later'

export function expiryStage(e: SecretRecord, now: number): ExpiryStage | null {
  if (e.expiredAfter === null) return null
  const days = Math.ceil((e.expiredAfter - now) / 86_400_000)
  if (days <= 0) return 'expired'
  if (days <= 1) return 'd1'
  if (days <= 7) return 'd7'
  if (days <= 30) return 'd30'
  return 'later'
}

/** Сколько записей просрочено или истекает в ближайшие 30 дней. */
export function expiringCount(entries: SecretRecord[], now: number): number {
  return entries.filter((e) => {
    const st = expiryStage(e, now)
    return st !== null && st !== 'later'
  }).length
}

export function typeCounts(entries: SecretRecord[]): Record<SecretType, number> {
  const out = {} as Record<SecretType, number>
  for (const t of TYPE_ORDER) out[t] = 0
  for (const e of entries) if (isLive(e)) out[e.type] = (out[e.type] ?? 0) + 1
  return out
}

export function allTags(entries: SecretRecord[]): string[] {
  const set = new Set<string>()
  for (const e of entries) if (isLive(e)) e.tags.forEach((t) => set.add(t))
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Домен из значения поля типа url — только он уходит наружу за иконкой. */
export function domainOf(entry: SecretRecord): string | null {
  const raw = entry.fields.find((f) => f.kind === 'url' && !f.secret && f.value)?.value
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function monogram(title: string): string {
  const t = title.trim()
  if (!t) return '?'
  const parts = t.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

/** Стабильный цвет монограммы: одна и та же запись — один и тот же тон. */
export function monogramHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

/* ---------- фильтры запроса (type:/tag:/favorite:/expired:) ---------- */

export type ParsedQuery = {
  text: string
  type: SecretType | null
  tag: string | null
  favorite: boolean
  expired: boolean
}

const TYPE_ALIAS: Record<string, SecretType> = {
  login: 'login',
  пароль: 'login',
  password: 'login',
  api: 'api',
  seed: 'seed',
  card: 'card',
  карта: 'card',
  ssh: 'ssh',
  note: 'note',
  заметка: 'note',
  recovery: 'recovery',
  wifi: 'wifi',
  license: 'license',
  identity: 'identity',
  passkey: 'passkey-meta',
  custom: 'custom',
  totp: 'login',
}

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { text: '', type: null, tag: null, favorite: false, expired: false }
  const rest: string[] = []
  for (const token of q.split(/\s+/)) {
    const low = token.toLowerCase()
    if (low.startsWith('type:')) {
      out.type = TYPE_ALIAS[low.slice(5)] ?? null
    } else if (low.startsWith('tag:')) {
      out.tag = low.slice(4) || null
    } else if (low.startsWith('favorite:')) {
      out.favorite = low.slice(9) !== 'false'
    } else if (low.startsWith('expired:')) {
      out.expired = low.slice(8) !== 'false'
    } else if (token) {
      rest.push(token)
    }
  }
  out.text = rest.join(' ').trim().toLowerCase()
  return out
}

/** Отбор для центральной колонки: фильтры плюс совпадение по НЕсекретным полям. */
export function filterEntries(
  entries: SecretRecord[],
  q: ParsedQuery,
  now: number,
): SecretRecord[] {
  return entries.filter((e) => {
    if (q.type && e.type !== q.type) return false
    if (q.tag && !e.tags.some((t) => t.toLowerCase() === q.tag)) return false
    if (q.favorite && !e.favorite) return false
    if (q.expired && !isExpired(e, now)) return false
    if (!q.text) return true
    const hay = [
      e.title,
      e.tags.join(' '),
      TYPE_META[e.type].label,
      ...e.fields.filter((f) => !f.secret).map((f) => `${f.name} ${f.value}`),
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q.text)
  })
}

export function fmtAgo(at: number, now: number): string {
  const d = Math.max(0, now - at)
  const m = Math.round(d / 60_000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  const days = Math.round(h / 24)
  return `${days} дн назад`
}
