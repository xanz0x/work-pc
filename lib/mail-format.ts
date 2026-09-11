/* ПОЧТА · форматирование для списка и карточки письма (клиент). */

import type { Addr } from './mail-client'

export const addrLabel = (a: Addr | null | undefined): string => (a ? a.name?.trim() || a.address : '—')

export const addrFull = (a: Addr): string => (a.name?.trim() ? `${a.name.trim()} <${a.address}>` : a.address)

/** Сегодня — время, в этом году — «12 июн», иначе — дата с годом. */
export function fmtMailDate(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export const fmtMailDateFull = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

export const letterWord = (n: number): string => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'письмо'
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 'письма'
  return 'писем'
}

export const REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'вручную' },
  { value: 30, label: 'каждые 30 с' },
  { value: 60, label: 'каждую минуту' },
  { value: 300, label: 'каждые 5 мин' },
]

export const REFRESH_KEY = 'wf.mail.refresh.v1'

export function readRefresh(): number {
  if (typeof window === 'undefined') return 60
  const raw = window.localStorage.getItem(REFRESH_KEY)
  if (raw === null) return 60
  const n = Number(raw)
  return REFRESH_OPTIONS.some((o) => o.value === n) ? n : 60
}

const CODE_TOKEN = /(?<![A-Za-z0-9])(?:(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}|\d{4,8})(?![A-Za-z0-9])/g
/* Слова, рядом с которыми число действительно является кодом. «Подтвердите»
   и «confirm» в список НЕ входят: письма-подтверждения часто вообще без кода,
   а рядом попадаются почтовый индекс, номер дома или год — выдумывать код
   из них нельзя. */
const CODE_WORDS = /(?:\b(?:code|otp|pin|passcode|verification|verify|2fa)\b)|код|пароль|одноразов/i
/** Тема письма разрешает мягкий поиск кода в теле: «Ваш код», «Verification code». */
const SUBJECT_CODE_WORDS = /(?:\b(?:code|otp|passcode|verification)\b)|код/i
/** Адресные и денежные соседи: рядом с ними число — не код. */
const NOT_CODE_BEFORE = /(?:\$|€|₽|№|#|\bzip\b|\bpostal\b|индекс|\bsuite\b|\bste\b|\bapt\b)\s*$/i
/** «San Francisco, CA 94111» — почтовый индекс после кода штата, а не код. */
const ZIP_BEFORE = /\b[A-Z]{2}\.?\s+$/
const NOT_CODE_AFTER = /^\s*(?:%|₽|\$|€|руб|usd|eur|байт|bytes?|kb|mb|gb|px|мин|сек|час|hours?|days?|minutes?|дн|год|years?)\b/i

/** Текст письма без разметки, скриптов, стилей и адресов ссылок. */
function plainBody(html: string | null, text: string | null): string {
  const stripped = (html ?? '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return `${text ?? ''}\n${stripped}`
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[\u00a0\u200b]/g, ' ')
    /* Ссылки в тексте письма убираем: в трекинг-адресах полно длинных чисел. */
    .replace(/https?:\/\/\S+/gi, ' ')
}

function looksLikeCode(body: string, token: string, at: number): boolean {
  const before = body.slice(Math.max(0, at - 70), at)
  const after = body.slice(at + token.length, at + token.length + 50)
  if (NOT_CODE_BEFORE.test(before)) return false
  if (/^\d{5}$/.test(token) && ZIP_BEFORE.test(before)) return false
  if (NOT_CODE_AFTER.test(after)) return false
  /* Год сам по себе кодом не бывает: «© 2026», «2026 год». */
  if (/^(?:19|20)\d{2}$/.test(token)) return false
  return true
}

/**
 * Код подтверждения из письма. Берём только токен, рядом с которым явно стоят
 * слова «код / code / OTP / verification»; если таких слов нет — кода нет,
 * и придумывать его из индекса, года или номера заказа нельзя (возвращается
 * `null`, кнопка «Код …» не показывается).
 * `subject` разрешает мягкий поиск: когда тема письма прямо про код, годится
 * и одиночное 4–8-значное число в теле.
 */
export function extractCode(html: string | null, text: string | null, subject?: string | null): string | null {
  const body = plainBody(html, text)
  for (const m of body.matchAll(CODE_TOKEN)) {
    const at = m.index ?? 0
    if (!looksLikeCode(body, m[0], at)) continue
    const before = body.slice(Math.max(0, at - 70), at)
    const after = body.slice(at + m[0].length, at + m[0].length + 50)
    if (CODE_WORDS.test(before) || CODE_WORDS.test(after)) return m[0]
  }
  if (subject && SUBJECT_CODE_WORDS.test(subject)) {
    for (const m of body.matchAll(CODE_TOKEN)) {
      const at = m.index ?? 0
      if (/^\d{4,8}$/.test(m[0]) && looksLikeCode(body, m[0], at)) return m[0]
    }
  }
  return null
}

/** Код прямо из темы письма — показываем в списке только когда тема явно про код. */
export function subjectCode(subject: string): string | null {
  if (!SUBJECT_CODE_WORDS.test(subject)) return null
  const m = subject.match(/(?<![A-Za-z0-9])(?:(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}|\d{4,8})(?![A-Za-z0-9])/)
  if (!m) return null
  return looksLikeCode(subject, m[0], m.index ?? 0) ? m[0] : null
}

/* ---------- ссылка-кнопка из письма ---------- */

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
const HREF = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const ALT = /alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i
/** Текст кнопки: «подтвердить», «войти», «активировать», «сбросить пароль»… */
const ACTION_TEXT =
  /подтверд|активир|проверить\s+почт|войти|вход|сброс|восстанов|установить\s+пароль|продолж|принять|перейти|открыть|confirm|verify|validate|activate|sign\s?in|log\s?in|login|reset|set\s+(?:your\s+)?password|get\s+started|continue|accept|join|unlock|complete|view\s+(?:your\s+)?(?:invite|account|order)/i
/** Служебные ссылки: отписка, соцсети, правила — не кнопка действия. */
const SERVICE_LINK =
  /unsubscribe|отпис|отказ\s+от\s+рассыл|privacy|policy|конфиденциальн|terms|услови|help|support|поддержк|contact|manage\s+(?:your\s+)?(?:preferences|subscription)|preferences|view\s+in\s+browser|в\s+браузере|blog|твиттер|twitter|x\.com|facebook|instagram|linkedin|youtube|telegram|apps?\.apple|play\.google/i
/** Признак «это кнопка, а не строчная ссылка». */
const BUTTON_ATTR = /background(?:-color)?\s*:|display\s*:\s*inline-block|border-radius|class\s*=\s*"[^"]*(?:btn|button|cta)|role\s*=\s*"button"|bgcolor/i

