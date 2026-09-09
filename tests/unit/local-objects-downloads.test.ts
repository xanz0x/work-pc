import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { downloadVerified } from '@/desktop/src/downloads.mjs'
import { getLocalObject, putLocalObject } from '@/lib/local-objects'

function streamOf(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('desktop local objects and verified download', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stores bytes under opaque SHA256 filename (no path traversal)', async () => {
    const aiDir = await mkdtemp(path.join(tmpdir(), 'wsx-ai-'))
    process.env.AI_DIR = aiDir
    const key = '../..\\evil\\CON?.txt'
    const payload = new TextEncoder().encode('hello-local')
    await putLocalObject(key, payload)
    const hash = createHash('sha256').update(key).digest('hex')
    const blobFile = path.join(aiDir, 'cloud', 'objects', `${hash}.blob`)
    const saved = await readFile(blobFile)
    expect(saved.toString('utf8')).toBe('hello-local')
    const readBack = await getLocalObject(key)
    expect(new Uint8Array(readBack.data)).toEqual(payload)
  })

  it('downloadVerified resumes with Range and keeps verified bytes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wsx-dl-'))
    const file = path.join(dir, 'ollama.zip.part')
    const full = Buffer.from('ABCDEFGHIJ', 'utf8')
    await writeFile(file, full.subarray(0, 4))
    const manifest = {
      url: 'https://github.com/ollama/ollama/releases/download/v1.2.3/ollama-windows-amd64.zip',
      sha256: createHash('sha256').update(full).digest('hex'),
      size: full.length,
    }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Range).toBe('bytes=4-')
      return {
        ok: true,
        status: 206,
        headers: { get: (name: string) => name.toLowerCase() === 'content-range' ? 'bytes 4-9/10' : null },
        body: streamOf([new Uint8Array(full.subarray(4))]),
      }
    }))
    await downloadVerified(manifest, file, undefined, () => {})
    expect(await readFile(file)).toEqual(full)
  })

  it('downloadVerified removes file on checksum mismatch', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wsx-dl-bad-'))
    const file = path.join(dir, 'ollama.zip.part')
    const bytes = Buffer.from('bad-content', 'utf8')
    const manifest = {
      url: 'https://github.com/ollama/ollama/releases/download/v1.2.3/ollama-windows-amd64.zip',
      sha256: '0'.repeat(64),
      size: bytes.length,
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: streamOf([new Uint8Array(bytes)]),
    })))
    await expect(downloadVerified(manifest, file, undefined, () => {})).rejects.toThrow(/Контрольная сумма/)
  })
})
