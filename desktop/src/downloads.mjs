import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, access, rename, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { atomicWrite } from './config.mjs'

export async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function downloadVerified(manifest, file, signal, progress) {
  if (!/^https:\/\/github\.com\/ollama\/ollama\/releases\/download\/v[\d.]+\/ollama-windows-amd64\.zip$/.test(manifest.url) || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.size) || manifest.size <= 0) throw new Error('Некорректный манифест движка.')
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
        progress({ phase: 'engine-download', text: 'Скачивание движка Ollama', completed: offset, total: manifest.size })
      }
      await new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve) })
    } catch (e) { out.destroy(); throw e }
  }
  signal?.throwIfAborted()
  progress({ phase: 'verify', text: 'Проверка SHA-256 движка…' })
  if ((await stat(file)).size !== manifest.size || await sha256File(file) !== manifest.sha256) {
    await rm(file, { force: true })
    throw new Error('Контрольная сумма не совпала. Непроверенный движок удалён и не будет запущен.')
  }
}
export async function ensureEngine(resources, root, signal, progress) {
  const manifest = JSON.parse(await readFile(path.join(resources, 'ollama-release.json'), 'utf8'))
  const dir = path.join(root, 'runtime', manifest.version)
  const exe = path.join(dir, 'ollama.exe')
  try {
    const saved = JSON.parse(await readFile(path.join(dir, 'verified.json'), 'utf8'))
    if (saved.sha256 === manifest.sha256) { await access(exe); return exe }
  } catch { /* first install or interrupted extraction */ }
  if (process.platform !== 'win32') throw new Error('Автоустановка Ollama предназначена для Windows x64.')
  const archive = path.join(root, 'downloads', `ollama-${manifest.version}.zip.part`)
  const archiveZip = archive.slice(0, -5)
  // A previous attempt may have verified and renamed the archive before failing to extract.
  try { await access(archiveZip); await rename(archiveZip, archive) } catch { /* nothing to recover */ }
  await downloadVerified(manifest, archive, signal, progress)
  signal?.throwIfAborted()
  const staging = `${dir}.extracting`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  progress({ phase: 'extract', text: 'Распаковка проверенного движка…' })
  // Expand-Archive accepts only the .zip extension (NotSupportedArchiveFileExtension for .part).
  await rename(archive, archiveZip)
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:WSX_ARCHIVE -DestinationPath $env:WSX_EXTRACT -Force"], {
      windowsHide: true, stdio: 'ignore', signal,
      env: { ...process.env, WSX_ARCHIVE: archiveZip, WSX_EXTRACT: staging },
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Не удалось распаковать движок. Проверьте свободное место и повторите.')))
  })
  await access(path.join(staging, 'ollama.exe'))
  await atomicWrite(path.join(staging, 'verified.json'), JSON.stringify({ sha256: manifest.sha256 }))
  await rm(dir, { recursive: true, force: true })
  await rename(staging, dir)
  await rm(archiveZip, { force: true })
  return exe
}
export async function ensureModel(env, signal, progress) {
  const tags = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal }).then((r) => r.json())
  if (tags.models?.some((m) => m.name === env.OLLAMA_MODEL)) return
  const response = await fetch(`${env.OLLAMA_URL}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.OLLAMA_MODEL, stream: true }), signal })
  if (!response.ok || !response.body) throw new Error('Не удалось начать скачивание модели. Проверьте интернет.')
  const dec = new TextDecoder(); let buf = ''; let complete = false
  const parse = (line) => {
    if (!line.trim()) return
    const part = JSON.parse(line)
    if (part.error) throw new Error(`Загрузка модели прервана: ${part.error}`)
    if (part.status === 'success') complete = true
    progress({ phase: 'model-download', text: `Модель ${env.OLLAMA_MODEL}: ${part.status}`, completed: part.completed, total: part.total })
  }
  for await (const chunk of response.body) { buf += dec.decode(chunk, { stream: true }); const lines = buf.split('\n'); buf = lines.pop(); for (const line of lines) parse(line) }
  parse(buf + dec.decode())
  if (!complete) throw new Error('Загрузка модели не завершена. Повторите — Ollama продолжит скачивание.')
}