export type MailActionLink = { url: string; label: string }

/**
 * Главная ссылка-действие письма («Confirm Email», «Войти», «Сбросить пароль»).
 * Нужна рядом с кодом: когда кода нет (или он есть, но нажать кнопку в песочнице
 * нельзя), человек копирует ссылку из письма и открывает её сам.
 */
export function extractActionLink(html: string | null, text: string | null): MailActionLink | null {
  let best: (MailActionLink & { score: number }) | null = null
  const seen = new Set<string>()
  for (const m of (html ?? '').matchAll(ANCHOR)) {
    const attrs = m[1] ?? ''
    const href = HREF.exec(attrs)
    const url = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').replace(/&amp;/gi, '&').trim()
    if (!/^https?:\/\//i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    const inner = m[2] ?? ''
    const alt = ALT.exec(inner)?.[1] ?? ALT.exec(inner)?.[2] ?? ''
    const label = `${inner.replace(/<[^>]+>/g, ' ')} ${alt}`
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (SERVICE_LINK.test(label) || SERVICE_LINK.test(url)) continue
    let score = 0
    if (ACTION_TEXT.test(label)) score += 3
    if (BUTTON_ATTR.test(attrs) || BUTTON_ATTR.test(inner)) score += 2
    if (/confirm|verify|activate|signup|sign-up|invite|reset|token|magic|auth|validate/i.test(url)) score += 1
    if (score < 3) continue
    if (!best || score > best.score) best = { url, label: label.slice(0, 120) || 'ссылка из письма', score }
  }
  if (best) return { url: best.url, label: best.label }
  /* Письмо без разметки: одна ссылка и слова действия рядом — берём её. */
  const plain = `${text ?? ''}`
  if (ACTION_TEXT.test(plain)) {
    const urls = [...plain.matchAll(/https?:\/\/[^\s<>"')]+/gi)].map((u) => u[0])
    const uniq = [...new Set(urls)].filter((u) => !SERVICE_LINK.test(u))
    if (uniq.length === 1) return { url: uniq[0], label: 'ссылка из письма' }
  }
  return null
}

/** Свежая страница поверх уже загруженных: новые письма сверху, флаги обновляются, старые страницы остаются. */export function mergeRows<T extends { uid: number }>(fresh: T[], old: T[]): T[] {
  if (fresh.length === 0) return fresh
  const minFresh = Math.min(...fresh.map((r) => r.uid))
  return [...fresh, ...old.filter((r) => r.uid < minFresh)]
}
