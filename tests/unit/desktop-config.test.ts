import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { atomicWrite, decodeInvite, encodeInvite, runtimeEnv, validateHostInput } from '../../desktop/src/config.mjs'

describe('desktop config: host/invite/env validation', () => {
  it('accepts valid host input and normalizes login+host', () => {
    const out = validateHostInput({
      login: 'Admin.User',
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      host: ' LOCALHOST ',
      mailKey: 'abcd1234',
      acceptLicense: true,
    })
    expect(out.login).toBe('admin.user')
    expect(out.host).toBe('localhost')
  })

  it('rejects malformed hosts/invites (http, credentials, path, bad pin)', () => {
    expect(() => validateHostInput({ login: 'admin', password: '123456789012', confirmPassword: '123456789012', host: 'https://host/a', acceptLicense: true })).toThrow()
    const badHttp = `WSX1-${Buffer.from(JSON.stringify({ version: 1, url: 'http://localhost:38631', pin: 'a'.repeat(64) })).toString('base64url')}`
    const badCreds = `WSX1-${Buffer.from(JSON.stringify({ version: 1, url: 'https://u:p@localhost:38631', pin: 'a'.repeat(64) })).toString('base64url')}`
    const badPath = `WSX1-${Buffer.from(JSON.stringify({ version: 1, url: 'https://localhost:38631/path', pin: 'a'.repeat(64) })).toString('base64url')}`
    const badPin = `WSX1-${Buffer.from(JSON.stringify({ version: 1, url: 'https://localhost:38631', pin: 'zz' })).toString('base64url')}`
    for (const invite of [badHttp, badCreds, badPath, badPin, 'WSX1-not-base64']) {
      expect(() => decodeInvite(invite)).toThrow()
    }
  })

  it('encodes and decodes a strict allowlisted invite', () => {
    const original = { version: 1, url: 'https://localhost:38631', pin: 'b'.repeat(64) }
    const encoded = encodeInvite(original)
    const decoded = decodeInvite(encoded)
    expect(decoded).toEqual(original)
  })

  it('atomicWrite replaces content without leaving temp artifacts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wsx-config-'))
    const file = path.join(dir, 'connection.json')
    await atomicWrite(file, 'one')
    await atomicWrite(file, 'two')
    expect(await readFile(file, 'utf8')).toBe('two')
    const leftovers = (await readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('runtimeEnv validates required keys and returns computed paths', async () => {
    const resources = await mkdtemp(path.join(tmpdir(), 'wsx-res-'))
    const root = await mkdtemp(path.join(tmpdir(), 'wsx-root-'))
    await writeFile(path.join(resources, 'runtime.env'), [
      'WSX_HTTPS_PORT=38631',
      'WSX_NEXT_PORT=38632',
      'WSX_LOOPBACK=127.0.0.1',
      'WSX_LISTEN_HOST=0.0.0.0',
      'OLLAMA_HOST=127.0.0.1:38633',
      'OLLAMA_URL=http://127.0.0.1:38633',
      'OLLAMA_MODEL=qwen2.5:3b',
      'OLLAMA_NUM_CTX=8192',
      'OLLAMA_KEEP_ALIVE=5m',
    ].join('\n'))
    const env = await runtimeEnv(resources, root)
    expect(env.AI_DIR).toBe(path.join(root, 'data'))
    expect(env.OLLAMA_MODELS).toBe(path.join(root, 'models'))
  })
})
