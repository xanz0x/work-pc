/* ============================================================
   АККАУНТЫ · общие типы и константы (сервер и интерфейс)
   Роли, тумблеры функций, тарифы и лицензии. Чистый модуль без Node-API.
   ============================================================ */

export type Role = 'admin' | 'user'
export type UserStatus = 'active' | 'blocked'

export type FeatureId = 'ai' | 'mcp' | 'sync' | 'secrets' | 'offline' | 'telemetry'

export type Features = Record<FeatureId, boolean>

export const FEATURES: { id: FeatureId; label: string; note: string }[] = [
  { id: 'ai', label: 'ИИ-чат (облако)', note: 'Разговоры с моделью через прокси, навыки, системный промпт' },
  { id: 'mcp', label: 'MCP наружу', note: 'Токены для внешних агентов и подтверждения опасных операций' },
  { id: 'sync', label: 'Синхронизация', note: 'E2EE-пространство между устройствами пользователя' },
  { id: 'secrets', label: 'Менеджер секретов', note: 'Пароли, ключи, карты под мастер-ключом' },
  { id: 'offline', label: 'Автономный режим и бэкапы', note: 'Отключение сети, экспорт и восстановление архива' },
  { id: 'telemetry', label: 'Телеметрия', note: 'Возможность включить отправку анонимных событий' },
]

export const DEFAULT_FEATURES: Features = {
  ai: true,
  mcp: true,
  sync: true,
  secrets: true,
  offline: true,
  telemetry: true,
}

export const DEFAULT_AI_DAILY_LIMIT = 50

/* ---------- тарифы ---------- */

export type PlanColor = 'graphite' | 'green' | 'blue' | 'amber' | 'violet' | 'red'

export const PLAN_COLORS: { id: PlanColor; label: string }[] = [
  { id: 'graphite', label: 'Графит' },
  { id: 'green', label: 'Зелёный' },
  { id: 'blue', label: 'Синий' },
  { id: 'amber', label: 'Янтарь' },
  { id: 'violet', label: 'Фиолет' },
  { id: 'red', label: 'Красный' },
]

/** Тариф: набор функций, лимит ИИ и срок по умолчанию для ключей. Настраивается админом. */
export type Plan = {
  id: string
  name: string
  tagline: string
  color: PlanColor
  /** Срок ключа по умолчанию, дней. */
  days: number
  features: Features
  aiDailyLimit: number
  order: number
  archived: boolean
  createdAt: number
}

export type PlanInput = Pick<Plan, 'name' | 'tagline' | 'color' | 'days' | 'features' | 'aiDailyLimit'>

export const DEFAULT_PLANS: PlanInput[] = [
  {
    name: 'Basic',
    tagline: 'Личный сейф и ИИ-помощник для одного',
    color: 'graphite',
    days: 30,
    features: { ai: true, mcp: false, sync: false, secrets: true, offline: true, telemetry: true },
    aiDailyLimit: 50,
  },
  {
    name: 'Pro',
    tagline: 'Синхронизация между устройствами и внешние агенты',
    color: 'green',
    days: 90,
    features: { ai: true, mcp: true, sync: true, secrets: true, offline: true, telemetry: true },
    aiDailyLimit: 300,
  },
  {
    name: 'Enterprise',
    tagline: 'Без лимитов, весь набор функций на год',
    color: 'violet',
    days: 365,
    features: { ...DEFAULT_FEATURES },
    aiDailyLimit: 0,
  },
]

export type PlanRef = { id: string; name: string; color: PlanColor }

/** Тариф со статистикой для админки. */
export type PlanStats = Plan & { users: number; freeKeys: number }

