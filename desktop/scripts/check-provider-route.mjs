// Проверка бага пользователя: PUT/GET /ai-api/ai/provider на УПАКОВАННОМ сервере.
// Раньше route.js отсутствовал в пакете → 500 "Internal Server Error" (не JSON).
import { mkdtemp, readFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parse } from 'dotenv'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resources = path.join(desktop, 'release', 'win-unpacked', 'resources')
const env = parse(await readFile(path.join(resources, 'runtime.env'), 'utf8'))

const sandbox = await mkdtemp(path.join(tmpdir(), 'wsx-provider-'))
const serverDir = path.join(sandbox, 'server')
await cp(path.join(resources, 'server'), serverDir, { recursive: true })

const child = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
  cwd: serverDir,
  env: {
    ...env,
    APP_PASSWORD: 'smoke-test-password-123',
    APP_SESSION_SECRET: 'ab'.repeat(24),
    MAIL_SECRET: 'cd'.repeat(24),
    ADMIN_LOGIN: 'admin',
    AI_DIR: path.join(sandbox, 'data'),
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: env.WSX_NEXT_PORT,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let errs = ''
child.stderr.on('data', (c) => { errs += c })

let cookie = ''
const until = Date.now() + 60_000
let loginStatus = 0
while (Date.now() < until) {
  try {
    const r = await fetch(`http://127.0.0.1:${env.WSX_NEXT_PORT}/login`, { signal: AbortSignal.timeout(2000) })
    if (r.ok) { loginStatus = r.status; break }
  } catch {}
  await new Promise((r) => setTimeout(r, 800))
}
console.log('LOGIN_PAGE_STATUS=' + loginStatus)

// Логин как клиент приложения
const lr = await fetch(`http://127.0.0.1:${env.WSX_NEXT_PORT}/ai-api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: 'admin', password: 'smoke-test-password-123' }),
})
const setCookie = lr.headers.getSetCookie?.() ?? []
cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
console.log('AUTH_STATUS=' + lr.status)

// 1) GET — тот, что раньше отдавал 500 текстом
const g = await fetch(`http://127.0.0.1:${env.WSX_NEXT_PORT}/ai-api/ai/provider`, {
  headers: { cookie }, signal: AbortSignal.timeout(15000),
})
const gBody = await g.text()
let gJson = null
try { gBody ? JSON.parse(gBody) : null } catch {}
let gParsed = null
try { gParsed = JSON.parse(gBody) } catch {}
console.log('PROVIDER_GET_STATUS=' + g.status, 'JSON_OK=' + Boolean(gParsed), 'ready=' + (gParsed?.ready ?? 'n/a'))

// 2) PUT — сохранение подключения (то, что валилось у пользователя)
const p = await fetch(`http://127.0.0.1:${env.WSX_NEXT_PORT}/ai-api/ai/provider`, {
  method: 'PUT',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'openrouter', apiKey: 'sk-or-test-000000000000000000000000', model: 'z-ai/glm-5.3-flash', visionModel: '' }),
  signal: AbortSignal.timeout(20000),
})
const pBody = await p.text()
let pParsed = null
try { pParsed = JSON.parse(pBody) } catch {}
console.log('PROVIDER_PUT_STATUS=' + p.status, 'JSON_OK=' + Boolean(pParsed), 'ready=' + (pParsed?.ready ?? 'n/a'), 'model=' + (pParsed?.model ?? 'n/a'))

child.kill('SIGKILL')
await rm(sandbox, { recursive: true, force: true }).catch(() => {})
const ok = loginStatus === 200 && lr.status === 200 && g.status === 200 && Boolean(gParsed) && p.status === 200 && Boolean(pParsed)
console.log(ok ? 'PROVIDER_ROUTES_OK' : 'PROVIDER_ROUTES_FAIL')
if (errs.trim()) console.log('ERRTAIL: ' + errs.slice(-600))
process.exit(ok ? 0 : 1)
