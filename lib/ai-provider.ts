/* ============================================================
   ПОДКЛЮЧЕНИЕ МОДЕЛИ (единственный источник правды)
   Локального движка в продукте больше нет. Есть два способа
   подключить модель, и оба — OpenAI-совместимые:
     1. `custom`     — свой сервер: URL + токен + имя модели;
     2. `openrouter` — ключ OpenRouter и модель из живого списка.
   Конфигурация лежит в <AI_DIR>/ai/provider.json и читается и
   чатом, и файловым анализатором, и настройками.
   ============================================================ */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { requireUser } from './request-context'

function aiRoot(): string {
  const v = process.env.AI_DIR?.trim()
  if (!v) throw new Error('Missing configuration: AI_DIR')
  return v
}

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export type AiProviderKind = 'custom' | 'openrouter'

export type AiProviderConfig = {
  kind: AiProviderKind
  /** База OpenAI-совместимого API (без /chat/completions). */
  baseUrl: string
  apiKey: string
  /** Модель для чата и разбора документов. */
  model: string
  /** Модель, которая умеет смотреть картинки. Пусто — берём `model`. */
  visionModel: string
}

export const EMPTY_PROVIDER: AiProviderConfig = {
  kind: 'openrouter',
  baseUrl: OPENROUTER_BASE,
  apiKey: '',
  model: '',
  visionModel: '',
}

export class ProviderError extends Error {
  constructor(
    public code: 'NOT_CONFIGURED' | 'INVALID_ARGS' | 'UPSTREAM' | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
  }
}

const configFile = () => path.join(aiRoot(), 'ai', 'provider.json')

export async function readProvider(): Promise<AiProviderConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(configFile(), 'utf8')) as Partial<AiProviderConfig>
    const kind: AiProviderKind = raw.kind === 'custom' ? 'custom' : 'openrouter'
    return {
      kind,
      baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim() : kind === 'openrouter' ? OPENROUTER_BASE : '',
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      model: typeof raw.model === 'string' ? raw.model.trim() : '',
      visionModel: typeof raw.visionModel === 'string' ? raw.visionModel.trim() : '',
    }
  } catch {
    return { ...EMPTY_PROVIDER }
  }
}

export function providerReady(c: AiProviderConfig): boolean {
  return Boolean(c.baseUrl && c.model && (c.kind === 'openrouter' ? c.apiKey : true))
}

/** Вид для интерфейса: сам токен наружу не уходит, только его хвост. */
export function providerView(c: AiProviderConfig) {
  return {
    kind: c.kind,
    baseUrl: c.baseUrl,
    model: c.model,
    visionModel: c.visionModel,
    hasKey: Boolean(c.apiKey),
    keyHint: c.apiKey ? `…${c.apiKey.slice(-4)}` : null,
    ready: providerReady(c),
  }
}

function normalizeBase(raw: string, kind: AiProviderKind): string {
  const v = raw.trim().replace(/\/+$/, '')
  if (kind === 'openrouter') return OPENROUTER_BASE
  if (!v) throw new ProviderError('INVALID_ARGS', 'Укажите адрес сервера модели, например https://my-host/v1')
  let u: URL
  try {
    u = new URL(v)
  } catch {
    throw new ProviderError('INVALID_ARGS', 'Адрес сервера должен быть полным URL: https://хост/v1')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new ProviderError('INVALID_ARGS', 'Поддерживаются только http(s)-адреса.')
  }
  /* Частая ошибка: вставляют полный путь до /chat/completions. */
  return v.replace(/\/chat\/completions$/, '')
}

export type ProviderPatch = {
  kind?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  model?: unknown
  visionModel?: unknown
}

/** Записать конфигурацию. Пустой apiKey означает «не менять токен». */
export async function writeProvider(patch: ProviderPatch): Promise<AiProviderConfig> {
  if (requireUser().role !== 'admin') {
    throw new ProviderError('FORBIDDEN', 'Менять подключение модели может только администратор.')
  }
  const prev = await readProvider()
  const kind: AiProviderKind = patch.kind === 'custom' ? 'custom' : patch.kind === 'openrouter' ? 'openrouter' : prev.kind
  const keyRaw = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : ''
  const next: AiProviderConfig = {
    kind,
    baseUrl: normalizeBase(typeof patch.baseUrl === 'string' ? patch.baseUrl : prev.baseUrl, kind),
    /* Ключ живёт отдельно на каждый способ подключения — их не путаем. */
    apiKey: keyRaw || (kind === prev.kind ? prev.apiKey : ''),
    model: typeof patch.model === 'string' ? patch.model.trim() : kind === prev.kind ? prev.model : '',
    visionModel: typeof patch.visionModel === 'string' ? patch.visionModel.trim() : kind === prev.kind ? prev.visionModel : '',
  }
  if (kind === 'openrouter' && !next.apiKey) {
    throw new ProviderError('INVALID_ARGS', 'Нужен API-ключ OpenRouter (sk-or-…): его выдают на openrouter.ai/keys.')
  }
  if (next.model.length > 200 || next.visionModel.length > 200) {
    throw new ProviderError('INVALID_ARGS', 'Имя модели слишком длинное.')
  }
  const p = configFile()
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, p)
  return next
}

