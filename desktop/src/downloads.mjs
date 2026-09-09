import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { once } from 'node:events'

export async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function downloadVerified(manifest, file, signal, progress) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.-]+\/[\w.-]+\.zip$/.test(manifest.url) || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.size) || manifest.size <= 0) throw new Error('Некорректный манифест загрузки.')
  await mkdir(path.dirname(file), { recursive: true })
  let offset = await stat(file).then((s) => s.size).catch(() => 0)
  if (offset > manifest.size) { await rm(file); offset = 0 }
  if (offset < manifest.size) {
    const response = await fetch(manifest.url, { signal, headers: offset ? { Range: `bytes=${offset}-` } : {} })
    if (!response.ok || !response.body) throw new Error(`Не удалось скачать движок (HTTP ${response.status}). Повторите — загруженная часть сохранена.`)
    if (response.status === 206) {
      if (!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('Сервер вернул неверный диапазон загрузки.')
    } else offset = 0
    const out = createWriteStream(file, { flags: offset ? 'a' : 'w', mode: 0o600 })
    let outputError
    out.on('error', (e) => { outputError = e })
    try {
      for await (const chunk of response.body) {
        signal?.throwIfAborted()
        if (outputError) throw outputError
        offset += chunk.length
        if (offset > manifest.size) throw new Error('Размер загрузки не совпадает с проверенным манифестом.')
        if (!out.write(chunk)) await once(out, 'drain')
        progress({ phase: 'download', text: 'Загрузка файла', completed: offset, total: manifest.size })
      }
      await new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve) })
    } catch (e) { out.destroy(); throw e }
  }
  signal?.throwIfAborted()
  progress({ phase: 'verify', text: 'Проверка SHA-256…' })
  if ((await stat(file)).size !== manifest.size || await sha256File(file) !== manifest.sha256) {
    await rm(file, { force: true })
    throw new Error('Контрольная сумма не совпала. Непроверенный файл удалён.')
  }
}
