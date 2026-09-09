import path from 'node:path'
import { access, readFile, mkdir } from 'node:fs/promises'
import { runtimeEnv } from './config.mjs'
import { startGateway } from './gateway.mjs'
import { OwnedProcess, waitFor, requireFreePort, systemEnvironment } from './processes.mjs'
import { ensureEngine, ensureModel } from './downloads.mjs'

export class HostRuntime {
  constructor({ root, resources, serverDir, nodeExe, secrets, progress }) {
    Object.assign(this, { root, resources, serverDir, nodeExe, secrets, progress, children: [], gateway: null, controller: null, ready: false, busy: false })
  }
  async start() {
    if (this.busy) return
    this.busy = true
    this.controller = new AbortController()
    const signal = this.controller.signal
    try {
      const env = await runtimeEnv(this.resources, this.root)
      if (this.gateway && this.children.find((c) => c.name === 'Приложение')?.child?.exitCode !== null) {
        this.gateway.closeAllConnections()
        await new Promise((r) => this.gateway.close(r))
        await Promise.all(this.children.map((c) => c.stop()))
        this.gateway = null; this.children = []; this.ready = false
      }
      await mkdir(env.AI_DIR, { recursive: true })
      if (!this.gateway) {
        this.progress({ phase: 'starting', text: 'Запуск общей базы на этом ПК…' })
        await requireFreePort(env.WSX_LOOPBACK, env.WSX_NEXT_PORT)
        await requireFreePort(env.WSX_LISTEN_HOST, env.WSX_HTTPS_PORT)
        const identity = { cert: await readFile(path.join(this.root, 'certificate.pem')), key: await readFile(path.join(this.root, 'private-key.pem')) }
        await access(path.join(this.serverDir, 'server.js'))
        // Explicit allowlist: no credentials from the developer's shell are inherited.
        const system = systemEnvironment()
        const server = new OwnedProcess('Приложение', this.nodeExe, [path.join(this.serverDir, 'server.js')], {
          cwd: this.serverDir,
          env: { ...system, ...env, ...this.secrets(), NODE_ENV: 'production', HOSTNAME: env.WSX_LOOPBACK, PORT: env.WSX_NEXT_PORT, ELECTRON_RUN_AS_NODE: '1' },
        }, (text, phase) => this.progress({ phase, text })).setLogDir(path.join(this.root, 'logs'))
        this.children.push(server); server.start()
        await waitFor(async () => (await fetch(`http://${env.WSX_LOOPBACK}:${env.WSX_NEXT_PORT}/login`, { signal: AbortSignal.timeout(2500) })).ok, signal)
        this.gateway = await startGateway(env, identity)
        this.ready = true
        this.progress({ phase: 'app-ready', text: 'Общая база запущена. Подготавливаю ИИ…', appReady: true })
      }
      const exe = await ensureEngine(this.resources, this.root, signal, this.progress)
      let ollama = this.children.find((c) => c.name === 'Ollama')
      if (!ollama || ollama.child?.exitCode !== null) {
        if (ollama) await ollama.stop()
        const url = new URL(env.OLLAMA_URL)
        await requireFreePort(url.hostname, url.port)
        ollama = new OwnedProcess('Ollama', exe, ['serve'], {
          cwd: path.dirname(exe), env: { ...systemEnvironment(), ...env },
        }, (text, phase) => this.progress({ phase, text })).setLogDir(path.join(this.root, 'logs'))
        this.children = this.children.filter((c) => c.name !== 'Ollama'); this.children.push(ollama); ollama.start()
      }
      await waitFor(async () => (await fetch(`${env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) })).ok, signal)
      await ensureModel(env, signal, this.progress)
      this.progress({ phase: 'warmup', text: 'Первый запуск модели. На 8 ГБ памяти это может занять несколько минут…' })
      const response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
        body: JSON.stringify({ model: env.OLLAMA_MODEL, messages: [], stream: false, keep_alive: env.OLLAMA_KEEP_ALIVE, options: { num_ctx: Number(env.OLLAMA_NUM_CTX), num_predict: 1 } }),
      })
      if (!response.ok || (await response.json()).error) throw new Error('Модель скачана, но не загрузилась в память. Закройте лишние программы и повторите.')
      this.progress({ phase: 'ready', text: 'Приложение и локальный ИИ готовы.', appReady: true, modelReady: true })
    } catch (e) {
      this.progress({ phase: 'error', text: signal.aborted ? 'Загрузка приостановлена. Нажмите «Повторить», чтобы продолжить.' : e.message, appReady: this.ready })
      if (!this.gateway) { await Promise.all(this.children.map((c) => c.stop())); this.children = [] }
    } finally { this.busy = false }
  }
  cancel() { this.controller?.abort() }
  async stop() {
    this.cancel()
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 100))
    this.gateway?.closeAllConnections()
    if (this.gateway) await new Promise((r) => this.gateway.close(r))
    await Promise.all(this.children.map((c) => c.stop()))
    this.children = []; this.gateway = null; this.ready = false
  }
}