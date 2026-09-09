import path from 'node:path'
import { access, readFile, mkdir } from 'node:fs/promises'
import { runtimeEnv } from './config.mjs'
import { startGateway } from './gateway.mjs'
import { OwnedProcess, waitFor, requireFreePort, systemEnvironment } from './processes.mjs'

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
        this.progress({ phase: 'ready', text: 'Общая база запущена. Модель подключается в настройках программы.', appReady: true, modelReady: true })
      }
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