export function planProblem(p: Partial<PlanInput>): string | null {
  if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.trim().length > 32) return 'Название — от 2 до 32 знаков'
  if (typeof p.tagline === 'string' && p.tagline.length > 120) return 'Описание — до 120 знаков'
  if (!PLAN_COLORS.some((c) => c.id === p.color)) return 'Выберите цвет тарифа'
  const d = Number(p.days)
  if (!Number.isInteger(d) || d < 1 || d > 3650) return 'Срок — от 1 до 3650 дней'
  const l = Number(p.aiDailyLimit)
  if (!Number.isInteger(l) || l < 0 || l > 100_000) return 'Лимит ИИ — от 0 до 100 000'
  if (!isFeatures(p.features)) return 'Некорректный набор функций'
  return null
}

/* ---------- пользователь ---------- */

/** Публичное представление пользователя: без хеша пароля. */
export type UserView = {
  id: string
  login: string
  name: string
  role: Role
  status: UserStatus
  features: Features
  aiDailyLimit: number
  aiCallsToday: number
  aiCallsTotal: number
  licenseUntil: number | null
  plan: PlanRef | null
  mustChangePassword: boolean
  /** Первый (мигрированный) админ хранит локальные данные под старыми именами баз. */
  legacyStore: boolean
  createdAt: number
  lastLoginAt: number | null
  sessions: number
}

export type AccessState = 'ok' | 'blocked' | 'license' | 'password'

/** Что пользователю разрешено прямо сейчас: одна функция и для сервера, и для UI. */
export function accessState(u: Pick<UserView, 'role' | 'status' | 'licenseUntil' | 'mustChangePassword'>, now = Date.now()): AccessState {
  if (u.status === 'blocked') return 'blocked'
  if (u.mustChangePassword) return 'password'
  if (u.role === 'admin') return 'ok'
  return u.licenseUntil !== null && u.licenseUntil > now ? 'ok' : 'license'
}

/* ---------- ключи лицензий ---------- */

export type LicenseView = {
  id: string
  /** Маска ключа: последние 4 знака. Полный ключ показывается один раз при выдаче. */
  mask: string
  planId: string
  planName: string
  planColor: PlanColor
  days: number
  note: string
  createdAt: number
  usedBy: string | null
  usedByLogin: string | null
  usedAt: number | null
  revokedAt: number | null
}

export const LICENSE_TERMS: { label: string; days: number }[] = [
  { label: '7 дней', days: 7 },
  { label: '30 дней', days: 30 },
  { label: '90 дней', days: 90 },
  { label: '180 дней', days: 180 },
  { label: '1 год', days: 365 },
]

export const KEY_RE = /^WSX(-[A-Z2-9]{4}){4}$/

export const KEY_ERRORS = {
  INVALID: 'Такого ключа нет. Проверьте, нет ли опечатки.',
  USED: 'Этот ключ уже активирован.',
  REVOKED: 'Ключ отозван администратором.',
  PLAN_GONE: 'Тариф этого ключа удалён — обратитесь к администратору.',
} as const

export function normalizeKey(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^WSX/, '')
    .match(/.{1,4}/g)
    ?.slice(0, 4)
    .reduce((acc, part) => `${acc}-${part}`, 'WSX') ?? 'WSX'
}

/* ---------- проверки на границе ---------- */

export const LOGIN_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/

export function normalizeLogin(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

export function loginProblem(v: unknown): string | null {
  const l = normalizeLogin(v)
  if (l.length < 3) return 'Логин — не короче 3 знаков'
  if (l.length > 32) return 'Логин — не длиннее 32 знаков'
  if (!LOGIN_RE.test(l)) return 'Логин: латиница, цифры, точка, дефис и подчёркивание'
  return null
}

export function passwordProblem(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 8) return 'Пароль — не короче 8 знаков'
  if (p.length > 200) return 'Пароль слишком длинный'
  return null
}

export function isFeatures(v: unknown): v is Features {
  return (
    typeof v === 'object' &&
    v !== null &&
    FEATURES.every((f) => typeof (v as Record<string, unknown>)[f.id] === 'boolean')
  )
}
