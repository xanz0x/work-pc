// Живая проверка всей цепочки: новый адрес в Tailscale-сети, новый сертификат,
// пиннинг приглашения, шлюз, Next, логин-страница. Ничего не пишет в профиль.
import https from 'node:https'
import tls from 'node:tls'
import { readFile } from 'node:fs/promises'
import { parse } from 'dotenv'
import path from 'node:path'

const appdata = process.env.APPDATA
const env = parse(await readFile(path.join(appdata, 'WorkSpaceX', '.env.local'), 'utf8').catch(() => readFile(path.join(process.env.LOCALAPPDATA, 'Programs/WorkSpaceX/resources', 'runtime.env'), 'utf8')))
const conn = JSON.parse(await readFile(path.join(appdata, 'WorkSpaceX', 'connection.json'), 'utf8'))
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const url = new URL(conn.url)
const PORT = url.port || env.WSX_HTTPS_PORT
const HOST = url.hostname

function healthFetch(target, label, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get({ host: target.host, port: PORT, path: '/__workspacex/health', rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ label, ok: res.statusCode === 200 && body.includes('workspacex-desktop-v1'), via: target.host }))
    })
    req.on('error', (e) => resolve({ label, ok: false, err: e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ label, ok: false, err: 'timeout' }) })
  })
}

// 1. Шлюз по tailscale-адресу (сетевой уровень, TLS без пиннинга)
const r1 = await healthFetch({ host: HOST }, 'шлюз по ' + HOST)
check(r1.label, r1.ok)

// 2. Шлюз по localhost (локальный уровень жив)
const r2 = await healthFetch({ host: '127.0.0.1' }, 'шлюз по 127.0.0.1 (локально)')
check(r2.label, r2.ok)

// 3. Пиннинг: реальный хендшейк с проверкой сертификата как у друга
const { PinnedAgent, checkConnection, fingerprint } = await import('file://' + path.join(process.env.LOCALAPPDATA, 'Programs/WorkSpaceX/resources/app.asar').replace('app.asar', 'noop.js')).catch(() => ({}))
// asar не импортируется напрямую — проверяем пиннинг средствами node против живого сертификата:
const cert = await new Promise((resolve, reject) => {
  const socket = tlsConnectShort(HOST, PORT)
  socket.on('secureConnect', () => { resolve(socket.getPeerCertificate()); socket.end() })
  socket.on('error', reject)
})
function tlsConnectShort(host, port) {
  return tls.connect({ host, port, rejectUnauthorized: false })
}
const livePin = (cert.fingerprint256 || '').replaceAll(':', '').toLowerCase()
check('живой сертификат получен с ' + HOST, Boolean(livePin), livePin.slice(0, 16) + '…')
check('PIN в connection.json совпадает с живым сертификатом (приглашение рабочее)', livePin === conn.pin)

// 4. Строгая TLS-проверка имени (то, что делает Electron у друга)
const nameOk = cert.subject ? true : false
const { X509Certificate } = await import('node:crypto')
const x509 = new X509Certificate(cert.raw)
check('сертификат валиден для IP ' + HOST, Boolean(x509.checkIP(HOST)))

// 5. Next за шлюзом: страница логина отдаётся
await new Promise((resolve) => {
  const req = https.get({ host: HOST, port: PORT, path: '/login', rejectUnauthorized: false, timeout: 15000 }, (res) => {
    let n = 0
    res.on('data', (c) => { n += c.length })
    res.on('end', () => { check('страница логина /login через шлюз (' + HOST + ')', res.statusCode === 200, `${res.statusCode}, ${n} байт`); resolve() })
  })
  req.on('error', (e) => { check('страница логина /login через шлюз', false, e.message); resolve() })
  req.on('timeout', () => { req.destroy(); check('страница логина /login через шлюз', false, 'timeout'); resolve() })
})

const failed = results.filter((x) => !x).length
console.log(failed ? `\nFAILED: ${failed}` : '\nALL_LIVE_CHECKS_PASSED')
process.exit(failed ? 1 : 0)
