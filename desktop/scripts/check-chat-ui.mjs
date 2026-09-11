// Полный UI-прогон на изолированном порту: логин → провайдер → чат → POST /ai-api/chat.
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
const PORT = 38699

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

const sandbox = await mkdtemp(path.join(tmpdir(), 'wsx-ui2-'))
const serverDir = path.join(sandbox, 'server')
await cp(path.join(resources, 'server'), serverDir, { recursive: true })
const child = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
  cwd: serverDir,
  env: { ...env, WSX_NEXT_PORT: String(PORT), APP_PASSWORD: 'smoke-test-password-123', APP_SESSION_SECRET: 'ab'.repeat(24), MAIL_SECRET: 'cd'.repeat(24), ADMIN_LOGIN: 'admin', AI_DIR: path.join(sandbox, 'data'), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
  stdio: ['ignore', 'ignore', 'pipe'],
})
let chatPosts = 0
const until = Date.now() + 60_000
while (Date.now() < until) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/login`, { signal: AbortSignal.timeout(1500) }); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 700))
}
console.log('SERVER_READY=1 (port ' + PORT + ')')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
page.on('request', (r) => { if (r.url().includes('/ai-api/chat') && r.method() === 'POST') { chatPosts++; console.log('CHAT_POST_SEEN') } })

await page.goto(`http://127.0.0.1:${PORT}/login`)
await page.fill('[data-testid="login-login"]', 'admin')
await page.fill('[data-testid="login-password"]', 'smoke-test-password-123')
await page.locator('[data-testid="login-submit"]').click()
await page.waitForTimeout(2500)
console.log('AFTER_LOGIN_URL=' + page.url())

const put = await page.evaluate(async () => {
  const r = await fetch('/ai-api/ai/provider', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'custom', baseUrl: 'http://127.0.0.1:3999/v1', apiKey: 'test', model: 'mock-model-1' }) })
  return { status: r.status, body: await r.json().catch(() => null) }
})
console.log('PROVIDER_PUT=' + JSON.stringify(put))
await page.evaluate(() => window.dispatchEvent(new Event('wsx:provider-changed')))
await page.waitForTimeout(1000)

const badge = await page.evaluate(() => {
  const pill = document.querySelector('[data-testid="engine-pill"]')
  return { pill: pill?.textContent ?? null, state: pill?.getAttribute('data-state') ?? null }
})
console.log('BADGE=' + JSON.stringify(badge))

// Чат: отправка сообщения
await page.goto(`http://127.0.0.1:${PORT}/`)
await page.waitForTimeout(2500)
console.log('HOME_URL=' + page.url())
const homeSnap = await page.evaluate(() => ({
  body: document.body.innerText.slice(0, 300),
  chatInput: Boolean(document.querySelector('[data-testid="chat-input"]')),
  onb: Boolean(document.querySelector('[data-testid="onboarding"]')),
  onbStep: document.querySelector('.onb-kicker')?.textContent ?? null,
}))
console.log('HOME_SNAP=' + JSON.stringify(homeSnap))
// Онбординг: шаг 1 — выбрать гибрид (без галки) либо cloud+ack; шаг 2 — decline; шаг 3 — демо.
if (await page.locator('[data-testid="onboarding"]').count().catch(() => 0)) {
  const mode = page.locator('[data-testid="onb-mode-hybrid"]')
  if (await mode.count()) { await mode.click(); await page.waitForTimeout(300) }
  if (!(await page.locator('[data-testid="onb-step1-next"]').isEnabled().catch(() => false))) {
    await page.locator('[data-testid="onb-mode-cloud"]').click().catch(() => {})
    await page.locator('[data-testid="onb-cloud-ack"]').check().catch(() => {})
  }
  await page.locator('[data-testid="onb-step1-next"]').click()
  await page.waitForTimeout(600)
  // Шаг 2: мастер-ключ — откладываем (decline → подтверждение)
  const decline = page.locator('[data-testid="onb-decline"]')
  if (await decline.count().catch(() => 0)) {
    await decline.click(); await page.waitForTimeout(300)
    await page.locator('[data-testid="onb-decline-yes"]').click().catch(() => {})
    await page.waitForTimeout(600)
  }
  // Шаг 3: демо-профиль
  const demo = page.locator('[data-testid="onb-pick-demo"]')
  if (await demo.count().catch(() => 0)) { await demo.click(); console.log('ONBOARDING_DONE=1') }
  await page.waitForTimeout(1500)
}
const consent = page.locator('[data-testid="cloud-consent-accept"]')
if (await consent.count()) { await consent.click(); console.log('CONSENT_ACCEPTED=1'); await page.waitForTimeout(500) }
console.log('CHAT_INPUT_NOW=' + Boolean(await page.locator('[data-testid="chat-input"]').count().catch(() => 0)))
// Открываем чат через боковое меню
await page.locator('[data-testid="nav-chat"]').click().catch(() => {})
await page.waitForTimeout(1500)
console.log('CHAT_OPEN=' + Boolean(await page.locator('[data-testid="chat-input"]').count().catch(() => 0)))
await page.locator('[data-testid="chat-input"]').fill('привет')
await page.locator('[data-testid="chat-send-btn"]').click()
await page.waitForTimeout(1500)
const consent2 = page.locator('[data-testid="cloud-consent-accept"]')
if (await consent2.count().catch(() => 0)) { await consent2.click(); console.log('CONSENT_ACCEPTED_ON_SEND=1') }
await page.waitForTimeout(7000)
const lastAi = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.m-ai')]
  return els.length ? els[els.length - 1].textContent.slice(0, 160) : null
})
console.log('LAST_AI=' + JSON.stringify(lastAi))
console.log('CHAT_POST_COUNT=' + chatPosts)
console.log('CONSOLE_ERRS=' + JSON.stringify(errs.slice(0, 5)))
await page.screenshot({ path: 'C:/Users/admin-pc/AppData/Local/Temp/wsx-chat-check.png' })
await browser.close()
child.kill('SIGKILL')
mock.close()
await rm(sandbox, { recursive: true, force: true }).catch(() => {})
process.exit(0)
