/* ============================================================
   ФАЙЛОВЫЙ АНАЛИЗАТОР (раздел 2, 2026-09-06)
   Серверный конвейер «что это за файл»: определяем тип по
   mime/расширению, вытаскиваем текстовое содержимое (PDF —
   pdf-parse, DOCX — mammoth, ZIP — adm-zip со списком и
   текстами внутренних файлов, картинки — exifreader), затем
   подключённая модель (свой сервер или OpenRouter — см.
   lib/ai-provider.ts) формулирует точное название, описание и
   метки. Фото уходит той же ручкой /chat/completions отдельной
   частью image_url, поэтому vision-модель видит сам снимок.
   Результат
   пишется в метаданные объекта через lib/cloud-store.ts
   (title/description/analysisTags/analysisStatus/analysisKind/
   analyzedAt/analysisError).

   Границы: файлы больше 50 МБ целиком не читаем; содержимое
   в логи не попадает; секретов здесь нет. Чистые функции
   (детект типа, разбор ZIP, сборка промпта, разбор ответа
   модели) держат юнит-тесты — настоящая модель им не нужна.
   ============================================================ */

import { createRequire } from 'node:module'
import AdmZip from 'adm-zip'
import mammoth from 'mammoth'
import { load as exifLoad } from 'exifreader'
import type { CloudAnalysisKind } from './cloud-store'
import { ProviderError, providerChat, providerReady, readProvider, type ChatMsg } from './ai-provider'

/* ---------- лимиты ---------- */

/** Больше этого размера файл целиком в память не читаем. */
export const MAX_BYTES_FULL = 50 * 1024 * 1024
/** Сколько символов содержимого отправляем модели. */
export const TEXT_SAMPLE_CHARS = 4000
/** Лимиты ZIP: ≤10 файлов, ≤2 МБ на файл. */
export const ZIP_MAX_TEXT_ENTRIES = 10
export const ZIP_MAX_ENTRY_BYTES = 2 * 1024 * 1024
/** Сколько символов текста берём из одного файла внутри ZIP. */
export const ZIP_ENTRY_SAMPLE_CHARS = 1200
/** Имена внутри ZIP в выборке для модели. */
const ZIP_NAME_SAMPLE = 40
/** Мягкие потолки ответа модели. */
const TITLE_MAX_CHARS = 120
const DESCRIPTION_MAX_CHARS = 400
/** Метки: до 5 штук, каждая короткая. */
const TAGS_MAX = 5
const TAG_MAX_CHARS = 24

/**
 * Системный промпт архивариуса: один на все типы файлов. Требуем
 * строгий JSON без markdown — парсер ниже достаёт JSON даже из
 * окружения, но лучше не провоцировать модель.
 */
export const DESCRIBE_SYSTEM = [
  'Ты — архивариус личного хранилища: ты даёшь файлу точное название, описание и метки для каталога.',
  'Тебе дают имя файла, его тип и содержимое; фото прикладывается к сообщению отдельным изображением.',
  'Верни строго один JSON-объект и ничего больше, без markdown и пояснений:',
  '{"title": "название", "description": "описание", "tags": ["метка"]}.',
  'Правила: русский язык, конкретика вместо общих слов, никаких «данный файл содержит».',
  'title — точное название по существу, не больше 8 слов. Если это документ известного вида, начни с его вида:',
  '«Паспорт РФ», «Договор аренды», «Счёт на оплату», «План проекта», «Резюме», «Скриншот переписки», «Чек».',
  'description — 1–2 предложения, не больше 48 слов: что это, что внутри и чем полезно.',
  'Называй ключевые факты, которые видишь: стороны, даты, номера, суммы, сроки, выводы, задачи.',
  'Если это фото — что изображено: объекты, сцена, детали, надписи. Документ на фото назови прямо',
  '(«на снимке паспорт РФ», «фотография чека»), и передай суть читаемого текста.',
  'Если это ZIP-архив — структура и главное содержимое.',
  'Если это документ — вид документа, о чём он и ключевые факты: даты, суммы, стороны, выводы.',
  'Персональные данные не выдумывай: пиши только то, что реально видно.',
  'tags — до 5 коротких меток в нижнем регистре: вид документа, тема, назначение, участник, срок.',
].join('\n')

/** Содержимое для модели: текстовая выборка и/или само фото в base64. */
export type DescribePayload = {
  sample: string
  /** Base64 изображения — уходит частью image_url в том же запросе. */
  imageBase64?: string
  /** MIME картинки для data-URI (по умолчанию image/jpeg). */
  imageMime?: string
}

