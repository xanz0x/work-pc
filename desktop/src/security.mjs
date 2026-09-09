import { X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import https from 'node:https'
import tls from 'node:tls'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import selfsigned from 'selfsigned'
import { atomicWrite } from './config.mjs'

export const fingerprint = (pem) => new X509Certificate(pem).fingerprint256.replaceAll(':', '').toLowerCase()
export function verifyPinned(pem, pin, host, now = Date.now()) {
  try {
    const cert = new X509Certificate(pem)
    return fingerprint(pem) === pin && Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) > now && Boolean(isIP(host) ? cert.checkIP(host) : cert.checkHost(host))
  } catch { return false }
}
export async function createCertificate(root, hosts) {
  const certFile = path.join(root, 'certificate.pem')
  const keyFile = path.join(root, 'private-key.pem')
  try { return { cert: await readFile(certFile, 'utf8'), key: await readFile(keyFile, 'utf8') } }
  catch (e) { if (e.code !== 'ENOENT') throw e }
  // Never silently rotate a certificate: friends have pinned its identity.
  for (const file of [certFile, keyFile]) {
    try { await readFile(file); throw new Error('Сертификат неполон. Восстановите пару certificate.pem / private-key.pem из резервной копии.') }
    catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'WorkSpaceX Main PC' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60_000),
    notAfterDate: new Date(Date.now() + 5 * 365 * 86400_000),
    extensions: [{ name: 'subjectAltName', altNames: [...new Set(hosts)].map((host) => isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }) }],
  })
  await atomicWrite(keyFile, pems.private)
  await atomicWrite(certFile, pems.cert)
  return { cert: pems.cert, key: pems.private }
}
export class PinnedAgent extends https.Agent {
  constructor(target) { super({ keepAlive: false }); this.target = target }
  createConnection(options, done) {
    let settled = false
    const finish = (error, socket) => { if (!settled) { settled = true; done(error, socket) } }
    const host = new URL(this.target.url).hostname
    const socket = tls.connect({ ...options, host, servername: isIP(host) ? undefined : host, rejectUnauthorized: false })
    socket.setTimeout(8000, () => socket.destroy(new Error('Главный ПК не отвечает. Проверьте адрес и сеть.')))
    socket.once('error', (e) => finish(e))
    socket.once('secureConnect', () => {
      if (!verifyPinned(socket.getPeerCertificate().raw, this.target.pin, host)) {
        socket.destroy(new Error('Сертификат главного ПК не совпадает с приглашением или истёк.'))
        return
      }
      socket.setTimeout(0)
      finish(null, socket)
    })
    // Do not return a socket until identity verification finishes.
  }
}
export async function checkConnection(target) {
  const agent = new PinnedAgent(target)
  try {
    return await new Promise((resolve, reject) => {
      const req = https.get(new URL('/__workspacex/health', target.url), { agent, timeout: 10000 }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk; if (body.length > 4096) req.destroy(new Error('Неверный ответ сервера.')) })
        res.on('end', () => {
          try { if (res.statusCode !== 200 || JSON.parse(body).protocol !== 'workspacex-desktop-v1') throw new Error(); resolve(true) }
          catch { reject(new Error('По этому адресу нет доступного сервера WorkSpaceX.')) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('Главный ПК не отвечает. Проверьте, включена ли программа.')))
    })
  } finally { agent.destroy() }
}