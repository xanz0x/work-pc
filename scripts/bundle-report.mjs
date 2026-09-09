#!/usr/bin/env node
/**
 * AR-2 · честный замер первого бандла.
 *
 * Turbopack-сборка Next 16 не пишет app-build-manifest и не печатает
 * «First Load JS», поэтому считаем то, что реально грузит браузер: поднимаем
 * прод-сервер, забираем HTML маршрута и суммируем все ассеты `/_next/static`,
 * на которые он ссылается (script/link/preload) — raw и gzip.
 *
 * Запуск: node scripts/bundle-report.mjs [порт]
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const PORT = Number(process.argv[2] ?? 3210)
const ROUTES = ['/', '/login']
const kb = (n) => (n / 1024).toFixed(1) + ' kB'

const server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT)], {
  cwd: process.cwd(),
  stdio: 'ignore',
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`)
      if (r.ok) return true
    } catch {
      /* ещё поднимается */
    }
    await wait(500)
  }
  return false
}

function sizeOf(asset) {
  const p = join(process.cwd(), '.next', asset.replace('/_next/', ''))
  if (!existsSync(p)) return null
  const buf = readFileSync(p)
  return { raw: buf.length, gz: gzipSync(buf).length }
}

try {
  if (!(await ready())) throw new Error('прод-сервер не поднялся')
  for (const route of ROUTES) {
    const html = await (await fetch(`http://127.0.0.1:${PORT}${route}`)).text()
    const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s>]+?\.(?:js|css)/g) ?? [])]
    const acc = { js: { raw: 0, gz: 0, n: 0 }, css: { raw: 0, gz: 0, n: 0 } }
    for (const a of assets) {
      const s = sizeOf(a)
      if (!s) continue
      const bucket = a.endsWith('.css') ? acc.css : acc.js
      bucket.raw += s.raw
      bucket.gz += s.gz
      bucket.n++
    }
    console.log(
      `${route.padEnd(8)} JS ${kb(acc.js.raw).padStart(10)} (gzip ${kb(acc.js.gz).padStart(9)}, ${acc.js.n} чанков)` +
        `   CSS ${kb(acc.css.raw).padStart(10)} (gzip ${kb(acc.css.gz).padStart(9)}, ${acc.css.n} файлов)` +
        `   ИТОГО gzip ${kb(acc.js.gz + acc.css.gz)}`,
    )
  }
} finally {
  server.kill('SIGTERM')
}
