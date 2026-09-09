/** Desktop shared-drive bytes: opaque filenames, never a user-supplied disk path. */
import { promises as fs } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'

function objectFile(key: string): string {
  const root = process.env.AI_DIR
  if (!root) throw new Error('AI_DIR is required')
  return path.join(root, 'cloud', 'objects', `${createHash('sha256').update(key).digest('hex')}.blob`)
}
export async function putLocalObject(key: string, data: Uint8Array) {
  const target = objectFile(key)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const space = await fs.statfs(path.dirname(target))
  if (space.bavail * space.bsize < data.byteLength + 64 * 1024 * 1024) throw new Error('Недостаточно свободного места на главном ПК.')
  const tmp = `${target}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, data, { mode: 0o600, flag: 'wx' })
    await fs.rename(tmp, target)
  } finally { await fs.rm(tmp, { force: true }) }
  return { path: key, size: data.byteLength }
}
export async function getLocalObject(key: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const buffer = await fs.readFile(objectFile(key))
  return { data: Uint8Array.from(buffer).buffer, contentType: 'application/octet-stream' }
}