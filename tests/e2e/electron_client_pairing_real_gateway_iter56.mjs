import path from 'node:path'
import net from 'node:net'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { createCertificate, fingerprint } from '../../desktop/src/security.mjs'
import { encodeInvite } from '../../desktop/src/config.mjs'
import { startGateway } from '../../desktop/src/gateway.mjs'

const outDir = '/app/test_reports/screenshots_iter56'

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : null
      server.close(() => resolve(port))
    })
  })
}

async function run() {
  const adminLogin = process.env.ADMIN_LOGIN
  const adminPassword = process.env.APP_PASSWORD
  if (!adminLogin || !adminPassword) throw new Error('ADMIN_LOGIN/APP_PASSWORD are required')

  await fs.mkdir(outDir, { recursive: true })
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wsx-gateway-iter56-'))
  const userData = `/app/test_reports/wsx-electron-iter56-${Date.now()}`
  await fs.mkdir(userData, { recursive: true })

  const httpsPort = await freePort()
  if (!httpsPort) throw new Error('Unable to allocate HTTPS port')

  const identity = await createCertificate(tmpRoot, ['127.0.0.1', 'localhost'])
  const pin = fingerprint(identity.cert)

  const env = {
    WSX_LOOPBACK: '127.0.0.1',
    WSX_NEXT_PORT: process.env.WSX_NEXT_PORT || '3000',
    WSX_HTTPS_PORT: String(httpsPort),
    WSX_LISTEN_HOST: process.env.WSX_LISTEN_HOST || '127.0.0.1',
  }

  const gateway = await startGateway(env, identity)
  let app
  try {
    const inviteGood = encodeInvite({ version: 1, url: `https://localhost:${httpsPort}`, pin })
    const inviteBadPin = encodeInvite({ version: 1, url: `https://localhost:${httpsPort}`, pin: '0'.repeat(64) })

    app = await electron.launch({
      executablePath: '/app/desktop/node_modules/electron/dist/electron',
      args: ['/app/desktop/index.js', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage'],
      env: { ...process.env, WSX_TEST_USER_DATA: userData },
    })

    const setup = await app.firstWindow()
    await setup.waitForSelector('[data-testid="setup-brand"]', { timeout: 20000 })
    console.log('Step 1: Setup wizard opened')

    await setup.getByTestId('setup-choose-client').click({ force: true })
    await setup.getByTestId('setup-invite-input').fill(inviteBadPin)
    await setup.getByTestId('setup-join').click({ force: true })
    await setup.waitForTimeout(700)
    const wrongPinError = (await setup.getByTestId('setup-error').textContent()) || ''
    console.log('Step 2: Wrong pin error:', wrongPinError)
    assert.match(wrongPinError, /сертификат|отпечат|совпад|приглашени/i)

    await setup.getByTestId('setup-invite-input').fill(inviteGood)
    await setup.getByTestId('setup-join').click({ force: true })
    await setup.waitForTimeout(1000)
    await setup.waitForSelector('[data-testid="setup-open"]:not([disabled])', { timeout: 20000 })
    console.log('Step 3: Valid invite accepted and open button enabled')
    await setup.screenshot({ path: path.join(outDir, 'iter56-electron-client-joined.jpg'), type: 'jpeg', quality: 20, fullPage: false })

    const workspacePromise = app.waitForEvent('window', { timeout: 30000 })
    await setup.getByTestId('setup-open').click({ force: true })
    const workspace = await workspacePromise
    await workspace.waitForSelector('[data-testid="login-page"]', { timeout: 30000 })
    console.log('Step 4: Workspace window opened through HTTPS gateway')

    const rendererSecurity = await workspace.evaluate(() => ({
      secureContext: window.isSecureContext,
      hasNodeRequire: typeof window.require !== 'undefined',
      hasNodeProcess: typeof window.process !== 'undefined',
      hasDirectIpc: typeof window.ipcRenderer !== 'undefined',
      hasSetupBridge: Boolean(window.workspacexSetup),
    }))
    console.log('Step 5: Renderer security:', JSON.stringify(rendererSecurity))
    assert.equal(rendererSecurity.secureContext, true)
    assert.equal(rendererSecurity.hasNodeRequire, false)
    assert.equal(rendererSecurity.hasNodeProcess, false)
    assert.equal(rendererSecurity.hasDirectIpc, false)
    assert.equal(rendererSecurity.hasSetupBridge, false)

    await workspace.getByTestId('login-login').fill(adminLogin)
    await workspace.getByTestId('login-password').fill(adminPassword)
    await workspace.getByTestId('login-submit').click({ force: true })
    await workspace.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 })
    console.log('Step 6: Login succeeded via gateway')

    const cloudStatus = await workspace.evaluate(async () => {
      const r = await fetch('/ai-api/cloud', { credentials: 'include' })
      return r.status
    })
    console.log('Step 7: /ai-api/cloud status in native workspace:', cloudStatus)
    assert.equal(cloudStatus, 200)

    const cookies = await app.evaluate(async ({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'WorkSpaceX') || BrowserWindow.getAllWindows()[0]
      return win ? await win.webContents.session.cookies.get({ url }) : []
    }, `https://localhost:${httpsPort}`)
    const wfSession = cookies.find((c) => c.name === 'wf_session')
    assert.ok(wfSession, 'wf_session cookie missing after login')
    assert.equal(Boolean(wfSession.secure), true)

    await workspace.screenshot({ path: path.join(outDir, 'iter56-electron-client-workspace.jpg'), type: 'jpeg', quality: 20, fullPage: false })
    console.log('Step 8: Native pairing positive flow passed')
  } finally {
    if (app) await app.close()
    gateway.closeAllConnections()
    await new Promise((resolve) => gateway.close(resolve))
  }
}

run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
