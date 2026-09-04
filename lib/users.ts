/* ============================================================
   АККАУНТЫ · общие типы и константы (сервер и интерфейс)
   Роли, тумблеры функций, лицензии. Чистый модуль без Node-API.
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

/** Публичное представление пользователя: без хеша пароля. */
export type UserView = {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  features: Features
  aiDailyLimit: number
  aiCallsToday: number
  aiCallsTotal: number
  licenseUntil: number | null
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

export type LicenseView = {
  id: string
  /** Маска ключа: последние 4 знака. Полный ключ показывается один раз при выдаче. */
  mask: string
  days: number
  note: string
  createdAt: number
  usedBy: string | null
  usedAt: number | null
  revokedAt: number | null
}

export const LICENSE_TERMS: { label: string; days: number }[] = [
  { label: '7 дней', days: 7 },
  { label: '30 дней', days: 30 },
  { label: '90 дней', days: 90 },
  { label: '1 год', days: 365 },
]

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/

export function isEmail(v: unknown): v is string {
  return typeof v === 'string' && EMAIL_RE.test(v.trim().toLowerCase())
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
