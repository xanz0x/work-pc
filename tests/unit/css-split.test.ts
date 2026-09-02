/* ============================================================
   AR-2 · РАЗРЕЗ CSS ПРОВЕРЯЕТСЯ ТЕСТОМ, А НЕ ГЛАЗАМИ
   Слои экранов работают только при двух условиях: порядок слоёв объявлен
   в базе, и в ленивые файлы не уехало ни одно правило каркаса. Оба
   условия здесь и закреплены — вместе с тем, что после разреза не
   потерялось ни одного объявления монолита.
   ============================================================ */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const STYLES = join(ROOT, 'app', 'styles')

const base = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')
const screenFiles = readdirSync(STYLES).filter((f) => f.startsWith('screen-') && f.endsWith('.css'))
const screens = screenFiles.map((f) => ({ name: f, css: readFileSync(join(STYLES, f), 'utf8') }))

const layerNames = (css: string) => new Set(css.match(/@layer\s+(wf\d{3})\s*\{/g) ?? [])

/** Нормализуем в набор объявлений: пробелы и слои не считаем. */
function statements(css: string): string[] {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@layer [^{;]*;/g, '')
    .replace(/@layer\s+wf\d{3}\s*\{/g, '{')
  return clean
    .split(/[;{}]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

describe('AR-2 · разрез globals.css', () => {
  it('экранные слои есть и в базе объявлен их порядок', () => {
    expect(screenFiles.sort()).toEqual([
      'screen-activity.css',
      'screen-chat.css',
      'screen-library.css',
      'screen-map.css',
      'screen-settings.css',
      'screen-vault.css',
    ])

    const declaration = base.match(/@layer\s+(wf\d{3}(?:,\s*wf\d{3})*)\s*;/)
    expect(declaration, 'база обязана объявлять порядок слоёв').not.toBeNull()
    const declared = new Set(declaration![1].split(',').map((s) => s.trim()))

    for (const { name, css } of screens) {
      const used = [...layerNames(css)].map((s) => s.replace(/@layer\s+|\s*\{/g, ''))
      expect(used.length, `${name}: правила обязаны жить в слое`).toBeGreaterThan(0)
      for (const layer of used) {
        expect(declared.has(layer), `${name}: слой ${layer} не объявлен в globals.css`).toBe(true)
      }
    }
  })

  it('ни одно правило каркаса не уехало в ленивый файл', () => {
    /* Каркас рендерится всегда: его классы обязаны остаться в базе. */
    const shellClasses = ['app', 'sidebar', 'topbar', 'statusbar', 'nav-item', 'lock-layer', 'cmdk']
    for (const { name, css } of screens) {
      for (const cls of shellClasses) {
        const own = new RegExp(`(^|[\\s,>+~])\\.${cls}[\\s,{:.]`, 'm')
        expect(own.test(css), `${name}: правило каркаса .${cls} должно жить в базе`).toBe(false)
      }
    }
  })

  it('после разреза не потерялось ни одного объявления монолита', () => {
    const mono = statements(readFileSync(join(STYLES, '_monolith.css'), 'utf8'))
    const after = new Set(statements(base + screens.map((s) => s.css).join('\n')))
    const lost = mono.filter((s) => !after.has(s))
    expect(lost).toEqual([])
  })
})
