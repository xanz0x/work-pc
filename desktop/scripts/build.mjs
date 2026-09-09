// A repeatable build with an allowlisted payload. No end-user setup is run here.
import { spawn } from 'node:child_process'
import { cp, mkdir, rm, readFile, readdir, lstat, writeFile, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { parse } from 'dotenv'
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.dirname(desktop)
const staging = path.join(desktop, 'staging')
const output = path.join(root, '.next-desktop')
const server = path.join(staging, 'server')
const guard = path.join(root, '.desktop-build.lock')
const lock = await open(guard, 'wx')
const run = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  child.once('error', reject)
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Build command exited with ${code}`)))
})
try {
  await mkdir(staging, { recursive: true })
  const env = parse(await readFile(path.join(desktop, 'runtime.env')))
  await run(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
    cwd: root,
    env: { ...process.env, ...env, WSX_DESKTOP_BUILD: '1', NEXT_PUBLIC_DESKTOP: '1', NEXT_PUBLIC_DEFAULT_MODEL: 'qwen-3b', NEXT_TELEMETRY_DISABLED: '1',
      APP_PASSWORD: randomBytes(32).toString('hex'), APP_SESSION_SECRET: randomBytes(48).toString('hex'), AI_DIR: path.join(staging, 'build-only-data'),
      AI_PROXY_URL: '', EMERGENT_LLM_KEY: '', SONJJ_API_KEY: '', MAIL_SECRET: '',
    },
  })
  await rm(server, { recursive: true, force: true })
  await cp(path.join(output, 'standalone'), server, { recursive: true, dereference: true, filter: (source) => {
    const parts = path.relative(path.join(output, 'standalone'), source).split(path.sep)
    return !parts.some((p) => p.startsWith('.env') || ['.data', 'memory', 'test_reports', 'desktop', 'ai'].includes(p))
  } })
  // Standalone from a pnpm workspace keeps node_modules as symlinks into the
  // virtual store; electron-builder silently drops nested node_modules, so
  // rebuild a real production tree here with npm (no links, self-contained).
  // npm on Windows is a .cmd shim that plain spawn cannot execute — use npm-cli.js.
  await rm(path.join(server, 'node_modules'), { recursive: true, force: true })
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(npmCli)) throw new Error(`npm-cli.js не найден рядом с Node: ${npmCli}`)
  await run(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--prefix', server], { cwd: root })
  // Next's distDir is serialized into server.js, so preserve that directory name.
  await mkdir(path.join(server, '.next-desktop'), { recursive: true })
  await cp(path.join(output, 'static'), path.join(server, '.next-desktop/static'), { recursive: true })
  await cp(path.join(root, 'public'), path.join(server, 'public'), { recursive: true, filter: (source) => !source.endsWith('.pdf') && !source.endsWith('.exe') && !path.relative(path.join(root, 'public'), source).split(path.sep).includes('downloads') })
  await mkdir(path.join(server, 'ai'), { recursive: true })
  await cp(path.join(desktop, 'assets/system.md'), path.join(server, 'ai/system.md'))
  // Dynamic built-in tools come from CHAT_TOOLS, not the repository's edited AI files.
  const forbidden = new Set(['users.json', 'sessions.json', 'licenses.json', 'drive.json', 'tokens.json', 'secrets.bin', 'connection.json'])
  let files = 0
  async function audit(dir) {
    for (const name of await readdir(dir)) {
      const file = path.join(dir, name); const info = await lstat(file)
      if (name.startsWith('.env') || name === '.data' || forbidden.has(name)) throw new Error(`Private data in payload: ${path.relative(server, file)}`)
      if (info.isSymbolicLink()) throw new Error(`Unresolved symlink: ${file}`)
      if (info.isDirectory()) await audit(file); else files++
    }
  }
  await audit(server)
  await writeFile(path.join(staging, 'payload-report.json'), JSON.stringify({ files, privateDataFound: false, freshData: true, modelIncluded: false, builtAt: new Date().toISOString() }, null, 2))
  if (!process.argv.includes('--stage-only')) {
    await run(process.execPath, [path.join(desktop, 'node_modules/electron-builder/cli.js'), '--config', path.join(desktop, 'electron-builder.yml'), '--win', 'nsis', '--x64'], { cwd: desktop, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
  }
} finally { await lock.close(); await rm(guard, { force: true }) }