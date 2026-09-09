import path from 'node:path'
import { promises as fs } from 'node:fs'
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'

const outDir = '/app/test_reports/screenshots_iter55'
const userData = `/app/test_reports/wsx-electron-${Date.now()}`

async function run() {
  await fs.mkdir(outDir, { recursive: true })
  await fs.mkdir(userData, { recursive: true })
  const app = await electron.launch({
    executablePath: '/app/desktop/node_modules/electron/dist/electron',
    args: ['/app/desktop/index.js', '--no-sandbox'],
    env: { ...process.env, WSX_TEST_USER_DATA: userData },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-testid="setup-brand"]', { timeout: 20000 })

    const initialOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    console.log('Initial overflow:', initialOverflow)
    assert.equal(initialOverflow, false)

    await page.screenshot({ path: path.join(outDir, 'electron-setup-default.jpg'), type: 'jpeg', quality: 20, fullPage: false })
    await page.setViewportSize({ width: 1920, height: 800 })
    await page.waitForTimeout(250)
    const wideOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    console.log('1920x800 overflow:', wideOverflow)
    assert.equal(wideOverflow, false)
    await page.screenshot({ path: path.join(outDir, 'electron-setup-1920x800.jpg'), type: 'jpeg', quality: 20, fullPage: false })

    await page.getByTestId('setup-choose-client').click({ force: true })
    await page.getByTestId('setup-invite-input').fill('WSX1-invalid')
    await page.getByTestId('setup-join').click({ force: true })
    await page.waitForTimeout(500)
    const malformedInviteError = await page.getByTestId('setup-error').textContent()
    console.log('Malformed invite error:', malformedInviteError)
    assert.match(malformedInviteError, /повреждено|недопустимый/)

    await page.getByTestId('setup-choose-host').click({ force: true })
    await page.getByTestId('setup-admin-login').fill('owneradmin')
    await page.getByTestId('setup-admin-password').fill('StrongPassword123!')
    await page.getByTestId('setup-admin-password-confirm').fill('StrongPassword123!')
    await page.getByTestId('setup-host-address').fill('127.0.0.1')
    await page.getByTestId('setup-model-license-consent').check({ force: true })
    await page.getByTestId('setup-create-host').click({ force: true })
    await page.waitForTimeout(700)
    const linuxHostError = await page.getByTestId('setup-error').textContent()
    console.log('Host create on Linux error:', linuxHostError)
    assert.match(linuxHostError, /Windows 10\/11 x64/)

    const mainPrefs = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return w.webContents.getLastWebPreferences()
    })
    console.log('Main window prefs:', JSON.stringify({
      sandbox: mainPrefs.sandbox,
      contextIsolation: mainPrefs.contextIsolation,
      nodeIntegration: mainPrefs.nodeIntegration,
      preload: mainPrefs.preload,
    }))

    const rendererPowers = await page.evaluate(() => ({
      hasNodeRequire: typeof window.require !== 'undefined',
      hasNodeProcess: typeof window.process !== 'undefined',
      hasDirectIpc: typeof window.ipcRenderer !== 'undefined',
      hasSetupBridge: Boolean(window.workspacexSetup),
    }))
    console.log('Renderer powers:', JSON.stringify(rendererPowers))
    assert.equal(mainPrefs.sandbox, true)
    assert.equal(mainPrefs.contextIsolation, true)
    assert.equal(mainPrefs.nodeIntegration, false)
    assert.deepEqual(rendererPowers, { hasNodeRequire: false, hasNodeProcess: false, hasDirectIpc: false, hasSetupBridge: true })
  } finally {
    await app.close()
  }
}

run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
