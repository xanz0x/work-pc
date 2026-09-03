/* Разбор первого бандла по чанкам: какие ассеты /_next/static тянет маршрут.
   Запуск: node scripts/chunk-sizes.mjs [порт запущенного прод-сервера] */
import { existsSync, statSync } from 'node:fs'

const port = process.argv[2] ?? '3000'
for (const route of ['/login', '/']) {
  const html = await (await fetch(`http://127.0.0.1:${port}${route}`)).text()
  const urls = [...new Set(html.match(/\/_next\/static\/[^"' )\\]+/g) ?? [])]
  const rows = urls
    .map((u) => ['/app/.next' + u.slice('/_next'.length), u])
    .filter(([p]) => existsSync(p))
    .map(([p, u]) => [statSync(p).size, u])
    .sort((a, b) => b[0] - a[0])
  console.log('==', route, `(${rows.length} ассетов)`)
  for (const [s, u] of rows.slice(0, 14)) console.log(`${(s / 1024).toFixed(1).padStart(8)} kB  ${u}`)
}
