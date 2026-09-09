// Isolated smoke test of the PACKAGED server: copies resources/server into a
// sandbox with no ancestor node_modules (simulates %LOCALAPPDATA%\Programs\WorkSpaceX
// on a clean machine), starts it, expects /login to answer 200.
// Usage: node desktop/scripts/smoke-packaged.mjs
import { mkdtemp, readFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parse } from 'dotenv'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resources = path.join(desktop, 'release', 'win-unpacked', 'resources')
const env = parse(await readFile(path.join(resources, 'runtime.env'), 'utf8'))

// Песочница с чистым окружением: никаких node_modules среди предков.
const sandbox = await mkdtemp(path.join(tmpdir(), 'wsx-smoke-'))
const serverDir = path.join(sandbox, 'server')
await cp(path.join(resources, 'server'), serverDir, { recursive: true })

const child = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
  cwd: serverDir,
  env: { ...env, APP_PASSWORD: 'smoke-test-password-123', APP_SESSION_SECRET: 'ab'.repeat(24), MAIL_SECRET: 'cd'.repeat(24), ADMIN_LOGIN: 'admin', AI_DIR: path.join(sandbox, 'data'), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: env.WSX_NEXT_PORT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
child.stdout.on('data', (c) => { out += c })
child.stderr.on('data', (c) => { out += c })
let status = 0
const until = Date.now() + 60000
while (Date.now() < until) {
  try {
    const r = await fetch(`http://127.0.0.1:${env.WSX_NEXT_PORT}/login`, { signal: AbortSignal.timeout(2000) })
    status = r.status
    if (r.ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 800))
}
child.kill('SIGKILL')
await rm(sandbox, { recursive: true, force: true }).catch(() => {})
console.log(status === 200 ? 'ISOLATED_LOGIN_HTTP_200_OK' : `ISOLATED_LOGIN_FAIL status=${status}`)
if (status !== 200) console.log('OUTPUT:', out.slice(-2000))
process.exit(status === 200 ? 0 : 1)
