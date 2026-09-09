import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { checkConnection, createCertificate, fingerprint, verifyPinned } from '../../desktop/src/security.mjs'

const servers: https.Server[] = []
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
  servers.length = 0
})

describe('desktop security: cert generation, pinning, health checks', () => {
  it('creates real selfsigned cert and reuses existing pair', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wsx-cert-'))
    const first = await createCertificate(root, ['127.0.0.1', 'localhost'])
    const second = await createCertificate(root, ['127.0.0.1', 'localhost'])
    expect(first.cert).toBe(second.cert)
    expect(first.key).toBe(second.key)
    expect(fingerprint(first.cert)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('verifyPinned validates exact SHA256, host and cert lifetime window', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wsx-pin-'))
    const identity = await createCertificate(root, ['127.0.0.1'])
    const pin = fingerprint(identity.cert)
    expect(verifyPinned(identity.cert, pin, '127.0.0.1')).toBe(true)
    expect(verifyPinned(identity.cert, '0'.repeat(64), '127.0.0.1')).toBe(false)
    expect(verifyPinned(identity.cert, pin, 'localhost')).toBe(false)
    expect(verifyPinned(identity.cert, pin, '127.0.0.1', 0)).toBe(false)
  })

  it('checkConnection succeeds with correct pin and fails with wrong pin', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wsx-health-'))
    const identity = await createCertificate(root, ['127.0.0.1'])
    const server = https.createServer({ key: identity.key, cert: identity.cert }, (req, res) => {
      if (req.url === '/__workspacex/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ protocol: 'workspacex-desktop-v1' }))
      } else {
        res.writeHead(404)
        res.end('nope')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    servers.push(server)
    const port = (server.address() as { port: number }).port

    await expect(checkConnection({ url: `https://127.0.0.1:${port}`, pin: fingerprint(identity.cert) })).resolves.toBe(true)
    await expect(checkConnection({ url: `https://127.0.0.1:${port}`, pin: 'f'.repeat(64) })).rejects.toThrow()
  })
})
