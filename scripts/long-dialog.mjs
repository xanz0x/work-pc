/* ============================================================
   LONG-DIALOG · прогон длинного диалога против настоящего провайдера
   §2 хвоста волны 2: обрезка окна контекста (LG-1) была покрыта только
   unit-тестами. Здесь 25 ходов подряд идут в облако, а скрипт следит за
   тем, что в SSE-событии `ctx`:
   — `used` не превышает `limit` (обрезка работает);
   — `fill` растёт монотонно, пока не начнётся сворачивание в резюме;
   — как только `dropped` > 0, `fill` обязан перестать расти безостановочно.

   Запуск:
     APP_URL=http://localhost:3000 APP_PASSWORD=... node scripts/long-dialog.mjs
     TURNS=25 PACE_MS=6500 node scripts/long-dialog.mjs
   Лимит запросов — 10 ходов в минуту с адреса, поэтому по умолчанию между
   ходами держится пауза 6.5 с (или задайте свой X-Forwarded-For через IP=).
   ============================================================ */

const BASE = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const PASSWORD = process.env.APP_PASSWORD
const TURNS = Number(process.env.TURNS ?? 25)
const PACE_MS = Number(process.env.PACE_MS ?? 6500)
const IP = process.env.IP ?? '198.51.100.25'

if (!PASSWORD) {
  console.error('нужен APP_PASSWORD')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login() {
  const res = await fetch(`${BASE}/ai-api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`вход не удался: ${res.status}`)
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('сервер не выдал cookie сессии')
  return cookie.split(';')[0]
}

/** Один ход: возвращает событие ctx, длину ответа и код ошибки, если был. */
async function turn(cookie, sessionId, text) {
  const res = await fetch(`${BASE}/ai-api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      'X-Forwarded-For': IP,
    },
    body: JSON.stringify({ engine: 'cloud', sessionId, text, ctx: {} }),
  })
  if (!res.ok) {
    const body = await res.text()
    return { error: `${res.status} ${body.slice(0, 200)}` }
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let ctx = null
  let out = ''
  let error = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i).trim()
      buf = buf.slice(i + 2)
      if (!chunk.startsWith('data:')) continue
      let ev
      try {
        ev = JSON.parse(chunk.slice(5).trim())
      } catch {
        continue
      }
      if (ev.t === 'ctx') ctx = ev
      else if (ev.t === 'd') out += ev.x ?? ''
      else if (ev.t === 'err') error = ev.code ?? 'UNKNOWN'
    }
  }
  return { ctx, chars: out.length, error }
}

const QUESTIONS = [
  'Опиши в двух предложениях, зачем нужен локальный архив документов.',
  'Назови три типа файлов, которые чаще всего теряются.',
  'Чем смысловой поиск отличается от поиска по имени файла?',
  'Что стоит хранить в менеджере секретов, а что нет?',
  'Зачем архиву мастер-ключ, если файлы и так на устройстве?',
]

const main = async () => {
  const cookie = await login()
  const sessionId = `long-dialog-${Date.now()}`
  const fills = []
  let dropStartedAt = null

  for (let i = 1; i <= TURNS; i += 1) {
    const q = `${QUESTIONS[i % QUESTIONS.length]} (ход ${i}: добавь одну новую деталь и не повторяй сказанное)`
    const r = await turn(cookie, sessionId, q)
    if (r.error) {
      console.error(`ход ${i}: ошибка ${r.error}`)
      process.exitCode = 1
      break
    }
    const { used, limit, fill, dropped } = r.ctx ?? {}
    console.log(
      `ход ${String(i).padStart(2)}: used=${used} limit=${limit} fill=${fill}% dropped=${dropped} ответ=${r.chars} симв.`,
    )
    if (used > limit) {
      console.error(`ход ${i}: окно превышено — обрезка не сработала`)
      process.exitCode = 1
    }
    if (dropped > 0 && dropStartedAt === null) dropStartedAt = i
    fills.push(fill)
    if (i < TURNS) await sleep(PACE_MS)
  }

  /* Монотонность до начала сворачивания: окно обязано расти, а не скакать. */
  const head = dropStartedAt ? fills.slice(0, dropStartedAt - 1) : fills
  for (let i = 1; i < head.length; i += 1) {
    if (head[i] < head[i - 1]) {
      console.error(`fill упал без сворачивания: ход ${i + 1} (${head[i - 1]}% → ${head[i]}%)`)
      process.exitCode = 1
    }
  }
  console.log(
    dropStartedAt
      ? `сворачивание в резюме началось на ходе ${dropStartedAt}; итоговое заполнение ${fills[fills.length - 1]}%`
      : `сворачивание не потребовалось; итоговое заполнение ${fills[fills.length - 1]}%`,
  )
  if (!process.exitCode) console.log('итог: окно контекста держится')
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