/* ---------- список моделей ---------- */

export type ProviderModel = {
  id: string
  name: string
  /** Длина контекста, если провайдер её сообщает. */
  context: number | null
  /** Умеет ли модель смотреть картинки. */
  vision: boolean
  /** Цена за миллион входных токенов в USD (OpenRouter), если известна. */
  promptPrice: number | null
  free: boolean
}

type OpenRouterModel = {
  id?: string
  name?: string
  context_length?: number
  architecture?: { input_modalities?: string[]; modality?: string }
  pricing?: { prompt?: string }
}

/** Живой список моделей провайдера. Бросает ProviderError с человеческой причиной. */
export async function listProviderModels(c: AiProviderConfig): Promise<ProviderModel[]> {
  if (!c.baseUrl) throw new ProviderError('NOT_CONFIGURED', 'Сначала укажите адрес сервера модели.')
  if (c.kind === 'openrouter' && !c.apiKey) throw new ProviderError('NOT_CONFIGURED', 'Сначала сохраните API-ключ OpenRouter.')
  let res: Response
  try {
    res = await fetch(`${c.baseUrl}/models`, {
      headers: c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new ProviderError('UPSTREAM', 'Сервер моделей не ответил. Проверьте адрес и доступ в сеть.')
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError('UPSTREAM', 'Токен отклонён провайдером (401/403).')
  if (!res.ok) throw new ProviderError('UPSTREAM', `Сервер моделей ответил ${res.status}.`)
  const body = (await res.json().catch(() => null)) as { data?: OpenRouterModel[] } | null
  const list = Array.isArray(body?.data) ? body!.data! : []
  const out: ProviderModel[] = []
  for (const m of list) {
    const id = typeof m.id === 'string' ? m.id : ''
    if (!id) continue
    const mods = m.architecture?.input_modalities ?? []
    const price = Number(m.pricing?.prompt ?? NaN)
    out.push({
      id,
      name: typeof m.name === 'string' && m.name ? m.name : id,
      context: Number.isFinite(m.context_length) ? Number(m.context_length) : null,
      vision: mods.includes('image') || /vision|vl\b|gpt-4o|gemini|claude-3|claude-sonnet|claude-opus/i.test(id),
      promptPrice: Number.isFinite(price) ? price * 1_000_000 : null,
      free: Number.isFinite(price) ? price === 0 : /:free$/.test(id),
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return out
}

/* ---------- один запрос без стрима (анализ файлов, служебные задачи) ---------- */

export type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string | ChatPart[] }

export async function providerChat(
  c: AiProviderConfig,
  messages: ChatMsg[],
  opts: { model?: string; timeoutMs?: number; maxTokens?: number } = {},
): Promise<string> {
  if (!providerReady(c)) {
    throw new ProviderError('NOT_CONFIGURED', 'Модель не подключена: откройте «Настройки → Подключение модели».')
  }
  const model = opts.model?.trim() || c.model
  let res: Response
  try {
    res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
        ...(c.kind === 'openrouter' ? { 'X-Title': 'WorkSpaceX' } : {}),
      },
      cache: 'no-store',
      body: JSON.stringify({ model, stream: false, temperature: 0.2, max_tokens: opts.maxTokens ?? 900, messages }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    })
  } catch {
    throw new ProviderError('UPSTREAM', `Модель ${model} не ответила: сервер недоступен или превышено время ожидания.`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProviderError('UPSTREAM', `Модель ${model} вернула ошибку ${res.status}. ${text.slice(0, 200)}`)
  }
  const j = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } }
    | null
  if (j?.error?.message) throw new ProviderError('UPSTREAM', `Провайдер: ${j.error.message}`)
  const content = j?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text?: unknown }).text ?? '') : ''))
      .join('')
  }
  return ''
}
