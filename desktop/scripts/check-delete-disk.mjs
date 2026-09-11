// Финальный прогон удаления (staging-сервер): A с галочкой, B без.
import { mkdtemp, readFile, cp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parse } from 'dotenv'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stagingServer = path.join(desktop, 'staging', 'server')
const env = parse(await readFile(path.join(desktop, 'runtime.env'), 'utf8'))
const PORT = 38696
const rootDir = await mkdtemp(path.join(tmpdir(), 'wsx-disk-'))
const sandbox = await mkdtemp(path.join(tmpdir(), 'wsx-del-'))
const serverDir = path.join(sandbox, 'server')
await cp(stagingServer, serverDir, { recursive: true })
const aiDir = path.join(sandbox, 'data')
const child = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
  cwd: serverDir,
  env: {
    ...env, WSX_NEXT_PORT: String(PORT),
    APP_PASSWORD: 'smoke-test-password-123', APP_SESSION_SECRET: 'ab'.repeat(24), MAIL_SECRET: 'cd'.repeat(24),
    ADMIN_LOGIN: 'admin', AI_DIR: aiDir, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT,
    SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  },
  stdio: ['ignore', 'ignore', 'ignore'],
})
const until = Date.now() + 60_000
while (Date.now() < until) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/login`, { signal: AbortSignal.timeout(1500) }); if (r.ok) break } catch {}
  await new Promise((r) => setTimeout(r, 700))
}
const lr = await fetch(`http://127.0.0.1:${PORT}/ai-api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'smoke-test-password-123' }),
})
const cookie = (lr.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
await fetch(`http://127.0.0.1:${PORT}/ai-api/cloud/storage-root`, {
  method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ root: rootDir }),
})

async function uploadLocal(name, bytes) {
  const fd = new FormData()
  fd.append('file', new Blob([bytes]), name)
  fd.append('dir', '')
  fd.append('scope', 'local')
  const r = await fetch(`http://127.0.0.1:${PORT}/ai-api/cloud/upload`, { method: 'POST', headers: { cookie }, body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j?.file?.id) throw new Error('upload failed: ' + (j?.error ?? r.status))
  return j.file
}
const exists = async (p) => stat(p).then(() => true).catch(() => false)

// A: с галочкой — байты уходят с ПК
const f1 = await uploadLocal('a-delete.txt', new TextEncoder().encode('A'))
const d1 = await fetch(`http://127.0.0.1:${PORT}/ai-api/cloud/file/${encodeURIComponent(f1.id)}`, {
  method: 'DELETE', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ removeBytes: true }),
})
const goneA = !(await exists(path.join(rootDir, 'a-delete.txt')))
console.log(`A: http=${d1.status} goneFromDisk=${goneA}`)

// B: без галочки — байты остаются
const f2 = await uploadLocal('b-keep.txt', new TextEncoder().encode('B'))
const d2 = await fetch(`http://127.0.0.1:${PORT}/ai-api/cloud/file/${encodeURIComponent(f2.id)}`, {
  method: 'DELETE', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ removeBytes: false }),
})
const keptB = await exists(path.join(rootDir, 'b-keep.txt'))
console.log(`B: http=${d2.status} bytesKept=${keptB}`)

child.kill('SIGKILL')
await rm(sandbox, { recursive: true, force: true }).catch(() => {})
await rm(rootDir, { recursive: true, force: true }).catch(() => {})
const ok = d1.status === 200 && goneA && d2.status === 200 && keptB
console.log(ok ? 'DELETE_DISK_OK' : 'DELETE_DISK_FAIL')
process.exit(ok ? 0 : 1)
