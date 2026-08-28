import { CLUSTERS, clusterOf, fileCat, fileMeta, fileTags, type VaultFile } from './data'
import { isAlive, type Note } from './notes'

/* ============================================================
   ПОИСК
   Одна функция на весь прототип: топбар, Ctrl+K, фильтр библиотеки
   и подсветка карты спрашивают её же. Поэтому «найдено 3» в шапке
   и три подсвеченных узла на карте — это всегда одно и то же три.
   ============================================================ */

export type ScopeId = 'all' | 'semantic' | 'names' | 'notes'

export const SCOPES: { value: ScopeId; label: string; note: string }[] = [
  { value: 'all', label: 'Везде', note: 'Имена, содержимое, заметки и связи' },
  { value: 'semantic', label: 'Смысловой поиск', note: 'Модель ищет по значению, а не по буквам' },
  { value: 'names', label: 'Только имена файлов', note: 'Быстро, без обращения к индексу' },
  { value: 'notes', label: 'Мои заметки', note: 'Только то, что вы написали сами' },
]

export type HitKind = 'file' | 'note' | 'chat' | 'cluster' | 'setting' | 'secret'

/**
 * Индекс менеджера секретов: только название, тип и теги.
 * Значения полей зашифрованы и в поиск не попадают ни при каком запросе —
 * это redact по построению, а не по фильтру (§4.1 ТЗ модуля).
 */
export type SecretIndexItem = { id: string; title: string; type: string; tags: string[] }

export type Hit = {
  key: string
  kind: HitKind
  /** id объекта: файла, стикера, сессии, кластера или раздела настроек. */
  id: string
  title: string
  sub: string
  score: number
  /** Совпадение найдено по смыслу, а не по буквам — помечаем честно. */
  fuzzy?: boolean
  /**
   * Объект под файловым ключом, не открытый в этой вкладке (п.10.2):
   * содержимое в sub не показывается, найдено только по имени.
   */
  locked?: boolean
}

/**
 * Маленький словарь синонимов вместо эмбеддингов. Смысл тот же: запрос
 * «где деньги» находит смету и бюджет, хотя таких букв в них нет.
 */
const SYNONYMS: string[][] = [
  ['аренда', 'офис', 'договор', 'помещение', 'арендодатель', 'приёмка'],
  ['финансы', 'деньги', 'бюджет', 'смета', 'расходы', 'налог', 'отчёт', 'квартал'],
  ['изображение', 'фото', 'скриншот', 'скрин', 'картинка', 'снимок'],
  ['музыка', 'трек', 'демо', 'аудио', 'звук'],
  ['проект', 'питч', 'презентация', 'инвестор', 'слайд', 'роадмап'],
  ['баг', 'ошибка', 'сборка', 'падение', 'краш'],
  ['идея', 'продукт', 'черновик', 'заметка'],
  ['секрет', 'пароль', 'ключ', 'код', 'домофон'],
]

/** Разделы настроек: их тоже надо находить, а не листать глазами. */
export const SETTING_ENTRIES: { id: string; title: string; sub: string; words: string[] }[] = [
  { id: 'engine', title: 'Движок ИИ', sub: 'Настройки · где считается модель', words: ['движок', 'модель', 'локальный', 'облако', 'гибридный', 'ии'] },
  { id: 'index', title: 'Индексация', sub: 'Настройки · автометки, OCR, наблюдение', words: ['индекс', 'ocr', 'метки', 'автометки', 'папка', 'наблюдение'] },
  { id: 'privacy', title: 'Приватность', sub: 'Настройки · шифрование и телеметрия', words: ['приватность', 'шифрование', 'aes', 'телеметрия', 'маскировать', 'утечк'] },
  { id: 'storage', title: 'Хранилище', sub: 'Настройки · объём и состав сейфа', words: ['хранилище', 'место', 'объём', 'гб', 'квота', 'состав'] },
  { id: 'notifs', title: 'Уведомления', sub: 'Настройки · какие события показывать', words: ['уведомления', 'события', 'сводка', 'колокол'] },
  { id: 'secrets', title: 'Менеджер секретов', sub: 'Настройки · буфер, авто-скрытие, иконки', words: ['секреты', 'пароли', 'буфер', 'clipboard', 'totp', 'иконки', 'favicon', 'менеджер'] },
]

const norm = (s: string) => s.toLowerCase().replace('ё', 'е').trim()

/** Обрубает окончания: «договоры» и «договор» должны совпадать. */
function stem(w: string): string {
  return w.length > 5 ? w.slice(0, w.length - 2) : w
}

function words(q: string): string[] {
  return norm(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)
}

/** Расширяет запрос синонимами — только в смысловых режимах. */
function expand(ws: string[]): string[] {
  const out = new Set(ws)
  for (const w of ws) {
    for (const row of SYNONYMS) {
      if (row.some((r) => stem(r).startsWith(stem(w)) || stem(w).startsWith(stem(r)))) {
        row.forEach((r) => out.add(r))
      }
    }
  }
  return [...out]
}

function hitScore(haystack: string, ws: string[], weight: number): number {
  const h = norm(haystack)
  let score = 0
  for (const w of ws) {
    const s = stem(w)
    if (h.startsWith(w)) score += weight * 1.4
    else if (h.includes(w)) score += weight
    else if (s.length > 2 && h.includes(s)) score += weight * 0.7
  }
  return score
}

