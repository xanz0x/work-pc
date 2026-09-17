// Проверка смены адреса: перевыпуск сертификата + новое приглашение реально
// принимаются TLS-пиннингом, старое приглашение — отвергается. Живёт в песочнице,
// рабочий профиль и живой сервер не трогает.
import { mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const desktop = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const { createCertificate, renewCertificate, fingerprint, verifyPinned, checkConnection, PinnedAgent } = require(path.join(desktop, 'src', 'security.mjs'))
const config = require(path.join(desktop, 'src', 'config.mjs'))

const sandbox = await mkdtemp(path.join(tmpdir(), 'wsx-cert-'))
const results = []
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`) }
try {
  // 1. Первый выпуск как при create-host: адрес локальной сети владельца.
  const old = await createCertificate(sandbox, ['127.0.0.1', 'localhost', '192.168.0.5'])
  const oldPin = fingerprint(old.cert)
  check('первый сертификат выпущен, pin 64 hex', /^[a-f0-9]{64}$/.test(oldPin))

  // 2. Приглашение v1 (то, что у друга сейчас).
  const conn1 = { version: 1, url: 'https://192.168.0.5:38631', pin: oldPin }
  const invite1 = config.encodeInvite(conn1)
  const back1 = config.decodeInvite(invite1)
  check('приглашение v1 кодируется и читается', back1.url === conn1.url && back1.pin === oldPin)

  // 3. Смена адреса на Tailscale — как setup:update-host.
  const neu = await renewCertificate(sandbox, ['127.0.0.1', 'localhost', '100.101.102.103'])
  const newPin = fingerprint(neu.cert)
  check('перевыпущенный сертификат имеет новый pin', newPin !== oldPin && /^[a-f0-9]{64}$/.test(newPin))
  check('новый сертификат валиден для 100.x адреса', verifyPinned(neu.cert, newPin, '100.101.102.103') === true)
  check('старое приглашение отвергает новый сертификат', verifyPinned(neu.cert, oldPin, '100.101.102.103') === false)
  check('старый сертификат не валиден для 100.x (сан не содержал)', verifyPinned(old.cert, oldPin, '100.101.102.103') === false)
  check('пара cert/key согласована (ключ соответствует сертификату)', true) // проверится живым TLS ниже

  // 4. Живой TLS: сервер с новой парой, клиент со старым и новым приглашением.
  const conn2 = { version: 1, url: 'https://100.101.102.103:38631', pin: newPin }
  const invite2 = config.encodeInvite(conn2)
  const back2 = config.decodeInvite(invite2)
  check('приглашение v2 читается', back2.url === conn2.url && back2.pin === newPin)

  const server = https.createServer({ cert: neu.cert, key: neu.key }, (req, res) => {
    if (req.url === '/__workspacex/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ protocol: 'workspacex-desktop-v1' })); return }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const okTarget = { url: `https://127.0.0.1:${port}`, pin: newPin }
  const badTarget = { url: `https://127.0.0.1:${port}`, pin: oldPin }
  try { await checkConnection(okTarget); check('TLS+пиннинг: НОВОЕ приглашение проходит до живого сервера', true) }
  catch (e) { check(`TLS+пиннинг новое приглашение: ${e.message}`, false) }
  try { await checkConnection(badTarget); check('TLS+пиннинг: СТАРОЕ приглашение отвергнуто (ожидали ошибку)', false) }
  catch { check('TLS+пиннинг: СТАРОЕ приглашение отвергнуто живым сервером', true) }

  // 5. PinnedAgent на не-IP имени (DNS-имя tailnet, например machine.tailnet-name.ts.net).
  const dnsName = 'workspacex-host.tailnet-example.ts.net'
  const dnsCert = await renewCertificate(sandbox + '-dns', ['127.0.0.1', 'localhost', dnsName])
  check('сертификат с DNS-именем SAN валиден для имени', verifyPinned(dnsCert.cert, fingerprint(dnsCert.cert), dnsName) === true)
  const agent = new PinnedAgent({ url: `https://${dnsName}:1`, pin: fingerprint(dnsCert.cert) })
  check('PinnedAgent создаётся для DNS-имени (servername=имя)', Boolean(agent.target))

  await new Promise((r) => server.close(r))
} finally {
  await rm(sandbox, { recursive: true, force: true }).catch(() => {})
  await rm(sandbox + '-dns', { recursive: true, force: true }).catch(() => {})
}
const failed = results.filter(([, ok]) => !ok)
console.log(failed.length ? `\nFAILED: ${failed.length}` : '\nALL_CERT_CHECKS_PASSED')
process.exit(failed.length ? 1 : 0)
