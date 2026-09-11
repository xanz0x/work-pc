// Прогон №2 на новой сборке: нормальный чат + провайдер, замолчавший посреди потока.
import { mkdtemp, readFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { parse } from 'dotenv'
import { chromium } from 'file:///C:/Users/admin-pc/Desktop/HERMES/work-pc-main/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resources = path.join(desktop, 'release', 'win-unpacked', 'resources')
const env = parse(await readFile(path.join(resources, 'runtime.env'), 'utf8'))
const PORT = 38697
// Режим мока: normal | silent (открывает поток и молчит)
const MODE = process.argv[2] === 'silent' ? 'silent' : 'normal'
let silentOpen = false

const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model-1', name: 'Mock 1', context_length: 8192, architecture: { input_modalities: ['text'] }, pricing: { prompt: '0' } }] }))
      return
    }
    if (req.url.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (MODE === 'silent') {
        silentOpen = true
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Начал' } }] })}\n\n`)
        // дальше молчит — проверяем idle-страж
        return
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Привет' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '! Отвечает мок.' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(404); res.end('{}')
  })
})
await new Promise((r) => mock.listen(3999, '127.0.0.1', r))

const sandbox = await mkdtemp(path.join(tmpdir(), 'wsx-final-'))
const serverDir = path.join(sandbox, 'server')
await cp(path.join(resources, 'server'), serverDir, { recursive: true })
const child = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
  cwd: serverDir,
  env: { ...env, WSX_NEXT_PORT: String(PORT), APP_PASSWORD: 'smoke-test-password-123', APP_SESSION_SECRET: 'ab'.repeat(24), MAIL_SECRET: 'cd'.repeat(24), ADMIN_LOGIN: 'admin', AI_DIR: path.join(sandbox, 'data'), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const until = Date.now() + 60_000
while (Date.now() < until) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/login`, { signal: AbortSignal.timeout(1500) }); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 700))
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${PORT}/login`)
await page.fill('[data-testid="login-login"]', 'admin')
await page.fill('[data-testid="login-password"]', 'smoke-test-password-123')
await page.locator('[data-testid="login-submit"]').click()
await page.waitForTimeout(2500)

const put = await page.evaluate(async () => {
  const r = await fetch('/ai-api/ai/provider', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'custom', baseUrl: 'http://127.0.0.1:3999/v1', apiKey: 'test', model: 'mock-model-1' }) })
  return r.status
})
console.log('PROVIDER_PUT=' + put)
await page.evaluate(() => window.dispatchEvent(new Event('wsx:provider-changed')))
await page.waitForTimeout(800)

// Онбординг: hybrid → decline → demo
await page.locator('[data-testid="onb-mode-hybrid"]').click().catch(() => {})
await page.locator('[data-testid="onb-step1-next"]').click()
await page.waitForTimeout(600)
const decline = page.locator('[data-testid="onb-decline"]')
if (await decline.count().catch(() => 0)) {
  await decline.click(); await page.waitForTimeout(300)
  await page.locator('[data-testid="onb-decline-yes"]').click().catch(() => {})
  await page.waitForTimeout(600)
}
await page.locator('[data-testid="onb-pick-demo"]').click()
await page.waitForTimeout(2000)

// Чат
await page.locator('[data-testid="nav-chat"]').click().catch(() => {})
await page.waitForTimeout(1200)
const badge = await page.evaluate(() => ({
  cls: document.querySelector('[data-testid="chat-cloud-badge"]')?.className ?? null,
  text: document.querySelector('[data-testid="chat-cloud-badge"]')?.textContent ?? null,
}))
console.log('BADGE=' + JSON.stringify(badge))

await page.locator('[data-testid="chat-input"]').fill('привет')
await page.locator('[data-testid="chat-send-btn"]').click()
await page.waitForTimeout(1500)
const c2 = page.locator('[data-testid="cloud-consent-accept"]')
if (await c2.count().catch(() => 0)) { await c2.click(); console.log('CONSENT_OK=1') }

// Ждём результата: нормальный ответ или честную ошибку по idle
const t0 = Date.now()
let result = 'TIMEOUT-150s'
for (let i = 0; i < 75; i++) {
  await page.waitForTimeout(2000)
  const st = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.m-ai')]
    const t = els.length ? els[els.length - 1].textContent : ''
    const busy = document.querySelector('.dock.is-busy') !== null
    const errNote = document.querySelector('[data-testid="ai-error-note"]')?.textContent ?? null
    const say = [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).join('|')
    return { t: t.slice(0, 120), busy, errNote: errNote?.slice(0, 160) ?? null, say: say.slice(0, 80) }
  })
  if (i === 0) console.log('T5s=' + JSON.stringify(st.current0 ?? st))
  if (st.errNote) { result = 'ERR_SHOWN: ' + st.errNote; break }
  if (/Ответ готов|Ответ остановлен/.test(st.say)) { result = 'DONE: ' + st.t; break }
  if (st.busy === false && st.t.length > 10) { result = 'DONE: ' + st.t; break }
}
console.log('MODE=' + MODE)
console.log('RESULT=' + result)
await page.screenshot({ path: 'C:/Users/admin-pc/AppData/Local/Temp/wsx-final.png' })
await browser.close()
child.kill('SIGKILL')
mock.close()
await rm(sandbox, { recursive: true, force: true }).catch(() => {})
process.exit(0)
