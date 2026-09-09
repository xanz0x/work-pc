import { app, BrowserWindow, ipcMain, Menu, clipboard, shell, safeStorage, session, dialog, powerSaveBlocker } from 'electron'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile, statfs, mkdir, access } from 'node:fs/promises'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { atomicWrite, loadConfig, validateHostInput, runtimeEnv, newSecrets, decodeInvite, encodeInvite } from './config.mjs'
import { createCertificate, fingerprint, verifyPinned, checkConnection } from './security.mjs'
import { HostRuntime } from './runtime.mjs'
import { initLogger, logEvent } from './logger.mjs'

process.on('unhandledRejection', (reason) => logEvent('error', 'unhandled-rejection', { reason: reason instanceof Error ? reason.message : String(reason) }))
process.on('uncaughtException', (e) => { try { logEvent('error', 'uncaught-exception', { reason: e?.message, code: e?.code }) } catch { /* shutdown */ } })

const here = path.dirname(fileURLToPath(import.meta.url))
const resources = app.isPackaged ? process.resourcesPath : path.resolve(here, '..')
const setupUrl = pathToFileURL(path.join(here, '../ui/setup.html')).href
app.setName('WorkSpaceX')
if (!app.isPackaged && process.env.WSX_TEST_USER_DATA) app.setPath('userData', process.env.WSX_TEST_USER_DATA)
const root = app.getPath('userData')
let config, setup, workspace, runtime, secretValues, quitting = false, busy = false
let workspaceUrl = ''
let awake
let state = { phase: 'idle', text: 'Выберите, как использовать этот компьютер.', appReady: false, modelReady: false }
let lastProgress = 0
const addresses = () => [...new Set(Object.values(os.networkInterfaces()).flat().filter((x) => x && x.family === 'IPv4' && !x.internal).map((x) => x.address))]
function progress(update) {
  state = { ...state, ...update }
  if (update.phase || update.text) logEvent(update.phase === 'error' ? 'error' : 'info', 'phase', { phase: update.phase, reason: update.phase === 'error' ? update.text : undefined, step: update.phase === 'error' ? undefined : update.text })
  const now = Date.now()
  if (update.completed && now - lastProgress < 150) return
  lastProgress = now
  setup?.webContents.send('setup:progress', state)
}
async function openInstallLog(logFile) {
  if (!logFile) { await dialog.showMessageBox({ type: 'info', message: 'Журнал недоступен: каталог профиля не записывается.', detail: root }); return }
  const failed = await shell.openPath(logFile).catch(() => 'open failed')
  if (failed) await dialog.showMessageBox({ type: 'info', message: 'Журнал пока пуст или не создан.', detail: `Файл появится после первых событий: ${logFile}` })
}
async function publicState() {
  try {
    const space = await statfs(root)
    return { ...state, role: config?.role, configured: Boolean(config), ramGB: Math.round(os.totalmem() / 1073741824), freeGB: Math.floor(space.bavail * space.bsize / 1073741824), addresses: addresses(), platform: process.platform, url: config?.url, mailConfigured: Boolean(secretValues?.SONJJ_API_KEY), version: app.getVersion() }
  } catch (e) {
    logEvent('error', 'public-state-failed', { reason: e?.message, code: e?.code })
    throw e
  }
}
function secureSession(ses, target) {
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'))
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
  ses.setCertificateVerifyProc((request, callback) => {
    const ok = request.hostname === new URL(target.url).hostname && verifyPinned(request.certificate.data, target.pin, request.hostname)
    callback(ok ? 0 : -2)
  })
}
function localWizard() {
  if (setup && !setup.isDestroyed()) { setup.show(); setup.focus(); return }
  logEvent('info', 'wizard-open')
  setup = new BrowserWindow({ width: 980, height: 800, minWidth: 620, minHeight: 540, title: 'WorkSpaceX · Настройка', backgroundColor: '#070a0c', icon: path.join(here, '../assets/icon.ico'), autoHideMenuBar: false, webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  setup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  setup.webContents.on('will-navigate', (e, url) => { if (url !== setupUrl) e.preventDefault() })
  setup.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) logEvent(level >= 3 ? 'error' : 'warn', 'renderer-console', { reason: message, where: `${path.basename(String(source))}:${line}` })
  })
  setup.webContents.on('did-fail-load', (_e, code, desc) => logEvent('error', 'wizard-load-failed', { code, reason: desc }))
  setup.on('closed', () => { setup = null })
  void setup.loadURL(setupUrl)
}
async function openWorkspace() {
  if (!config || (config.role === 'host' && !runtime?.ready)) throw new Error('Приложение ещё запускается.')
  const target = config.role === 'host' ? { ...config, url: config.localUrl } : config
  await checkConnection(target)
  if (workspace && !workspace.isDestroyed()) { workspace.show(); workspace.focus(); return }
  const partition = `persist:wsx-${createHash('sha256').update(target.url + target.pin).digest('hex').slice(0, 20)}`
  const ses = session.fromPartition(partition)
  secureSession(ses, target)
  workspace = new BrowserWindow({ width: 1400, height: 900, minWidth: 760, minHeight: 580, title: 'WorkSpaceX', backgroundColor: '#030507', icon: path.join(here, '../assets/icon.ico'), webPreferences: { session: ses, preload: path.join(here, 'preload-workspace.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  workspaceUrl = target.url
  /* Ссылки писем (target="_blank" из sandbox-iframe) не создают окон:
     внешние http(s) уходят в браузер по умолчанию, всё остальное — отказ. */
  workspace.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') void shell.openExternal(u.href).catch((e) => logEvent('error', 'open-external-failed', { reason: e?.message, url: u.href }))
    } catch { /* некорректный URL — просто не создаём окно */ }
    return { action: 'deny' }
  })
  /* Тело письма — iframe about:srcdoc с sandbox без скриптов: событие ПКМ до
     React не доходит, пересылаем его в страницу для контекстного меню. */
  workspace.webContents.on('context-menu', (_e, params) => {
    if (params.frame?.url !== 'about:srcdoc' || workspace?.isDestroyed()) return
    workspace.webContents.send('workspacex:context-menu', {
      x: params.x,
      y: params.y,
      linkURL: params.linkURL || null,
      text: params.selectionText || '',
    })
  })
  workspace.webContents.on('will-navigate', (e, url) => { try { if (new URL(url).origin !== target.url) e.preventDefault() } catch { e.preventDefault() } })
  workspace.webContents.on('will-redirect', (e, url) => { if (new URL(url).origin !== target.url) e.preventDefault() })
  workspace.webContents.on('did-fail-load', (_e, code, _message, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { progress({ phase: 'error', text: 'Главный ПК недоступен. Проверьте, включена ли программа, адрес, общую сеть или VPN.' }); localWizard() }
  })
  workspace.on('closed', () => { workspace = null; if (!quitting) localWizard() })
  await workspace.loadURL(target.url)
  setup?.hide()
}
async function saveSecrets(values) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище Windows недоступно. Ключи не будут сохранены открытым текстом.')
  await atomicWrite(path.join(root, 'secrets.bin'), safeStorage.encryptString(JSON.stringify(values)))
  secretValues = values
}
async function startHost() {
  if (!secretValues) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не может расшифровать настройки в этой учётной записи.')
    secretValues = JSON.parse(safeStorage.decryptString(await readFile(path.join(root, 'secrets.bin'))))
  }
  if (!runtime) runtime = new HostRuntime({ root, resources, serverDir: path.join(resources, app.isPackaged ? 'server' : 'staging/server'), nodeExe: process.execPath, secrets: () => secretValues, progress })
  if (awake === undefined) awake = powerSaveBlocker.start('prevent-app-suspension')
  void runtime.start()
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, input) => {
    if (!setup || event.sender.id !== setup.webContents.id || event.senderFrame !== setup.webContents.mainFrame || event.senderFrame.url !== setupUrl) return { ok: false, error: 'Доступ запрещён.' }
    try { return { ok: true, data: await fn(input) } }
    catch (e) {
      logEvent('error', 'ipc-failed', { handler: name, reason: e?.message || String(e), code: e?.code })
      return { ok: false, error: e.message || 'Не удалось выполнить действие.' }
    }
  })
}