/** Сборка сообщений для модели-архивариуса. Чистая функция — на ней юнит-тесты. */
export function buildAnalysisMessages(input: AnalyzeInput, payload: DescribePayload): ChatMsg[] {
  const text =
    `Имя файла: ${input.name}\nТип: ${input.contentType}\n\n` +
    (payload.sample.trim() ? `Содержимое:\n${truncateText(payload.sample)}` : 'Содержимое недоступно — опиши по имени файла.')
  if (!payload.imageBase64) {
    return [
      { role: 'system', content: DESCRIBE_SYSTEM },
      { role: 'user', content: text },
    ]
  }
  return [
    { role: 'system', content: DESCRIBE_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:${payload.imageMime || 'image/jpeg'};base64,${payload.imageBase64}` } },
      ],
    },
  ]
}

/* ---------- типы ---------- */

export type AnalysisRunStatus = 'done' | 'partial' | 'failed'

export type AnalysisResult = {
  title: string
  description: string
  /** Метки архивариуса (до 5) — если модель их вернула. */
  tags?: string[]
  kind: CloudAnalysisKind
  status: AnalysisRunStatus
  /** Человекочитаемая причина (по-русски) для failed/partial. */
  error?: string
}

/** Метаданные объекта без байтов — как отдаёт lib/cloud-store. */
export type AnalyzeInput = {
  id: string
  name: string
  contentType: string
  size: number
}

/* ---------- определение типа ---------- */

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown', 'mdown', 'mkd'])
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'py', 'rb', 'php', 'java', 'kt', 'kts', 'go', 'rs',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'swift', 'm', 'sh', 'bash', 'bat', 'ps1', 'sql', 'r',
  'pl', 'lua', 'dart', 'scala', 'hs', 'ex', 'exs', 'vue', 'svelte',
])
const TEXT_EXTS = new Set([
  'txt', 'log', 'csv', 'tsv', 'json', 'ndjson', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'properties', 'html', 'htm', 'css', 'scss', 'less', 'gradle', 'dockerfile',
  'gitignore', 'license', 'list',
])
const ARCHIVE_EXTS = new Set(['zip'])
const DOCX_EXTS = new Set(['docx', 'docm'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'avif', 'jxl'])

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * Тип файла по mime и расширению. Расширение выигрывает у общего
 * mime (octet-stream), специфичный mime — у расширения, если он
 * однозначный (например, настоящие application/pdf и image/*).
 */
export function detectKind(name: string, mime: string): CloudAnalysisKind {
  const m = (mime || '').split(';')[0].trim().toLowerCase()
  const ext = extOf(name)
  if (ext === 'pdf' || m === 'application/pdf') return 'pdf'
  if (DOCX_EXTS.has(ext) || m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (ARCHIVE_EXTS.has(ext) || m === 'application/zip' || m === 'application/x-zip-compressed') return 'archive'
  if (ext === 'svg' || m === 'image/svg+xml') return 'text' // SVG — читаемый текст
  if (IMAGE_EXTS.has(ext) || m.startsWith('image/')) return 'image'
  if (MARKDOWN_EXTS.has(ext) || m === 'text/markdown') return 'markdown'
  if (CODE_EXTS.has(ext) || /javascript|typescript|x-sh/.test(m)) return 'code'
  if (TEXT_EXTS.has(ext) || m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return 'text'
  return 'unknown'
}

/* ---------- декодирование текста ---------- */

/** UTF-8 без падений: битые байты заменяются, NUL (из DOC/PDF-мусора) убираем. */
export function decodeTextUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\u0000/g, '')
  } catch {
    return ''
  }
}

export function truncateText(s: string, max = TEXT_SAMPLE_CHARS): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/* ---------- ZIP ---------- */

export type ZipOverview = {
  /** Имена всех файлов внутри архива (папки не считаем). */
  names: string[]
  /** «имя: текст» первых текстовых файлов с соблюдением лимитов. */
  texts: string[]
  entryCount: number
}

const ZIP_TEXT_EXTS = new Set<string>([...TEXT_EXTS, ...MARKDOWN_EXTS, ...CODE_EXTS, 'svg'])

/** Список содержимого + тексты внутренних файлов. Бросает при битом архиве. */
export function zipOverview(bytes: Uint8Array): ZipOverview {
  const zip = new AdmZip(Buffer.from(bytes))
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const names = entries.map((e) => e.entryName)
  const texts: string[] = []
  for (const entry of entries) {
    if (texts.length >= ZIP_MAX_TEXT_ENTRIES) break
    if (entry.header.size > ZIP_MAX_ENTRY_BYTES) continue
    if (!ZIP_TEXT_EXTS.has(extOf(entry.entryName))) continue
    let text = ''
    try {
      text = decodeTextUtf8(entry.getData())
    } catch {
      continue // защищённый паролем или битый элемент пропускаем
    }
    const trimmed = text.trim().slice(0, ZIP_ENTRY_SAMPLE_CHARS)
    if (trimmed) texts.push(`${entry.entryName}: ${trimmed}`)
  }
  return { names, texts, entryCount: names.length }
}

/** Выборка архива для модели: список + тексты. */
export function zipSample(ov: ZipOverview): string {
  const shown = ov.names.slice(0, ZIP_NAME_SAMPLE).join(', ')
  const head = `Файлов в архиве: ${ov.entryCount}. Содержимое: ${shown}${ov.names.length > ZIP_NAME_SAMPLE ? '…' : ''}`
  return truncateText(ov.texts.length ? `${head}\n${ov.texts.join('\n---\n')}` : head)
}

/* ---------- PDF / DOCX ---------- */

type PdfParseFn = (buffer: Buffer, options?: unknown) => Promise<{ text?: string } | undefined>

let pdfParseFn: PdfParseFn | null = null

/**
 * pdf-parse подключаем лениво, настоящим require во время исполнения:
 * под бандлером Next его внутренности (pdf.js) безопаснее не трогать
 * при старте, а в юнит-тестах модуль вообще не нужен.
 */
async function loadPdfParse(): Promise<PdfParseFn> {
  if (!pdfParseFn) {
    const req = createRequire(import.meta.url)
    pdfParseFn = req('pdf-parse/lib/pdf-parse.js') as PdfParseFn
  }
  return pdfParseFn
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const parse = await loadPdfParse()
  const result = await parse(Buffer.from(bytes))
  return String(result?.text ?? '')
}

export async function docxText(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return String(result?.value ?? '')
}

/* ---------- изображения ---------- */

export type ImageMeta = {
  width?: number
  height?: number
  date?: string
  camera?: string
  /** Дополнительные EXIF-поля одной строкой. */
  notes: string[]
}

type ExifTag = { value?: unknown; description?: string }

/** Читаем размер, дату съёмки, камеру и прочие EXIF-поля. Бросает на не-изображениях. */
export function imageExif(bytes: Uint8Array): ImageMeta {
  const tags = exifLoad(Buffer.from(bytes)) as unknown as Record<string, ExifTag | undefined>
  const num = (key: string): number | undefined => {
    const raw = tags[key]?.value
    const n = typeof raw === 'number' ? raw : Number(Array.isArray(raw) ? raw[0] : raw)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  const str = (key: string): string | undefined => {
    const d = tags[key]?.description
    return typeof d === 'string' && d.trim() ? d.trim() : undefined
  }
  const width = num('Image Width') ?? num('ImageWidth') ?? num('ExifImageWidth')
  const height = num('Image Height') ?? num('ImageHeight') ?? num('ExifImageHeight')
  const date = str('DateTimeOriginal') ?? str('DateTime') ?? str('DateTimeDigitized') ?? str('FileModifyDate')
  const camera = [str('Make'), str('Model')].filter(Boolean).join(' ').trim() || undefined
  const notes: string[] = []
  for (const key of ['ISO', 'FNumber', 'ExposureTime', 'FocalLength', 'Orientation', 'Software', 'GPSLatitude']) {
    const v = str(key)
    if (v) notes.push(`${key}=${v}`)
  }
  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(date ? { date } : {}),
    ...(camera ? { camera } : {}),
    notes,
  }
}

/** Человекочитаемая сводка по EXIF — она же описание, когда vision недоступна. */
export function exifSummary(meta: ImageMeta): string {
  const parts: string[] = []
  if (meta.width && meta.height) parts.push(`изображение ${meta.width}×${meta.height}`)
  if (meta.date) parts.push(`снято ${meta.date}`)
  if (meta.camera) parts.push(`камера ${meta.camera}`)
  if (meta.notes.length) parts.push(`EXIF: ${meta.notes.slice(0, 5).join(', ')}`)
  return parts.length ? `Изображение: ${parts.join('; ')}.` : 'Изображение без читаемых EXIF-данных.'
}

/* ---------- разбор ответа модели ---------- */

type TitleDescription = { title?: string; description?: string; tags?: string[] }

function cleanField(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const v = raw.replace(/\s+/g, ' ').trim()
  return v ? v.slice(0, max) : undefined
}

/** Метки модели: строки без повторов, до TAGS_MAX штук. */
function cleanTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const tags: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const v = t.replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_CHARS)
    if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase())) tags.push(v)
    if (tags.length >= TAGS_MAX) break
  }
  return tags.length ? tags : undefined
}

function validatePair(obj: unknown): TitleDescription | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const o = obj as Record<string, unknown>
  const title = cleanField(o.title, TITLE_MAX_CHARS)
  const description = cleanField(o.description, DESCRIPTION_MAX_CHARS)
  const tags = cleanTags(o.tags)
  if (!title && !description && !tags) return null
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
  }
}

function tryParse(text: string): TitleDescription | null {
  try {
    return validatePair(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * Ответ модели должен быть строго JSON, но маленькая модель любит
 * пояснения и markdown — вытаскиваем JSON из любого окружения.
 * Ничего валидного нет — null ( caller применяет fallback).
 */
export function parseTitleDescription(raw: string): TitleDescription | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const direct = tryParse(text)
  if (direct) return direct
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fence) {
    const fenced = tryParse(fence[1].trim())
    if (fenced) return fenced
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParse(text.slice(start, end + 1))
  return null
}

/* ---------- fallback-описания ---------- */

/** Название из имени файла: без расширения, слова из разделителей, ≤8 слов. */
export function titleFromName(name: string): string {
  const stem = (name.split(/[\\/]/).pop() ?? name)
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.+()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = stem.split(' ').filter(Boolean).slice(0, 8)
  return words.length ? words.join(' ') : 'Файл'
}

/** Описание из первых непустых строк содержимого. */
export function descriptionFromLines(text: string, max = 300): string {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (!lines.length) return ''
  return lines.slice(0, 3).join(' · ').slice(0, max)
}

export function humanSize(size: number): string {
  if (size >= 1024 * 1024) return `${Math.round(size / (1024 * 1024))} МБ`
  if (size >= 1024) return `${Math.round(size / 1024)} КБ`
  return `${size} Б`
}

/* ---------- сохранение результата ---------- */

async function storeResult(id: string, res: AnalysisResult): Promise<void> {
  const { setFileAnalysis } = await import('./cloud-store')
  await setFileAnalysis(id, {
    ...(res.title ? { title: res.title } : {}),
    ...(res.description ? { description: res.description } : {}),
    ...(res.tags ? { analysisTags: res.tags } : {}),
    analysisStatus: res.status,
    analysisKind: res.kind,
    analyzedAt: new Date().toISOString(),
    ...(res.error ? { analysisError: res.error } : {}),
  })
}

/* ---------- сам конвейер ---------- */

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Полный анализ одного объекта: извлечь содержимое, получить у
 * модели название/описание, записать результат в метаданные.
 * Ошибки не бросаются наружу — конвейер всегда завершается
 * результатом со статусом done/partial/failed.
 */
export async function analyzeAndStore(input: AnalyzeInput): Promise<AnalysisResult> {
  try {
    const res = await analyzeInner(input)
    try {
      await storeResult(input.id, res)
    } catch (e) {
      // Объект могли удалить, пока шёл анализ, — анализ не теряем, но честно помечаем.
      return { ...res, status: res.status === 'failed' ? 'failed' : res.status, error: res.error ?? `результат не сохранён: ${reason(e)}` }
    }
    return res
  } catch (e) {
    const res: AnalysisResult = {
      title: titleFromName(input.name),
      description: '',
      kind: detectKind(input.name, input.contentType),
      status: 'failed',
      error: `Анализ не выполнен: ${reason(e)}`,
    }
    try {
      await storeResult(input.id, res)
    } catch {
      /* нет доступа к метаданным — остаёмся при честном ответе */
    }
    return res
  }
}

async function analyzeInner(input: AnalyzeInput): Promise<AnalysisResult> {
  const kind = detectKind(input.name, input.contentType)
  const tooBig = input.size > MAX_BYTES_FULL
  const partial: string[] = []

  /* (а) содержимое. Большие файлы целиком не читаем. */
  let bytes: Uint8Array | null = null
  if (!tooBig && input.size > 0) {
    const { readFileBytes } = await import('./cloud-store')
    try {
      const { data } = await readFileBytes(input.id)
      bytes = new Uint8Array(data)
    } catch (e) {
      return {
        title: titleFromName(input.name),
        description: '',
        kind,
        status: 'failed',
        error: `Не удалось прочитать файл: ${reason(e)}`,
      }
    }
  }

  let content = ''
  let zipNames: string[] = []
  let imageMeta: ImageMeta | null = null
  /** Фото целиком в base64 — уходит той же модели в images. */
  let imageBase64: string | undefined

  try {
    switch (kind) {
      case 'text':
      case 'code':
      case 'markdown':
      case 'unknown': // попробуем как текст: многие «неизвестные» — читаемые
        content = truncateText(decodeTextUtf8(bytes ?? new Uint8Array()))
        break
      case 'pdf':
        content = truncateText(await pdfText(bytes ?? new Uint8Array()))
        break
      case 'docx':
        content = truncateText(await docxText(bytes ?? new Uint8Array()))
        break
      case 'archive':
        if (bytes) {
          const ov = zipOverview(bytes)
          zipNames = ov.names
          content = zipSample(ov)
        }
        break
      case 'image': {
        if (bytes) {
          try {
            imageMeta = imageExif(bytes)
          } catch {
            partial.push('EXIF не прочитан: формат не распознан')
          }
          /* Отдельной vision-модели больше нет: фото читает та же
             мультимодальная модель тем же /api/chat (images: [base64]). */
          imageBase64 = Buffer.from(bytes).toString('base64')
        }
        break
      }
    }
  } catch (e) {
    return {
      title: titleFromName(input.name),
      description: '',
      kind,
      status: 'failed',
      error: `Не удалось извлечь содержимое: ${reason(e)}`,
    }
  }

  if (tooBig) partial.push(`файл больше 50 МБ (${humanSize(input.size)}) — содержимое не анализировалось`)

  /* (б) архивариус: одна модель и один промпт для всех типов файлов. */
  let title = titleFromName(input.name)
  let description = fallbackDescription(input, { zipNames, imageMeta, content, tooBig })
  let tags: string[] | undefined

  const sample = content.trim() || (imageMeta ? exifSummary(imageMeta) : '')
  if (sample || imageBase64) {
    try {
      const cfg = await readProvider()
      if (!providerReady(cfg)) {
        throw new ProviderError('NOT_CONFIGURED', 'модель не подключена — откройте «Настройки → Подключение модели»')
      }
      /* Фото читает vision-модель, если владелец выбрал её отдельно. */
      const model = imageBase64 ? cfg.visionModel || cfg.model : cfg.model
      const raw = await providerChat(
        cfg,
        buildAnalysisMessages(input, { sample, imageBase64, imageMime: input.contentType }),
        { model, timeoutMs: 180_000, maxTokens: 700 },
      )
      const parsed = parseTitleDescription(raw)
      if (parsed?.title) title = parsed.title
      if (parsed?.description) description = parsed.description
      if (parsed?.tags) tags = parsed.tags
      if (!parsed) partial.push('модель вернула неструктурированный ответ — использовано описание из содержимого')
    } catch (e) {
      partial.push(`описание моделью недоступно: ${reason(e)}`)
    }
  }

  const error = partial.length ? partial.join('; ') : undefined
  return {
    title,
    description,
    ...(tags ? { tags } : {}),
    kind,
    status: error ? 'partial' : 'done',
    ...(error ? { error } : {}),
  }
}

/** Описание без модели: из содержимого, списка ZIP, EXIF или имени. */
function fallbackDescription(
  input: AnalyzeInput,
  ctx: { zipNames: string[]; imageMeta: ImageMeta | null; content: string; tooBig: boolean },
): string {
  if (ctx.imageMeta) return exifSummary(ctx.imageMeta)
  if (ctx.zipNames.length) {
    const list = ctx.zipNames.slice(0, ZIP_NAME_SAMPLE).join(', ')
    return truncateText(`Архив, файлов: ${ctx.zipNames.length}. Внутри: ${list}${ctx.zipNames.length > ZIP_NAME_SAMPLE ? '…' : ''}`, DESCRIPTION_MAX_CHARS)
  }
  const fromContent = descriptionFromLines(ctx.content)
  if (fromContent) return fromContent
  const base = `Файл «${input.name}» (${humanSize(input.size)})`
  return ctx.tooBig ? `${base} — слишком большой для анализа содержимого.` : `${base} — текстовое содержимое не распознано.`
}
