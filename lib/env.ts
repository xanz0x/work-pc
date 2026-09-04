/* ============================================================
   ENV · схема переменных окружения (AR-5)
   Приложение падает на старте при неполной конфигурации, а не через
   час на первом запросе. Значения наружу не отдаются никогда:
   в ответах и логах фигурируют только имена и признак «задано».
   ============================================================ */

type Spec = {
  name: string
  required: boolean
  kind: 'string' | 'int' | 'url'
  note: string
  /** Минимальная длина для секретов. */
  min?: number
}

export const ENV_SPEC: Spec[] = [
  { name: 'APP_PASSWORD', required: true, kind: 'string', min: 8, note: 'пароль входа в приложение' },
  {
    name: 'APP_SESSION_SECRET',
    required: true,
    kind: 'string',
    min: 32,
    note: 'ключ подписи cookie сессии (32+ символа)',
  },
  { name: 'APP_SESSION_TTL_HOURS', required: false, kind: 'int', note: 'срок сессии, часов (12)' },
  { name: 'AI_PROXY_URL', required: false, kind: 'url', note: 'шлюз облачной модели' },
  { name: 'EMERGENT_LLM_KEY', required: false, kind: 'string', min: 8, note: 'ключ шлюза модели' },
  { name: 'AI_MODEL', required: false, kind: 'string', note: 'идентификатор модели' },
  {
    name: 'NEXT_PUBLIC_AI_MODEL_LABEL',
    required: false,
    kind: 'string',
    note: 'подпись модели в интерфейсе',
  },
  { name: 'AI_DIR', required: false, kind: 'string', note: 'каталог скиллов, MCP и сессий' },
  { name: 'AI_RATE_PER_MIN', required: false, kind: 'int', note: 'ходов в минуту с IP (10)' },
  { name: 'AI_RATE_PER_DAY', required: false, kind: 'int', note: 'ходов в сутки с IP (200)' },
  { name: 'MCP_RATE_PER_MIN', required: false, kind: 'int', note: 'вызовов MCP в минуту на токен (60)' },
  { name: 'ADMIN_LOGIN', required: false, kind: 'string', note: 'логин первого администратора (admin)' },
  { name: 'MAIL_SECRET', required: false, kind: 'string', min: 32, note: 'ключ шифрования паролей почтовых ящиков (32+ символа)' },
  { name: 'LOG_LEVEL', required: false, kind: 'string', note: 'debug | info | warn | error' },
]

export type EnvReport = {
  ok: boolean
  errors: string[]
  /** Имена заданных переменных — без значений. */
  present: string[]
  /** Облачный движок настроен полностью. */
  cloudReady: boolean
}

function checkOne(spec: Spec, raw: string | undefined): string | null {
  const v = raw?.trim() ?? ''
  if (!v) return spec.required ? `${spec.name} обязательна: ${spec.note}` : null
  if (spec.min && v.length < spec.min) return `${spec.name}: короче ${spec.min} символов`
  if (spec.kind === 'int' && !(Number.isFinite(Number(v)) && Number(v) > 0)) {
    return `${spec.name}: ожидается положительное число`
  }
  if (spec.kind === 'url' && !/^https?:\/\//.test(v)) return `${spec.name}: ожидается http(s)-адрес`
  return null
}

export function readEnv(env: Record<string, string | undefined> = process.env): EnvReport {
  const errors: string[] = []
  const present: string[] = []
  for (const spec of ENV_SPEC) {
    const err = checkOne(spec, env[spec.name])
    if (err) errors.push(err)
    if (env[spec.name]?.trim()) present.push(spec.name)
  }
  const cloudReady = Boolean(env.AI_PROXY_URL?.trim() && env.EMERGENT_LLM_KEY?.trim())
  return { ok: errors.length === 0, errors, present, cloudReady }
}

/** Падение на старте: вызывается из instrumentation.ts. */
export function assertEnv(env: Record<string, string | undefined> = process.env): EnvReport {
  const r = readEnv(env)
  if (!r.ok) {
    throw new Error(`Конфигурация неполная:\n- ${r.errors.join('\n- ')}`)
  }
  return r
}
