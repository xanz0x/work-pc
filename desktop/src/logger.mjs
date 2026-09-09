// Diagnostics journal of installation and setup: one JSON line per event.
// Only allowlisted fields are written — no passwords, keys or user content,
// mirroring the PII rules of lib/log.ts on the web-server side.
import { createWriteStream } from 'node:fs'
import { mkdir, stat, rename } from 'node:fs/promises'
import path from 'node:path'

export const ALLOWED_FIELDS = ['phase', 'reason', 'code', 'where', 'step', 'role', 'version', 'platform', 'ms', 'count', 'handler', 'url']
const MAX_FIELD = 500
let stream = null

export async function initLogger(logsDir) {
  try {
    await mkdir(logsDir, { recursive: true })
    const file = path.join(logsDir, 'setup.log')
    try { if ((await stat(file)).size > 5 * 1024 * 1024) await rename(file, `${file}.old`) } catch { /* first run */ }
    stream = createWriteStream(file, { flags: 'a' })
    stream.on('error', () => { stream = null })
    return file
  } catch { stream = null; return null }
}

export function logEvent(level, event, fields = {}) {
  if (!stream) return
  const entry = { t: new Date().toISOString(), level, event }
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key]
    if (value !== undefined && value !== null && value !== '') entry[key] = String(value).slice(0, MAX_FIELD)
  }
  try { stream.write(`${JSON.stringify(entry)}\n`) } catch { stream = null }
}