export type SearchInput = {
  files: VaultFile[]
  notes: Note[]
  sessions: { id: string; title: string; msgs: { text: string }[] }[]
  now: number
  /**
   * id объектов под файловым ключом, не открытых в этой вкладке (п.10.2).
   * Для них релевантность считается ТОЛЬКО по имени файла: ни desc,
   * ни теги, ни категория в счёт не идут и в выдачу не всплывают.
   */
  redactIds?: Set<string>
  /** Записи сейфа секретов; пусто, когда замок закрыт (§2.4 ТЗ модуля). */
  secrets?: SecretIndexItem[]
}

/**
 * Возвращает результаты по всему сейфу, отсортированные по релевантности.
 * Пустой запрос — пустой список: топбар не должен предлагать «всё сразу».
 */
export function searchAll(query: string, scope: ScopeId, input: SearchInput): Hit[] {
  const base = words(query)
  if (base.length === 0) return []

  const semantic = scope === 'all' || scope === 'semantic'
  const ws = semantic ? expand(base) : base
  const hits: Hit[] = []

  const literal = (s: string) => hitScore(s, base, 1)

  if (scope !== 'notes') {
    for (const f of input.files) {
      /* п.10.2: под ключом — содержимое недоступно и поиску тоже. */
      const redacted = input.redactIds?.has(f.id) ?? false
      let score = hitScore(f.name, base, 60)
      if (!redacted && scope !== 'names') {
        score += hitScore(f.desc, base, 26)
        score += hitScore(fileTags(f).join(' '), base, 22)
        score += hitScore(fileCat(f), base, 18)
      }
      const exact = score
      if (semantic) {
        score += hitScore(redacted ? f.name : `${f.name} ${f.desc} ${fileTags(f).join(' ')}`, ws, 9)
      }
      if (score > 0) {
        hits.push({
          key: `file:${f.id}`,
          kind: 'file',
          id: f.id,
          title: f.name,
          sub: redacted ? 'Под ключом' : `${fileCat(f)} · ${fileMeta(f)}`,
          score,
          fuzzy: exact === 0,
          locked: redacted || undefined,
        })
      }
    }
  }

  if (scope === 'all' || scope === 'notes' || scope === 'semantic') {
    for (const n of input.notes) {
      if (!isAlive(n, input.now)) continue
      let score = hitScore(n.title, base, 55) + hitScore(n.tags.join(' '), base, 22)
      if (!n.locked) score += hitScore(n.body, base, 20)
      const exact = score
      if (semantic) score += hitScore(`${n.title} ${n.tags.join(' ')}`, ws, 8)
      if (score > 0) {
        hits.push({
          key: `note:${n.id}`,
          kind: 'note',
          id: n.id,
          title: n.title,
          sub: n.locked ? 'Стикер · под паролем' : `Стикер · ${n.tags.join(', ')}`,
          score,
          fuzzy: exact === 0,
        })
      }
    }
  }

  if (scope === 'all' || scope === 'semantic') {
    for (const s of input.sessions) {
      const body = s.msgs.map((m) => m.text).join(' ')
      const score = hitScore(s.title, base, 40) + hitScore(body, base, 14)
      if (score > 0) {
        hits.push({
          key: `chat:${s.id}`,
          kind: 'chat',
          id: s.id,
          title: s.title,
          sub: `Разговор · ${s.msgs.length} сообщений`,
          score,
        })
      }
    }

    for (const c of CLUSTERS) {
      const score = literal(`${c.label} ${c.note}`) * 30
      if (score > 0) {
        const count = input.files.filter((f) => f.cluster === c.id).length
        hits.push({
          key: `cluster:${c.id}`,
          kind: 'cluster',
          id: c.id,
          title: c.label,
          sub: `Кластер · ${count} файлов`,
          score,
        })
      }
    }

    for (const s of input.secrets ?? []) {
      const score = hitScore(s.title, base, 58) + hitScore(s.tags.join(' '), base, 20) + hitScore(s.type, base, 16)
      if (score > 0) {
        hits.push({
          key: `secret:${s.id}`,
          kind: 'secret',
          id: s.id,
          title: s.title,
          sub: `Секрет · ${s.type}`,
          score,
        })
      }
    }

    for (const e of SETTING_ENTRIES) {
      const score = (literal(e.title) + hitScore(e.words.join(' '), base, 1)) * 24
      if (score > 0) {
        hits.push({ key: `setting:${e.id}`, kind: 'setting', id: e.id, title: e.title, sub: e.sub, score })
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}

/** Только файлы: библиотека фильтрует свою сетку этим же поиском. */
export function matchFiles(query: string, scope: ScopeId, input: SearchInput): Set<string> {
  const ids = new Set<string>()
  for (const h of searchAll(query, scope, input)) {
    if (h.kind === 'file') ids.add(h.id)
    if (h.kind === 'cluster') input.files.filter((f) => f.cluster === h.id).forEach((f) => ids.add(f.id))
  }
  return ids
}

export function clusterHint(id: string): string {
  return clusterOf(id as never).note
}
