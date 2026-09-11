import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { stat, rename, mkdir } from 'node:fs/promises'

export const systemEnvironment = () => Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'Path', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOME'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))

export async function requireFreePort(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', () => reject(new Error(`Порт ${port} занят другой программой. Закройте другую копию WorkSpaceX и повторите.`)))
    server.listen(Number(port), host, () => server.close(resolve))
  })
}
export async function waitFor(probe, signal, timeout = 90000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    signal?.throwIfAborted()
    try { if (await probe()) return } catch { /* startup is not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  throw new Error('Программа не успела запуститься. Проверьте свободную память и повторите.')
}
export class OwnedProcess {
  constructor(name, command, args, options, onState) {
    Object.assign(this, { name, command, args, options, onState, child: null, closing: false, restarts: [], timer: null, logStream: null })
  }
  // Diagnostics only: child output goes to <profile>/logs, never shown to other users of the app.
  setLogDir(dir) { this._logDir = dir; return this }
  async openLog() {
    if (this.logStream) return
    try {
      const dir = this._logDir
      if (!dir) return
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, 'server.log')
      try { if ((await stat(file)).size > 5 * 1024 * 1024) await rename(file, `${file}.old`) } catch { /* no previous log */ }
      this.logStream = createWriteStream(file, { flags: 'a' })
    } catch { this.logStream = null }
  }
  start() {
    if (this.child?.exitCode === null || this.closing) return
    void this.openLog().then(() => {
      this.child = spawn(this.command, this.args, { ...this.options, windowsHide: true, stdio: ['ignore', this.logStream ? 'pipe' : 'ignore', 'pipe'] })
      // Drain into the diagnostics log, but never persist environment values or user contents.
      const stamp = () => new Date().toISOString()
      this.child.stderr.on('data', (chunk) => { this.logStream?.write(`[${stamp()}] [stderr] ${chunk}`) })
      if (this.logStream) this.child.stdout.on('data', (chunk) => { this.logStream.write(`[${stamp()}] ${chunk}`) })
      this.child.once('error', () => this.onState(`${this.name}: не удалось запустить процесс.`, 'error'))
      this.child.once('exit', (code) => {
        this.logStream?.write(`[${stamp()}] [exit] code=${code}\n`)
        if (this.closing) return
        this.restarts = this.restarts.filter((t) => t > Date.now() - 300000)
        if (this.restarts.length >= 3) { this.onState(`${this.name}: несколько сбоев подряд. Освободите память и нажмите «Повторить».`, 'error'); return }
        this.restarts.push(Date.now())
        this.onState(`${this.name}: восстанавливаю после сбоя…`, 'starting')
        this.timer = setTimeout(() => this.start(), 1000 * 2 ** this.restarts.length)
      })
    })
  }
  async stop() {
    this.closing = true
    clearTimeout(this.timer)
    const child = this.child
    if (!child || child.exitCode !== null || !child.pid) return
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const killer = spawn(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('exit', resolve); killer.once('error', resolve)
      })
    } else {
      child.kill('SIGTERM')
      await Promise.race([new Promise((r) => child.once('exit', r)), new Promise((r) => setTimeout(r, 3000))])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }
}