/* ============================================================
   МОСТ WORKSPACE-ОКНА (контракт §7 в .hermes/plans/2026-09-06-features.md)
   openExternal — только http(s); reveal/openPath — только внутри папки
   хранения из <AI_DIR>/cloud/storage-root.json. Вызовы принимает только
   workspace-окно. Страница зовёт это через preload-workspace.cjs.
   ============================================================ */
const AI_DIR = () => path.join(root, 'data') // тот же путь, что runtimeEnv отдаёт серверу
const storageRootFile = () => path.join(AI_DIR(), 'cloud', 'storage-root.json')

async function storageRoot() {
  let raw
  try { raw = JSON.parse(await readFile(storageRootFile(), 'utf8')) }
  catch { throw new Error('Папка хранения ещё не выбрана: укажите её в разделе «Общий диск».') }
  const dir = typeof raw?.root === 'string' ? raw.root.trim() : ''
  if (!dir) throw new Error('Папка хранения ещё не выбрана: укажите её в разделе «Общий диск».')
  return path.resolve(dir)
}

function assertInsideStorage(absPath, base) {
  const rel = path.relative(base, absPath)
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return
  throw new Error('Разрешены только пути внутри выбранной папки хранения.')
}

function handleWorkspace(name, fn) {
  ipcMain.handle(name, async (event, input) => {
    const trusted = workspace && !workspace.isDestroyed()
      && event.sender.id === workspace.webContents.id
      && event.senderFrame === workspace.webContents.mainFrame
      && workspaceUrl && event.senderFrame.url.startsWith(workspaceUrl)
    if (!trusted) return { ok: false, error: 'Доступ запрещён.' }
    try { return { ok: true, data: await fn(input) } }
    catch (e) {
      logEvent('error', 'ipc-failed', { handler: name, reason: e?.message || String(e), code: e?.code })
      return { ok: false, error: e.message || 'Не удалось выполнить действие.' }
    }
  })
}
function handlers() {
  handle('setup:state', publicState)
  handle('setup:create-host', async (input) => {
    if (config || busy) throw new Error('Настройка уже выполнена или выполняется. Существующие данные сохранены.')
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Установка главного ПК предназначена для Windows 10/11 x64.')
    const values = validateHostInput(input)
    logEvent('info', 'create-host', { step: 'form-validated' })
    const hardware = await publicState()
    if (hardware.ramGB < 8 || hardware.freeGB < 12) throw new Error('Для главного ПК нужно не менее 8 ГБ оперативной памяти и 12 ГБ свободного места.')
    busy = true
    try {
      const env = await runtimeEnv(resources, root)
      logEvent('info', 'create-host', { step: 'runtime-env-ok' })
      try { await access(path.join(root, 'data', 'users', 'users.json')); throw new Error('Найдены прежние данные установки. Восстановите её настройки; автоматический сброс запрещён.') } catch (e) { if (e.code !== 'ENOENT') throw e }
      const identity = await createCertificate(root, [env.WSX_LOOPBACK, 'localhost', values.host])
      logEvent('info', 'create-host', { step: 'certificate-ok' })
      await saveSecrets(newSecrets(values))
      logEvent('info', 'create-host', { step: 'secrets-saved' })
      const publicEnv = Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value.replaceAll('\\', '/'))}`).join('\n')
      await atomicWrite(path.join(root, '.env.local'), `${publicEnv}\n`)
      config = { version: 1, role: 'host', url: `https://${values.host}:${env.WSX_HTTPS_PORT}`, localUrl: `https://localhost:${env.WSX_HTTPS_PORT}`, pin: fingerprint(identity.cert) }
      await atomicWrite(path.join(root, 'connection.json'), JSON.stringify(config))
      logEvent('info', 'create-host', { step: 'connection-saved', role: 'host', url: config.url })
      await startHost()
      return await publicState()
    } finally { busy = false }
  })
  handle('setup:join', async (invite) => {
    if (config?.role === 'host' || busy) throw new Error('Этот ПК уже содержит общую базу или подключение выполняется.')
    busy = true
    try {
      const target = decodeInvite(invite)
      await checkConnection(target)
      config = { ...target, role: 'client' }
      await atomicWrite(path.join(root, 'connection.json'), JSON.stringify(config))
      workspace?.destroy(); workspace = null
      progress({ phase: 'ready', text: 'Главный ПК найден. Войдите с учётной записью, которую создал владелец.', appReady: true })
      return await publicState()
    } finally { busy = false }
  })
  handle('setup:retry', async () => {
    if (config?.role === 'host') await startHost()
    else if (config) { await checkConnection(config); progress({ phase: 'ready', text: 'Соединение восстановлено.', appReady: true }) }
    else throw new Error('Сначала заполните настройки.')
  })
  handle('setup:pause', () => runtime?.cancel())
  handle('setup:open', openWorkspace)
  handle('setup:copy-invite', () => { if (config?.role !== 'host') throw new Error('Приглашение создаётся на главном ПК.'); clipboard.writeText(encodeInvite(config)); return config.url })
  handle('setup:license', () => shell.openExternal('https://openrouter.ai/keys'))
  handle('setup:update-mail', async (input) => {
    if (config?.role !== 'host' || busy) throw new Error('Настройка доступна только на главном ПК.')
    if (!secretValues) throw new Error('Сначала восстановите доступ к защищённым настройкам Windows. Ключи не перезаписаны.')
    const key = String(input ?? '').trim()
    if (key.length < 8 || key.length > 4096 || /[\r\n\0]/.test(key)) throw new Error('Введите корректный ключ SmailPro.')
    busy = true
    try { await saveSecrets({ ...secretValues, SONJJ_API_KEY: key }); await runtime?.stop(); runtime = null; await startHost(); return true }
    finally { busy = false }
  })
  /* Мост workspace-окна: страница зовёт через window.workspacexDesktop (preload-workspace.cjs). */
  /* Выбор папки хранения: системный диалог «Выбрать каталог». Вызывается
     только из workspace-окна (cloud-section); отмена — null. */
  handleWorkspace('workspacex:pick-folder', async () => {
    const result = await dialog.showOpenDialog(workspace, { properties: ['openDirectory', 'createDirectory'], title: 'Выберите папку хранения' })
    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  handleWorkspace('workspacex:open-external', async (input) => {
    let u
    try { u = new URL(String(input ?? '').trim()) }
    catch { throw new Error('Некорректная ссылка.') }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Открыть можно только http(s)-ссылку.')
    const failed = await shell.openExternal(u.href)
    if (failed) throw new Error(String(failed))
    return true
  })
  handleWorkspace('workspacex:reveal', async (input) => {
    const base = await storageRoot()
    const p = path.resolve(String(input ?? '').trim())
    assertInsideStorage(p, base)
    if (process.platform === 'win32') spawn('explorer', [`/select,${p}`], { detached: true, stdio: 'ignore' }).unref()
    else shell.showItemInFolder(p)
    return true
  })
  handleWorkspace('workspacex:open-path', async (input) => {
    const base = await storageRoot()
    const p = path.resolve(String(input ?? '').trim())
    assertInsideStorage(p, base)
    const failed = await shell.openPath(p)
    if (failed) throw new Error(String(failed))
    return true
  })
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => localWizard())
  app.on('window-all-closed', async () => {
    if (quitting || config?.role !== 'host') { app.quit(); return }
    const answer = await dialog.showMessageBox({ type: 'question', buttons: ['Оставить включённым', 'Завершить'], defaultId: 0, cancelId: 0, message: 'Остановить общий сервер?', detail: 'Друг потеряет доступ к базе и ИИ до следующего запуска WorkSpaceX.' })
    if (answer.response === 1) app.quit(); else localWizard()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault(); quitting = true
    void (async () => { await runtime?.stop(); if (awake !== undefined) powerSaveBlocker.stop(awake); app.quit() })()
  })
  await app.whenReady()
  await mkdir(root, { recursive: true })
  const logFile = await initLogger(path.join(root, 'logs'))
  logEvent('info', 'app-start', { version: app.getVersion(), platform: `${process.platform}-${process.arch}` })
  config = await loadConfig(root).catch((e) => { logEvent('error', 'config-load-failed', { reason: e?.message, code: e?.code }); state = { ...state, phase: 'error', text: e.message }; return null })
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Программа', submenu: [
    { label: 'Настройка и подключение', click: localWizard },
    { label: 'Открыть WorkSpaceX', click: () => openWorkspace().catch((e) => { progress({ phase: 'error', text: e.message }); localWizard() }) },
    { label: 'Открыть журнал установки', click: () => { void openInstallLog(logFile) } },
    { type: 'separator' }, { label: 'Завершить работу', click: async () => {
      if (config?.role === 'host') {
        const answer = await dialog.showMessageBox({ type: 'question', buttons: ['Оставить включённым', 'Завершить'], defaultId: 0, cancelId: 0, message: 'Завершить работу главного ПК?', detail: 'Друг потеряет доступ к общей базе и ИИ, пока вы снова не запустите WorkSpaceX.' })
        if (answer.response !== 1) return
      }
      app.quit()
    } },
  ] }, { label: 'Правка', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }]))
  handlers(); localWizard()
  if (config?.role === 'host') await startHost().catch((e) => progress({ phase: 'error', text: e.message }))
  if (config?.role === 'client') {
    await checkConnection(config).then(() => progress({ phase: 'ready', text: 'Главный ПК доступен.', appReady: true })).catch(() => progress({ phase: 'error', text: 'Главный ПК недоступен. Проверьте, включён ли он и доступна ли сеть.' }))
  }
}