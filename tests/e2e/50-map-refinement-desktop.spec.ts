import { mkdirSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

const APP_URL = process.env.APP_URL
const APP_PASSWORD = process.env.APP_PASSWORD

const SHOTS_DIR = '/app/test_reports/screenshots_iter50'
mkdirSync(SHOTS_DIR, { recursive: true })

const VIEWPORTS = [
  { width: 1920, height: 800 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
] as const

const SCALES = [100, 125, 150] as const

test.skip(!APP_URL || !APP_PASSWORD, 'APP_URL и APP_PASSWORD обязательны')

async function newContextPage(
  browser: Browser,
  viewport: { width: number; height: number },
  scale: (typeof SCALES)[number],
) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  await skipOnboarding(page)
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('wf.ui.scale', String(s))
    } catch {
      // ignore private-mode storage issues
    }
  }, scale)

  return { context, page }
}

async function openMap(page: Page) {
  await page.goto(`${APP_URL}/`)
  await waitAppReady(page)
  await page.getByTestId('nav-map').click({ force: true })
  await expect(page.getByTestId('screen-map')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.waitForTimeout(1200)
}

async function assertCanvasNonBlank(page: Page) {
  const sampled = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement | null
    if (!c) return { ok: false, reason: 'canvas-missing' }
    const ctx = c.getContext('2d')
    if (!ctx) return { ok: false, reason: 'ctx-missing' }
    const stepX = Math.max(8, Math.floor(c.width / 10))
    const stepY = Math.max(8, Math.floor(c.height / 8))
    let nonZero = 0
    const uniq = new Set<string>()
    for (let y = 0; y < c.height; y += stepY) {
      for (let x = 0; x < c.width; x += stepX) {
        const d = ctx.getImageData(x, y, 1, 1).data
        if (d[0] !== 0 || d[1] !== 0 || d[2] !== 0 || d[3] !== 0) nonZero += 1
        uniq.add(`${d[0]}-${d[1]}-${d[2]}-${d[3]}`)
      }
    }
    return { ok: nonZero > 8 && uniq.size > 4, nonZero, uniq: uniq.size }
  })
  expect(sampled.ok, `canvas should be non-blank, got ${JSON.stringify(sampled)}`).toBeTruthy()
}

async function selectAnyRealNode(page: Page): Promise<boolean> {
  const box = await page.getByTestId('map-canvas').boundingBox()
  if (!box) return false

  const points = [
    { x: 0, y: 0 },
    { x: -140, y: -100 },
    { x: 160, y: -90 },
    { x: -170, y: 120 },
    { x: 180, y: 130 },
  ]

  for (const p of points) {
    await page.mouse.click(box.x + box.width / 2 + p.x, box.y + box.height / 2 + p.y)
    await page.waitForTimeout(260)
    const title = (await page.getByTestId('map-node-title').count())
      ? (await page.getByTestId('map-node-title').innerText()).trim()
      : ''
    if (title && title !== 'WORKSPACEX CORE') return true
  }

  const toggle = page.getByTestId('map-activity-toggle')
  await toggle.click({ force: true })
  await page.waitForTimeout(4200)
  const traces = page.locator('[data-testid^="map-trace-"]')
  if ((await traces.count()) > 0) {
    await traces.first().click({ force: true })
    await page.waitForTimeout(300)
    const title = (await page.getByTestId('map-node-title').innerText()).trim()
    return title !== 'WORKSPACEX CORE'
  }

  return false
}

test('map open/non-blank/animation/repeat transition and controls', async ({ browser }) => {
  test.setTimeout(180_000)
  const { context, page } = await newContextPage(browser, { width: 1920, height: 800 }, 100)

  await openMap(page)
  await assertCanvasNonBlank(page)

  const seq0 = Number((await page.getByTestId('map-flow-seq').innerText()).trim() || '0')
  const text0 = (await page.getByTestId('map-flow-text').innerText()).trim()
  await page.waitForTimeout(5200)
  const seq1 = Number((await page.getByTestId('map-flow-seq').innerText()).trim() || '0')
  const text1 = (await page.getByTestId('map-flow-text').innerText()).trim()
  expect(seq1 > seq0 || text1 !== text0).toBeTruthy()

  await page.getByTestId('nav-library').click({ force: true })
  await expect(page.getByTestId('nav-library')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('nav-map').click({ force: true })
  await expect(page.getByTestId('screen-map')).toBeVisible()
  await assertCanvasNonBlank(page)

  const z0 = Number((await page.getByTestId('map-zoom-level').innerText()).replace('%', '').trim())
  await page.getByTestId('map-zoom-in').click({ force: true })
  await page.waitForTimeout(200)
  const z1 = Number((await page.getByTestId('map-zoom-level').innerText()).replace('%', '').trim())
  expect(z1).toBeGreaterThan(z0)

  await page.getByTestId('map-zoom-out').click({ force: true })
  await page.waitForTimeout(200)
  const z2 = Number((await page.getByTestId('map-zoom-level').innerText()).replace('%', '').trim())
  expect(z2).toBeLessThan(z1 + 1)

  await page.keyboard.press('0')
  await expect(page.getByTestId('map-zoom-level')).toHaveText(/100%/)
  await page.keyboard.press('+')
  await page.waitForTimeout(180)
  await expect(page.getByTestId('map-zoom-level')).not.toHaveText(/100%/)
  await page.keyboard.press('-')
  await page.keyboard.press('f')
  await page.waitForTimeout(240)

  const filter = page.getByTestId('map-cluster-filter')
  await filter.click({ force: true })
  await page.waitForTimeout(200)
  await expect(page.getByTestId('map-cluster-filter-menu')).toBeVisible()
  const opts = page.locator('[data-testid^="map-cluster-filter-option-"]')
  expect(await opts.count()).toBeGreaterThan(0)

  const last = opts.last()
  await last.scrollIntoViewIfNeeded()
  const vp = page.viewportSize()!
  const lb = await last.boundingBox()
  expect(lb).not.toBeNull()
  if (lb) {
    expect(lb.x + lb.width).toBeLessThanOrEqual(vp.width + 2)
    expect(lb.y + lb.height).toBeLessThanOrEqual(vp.height + 2)
  }

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('map-cluster-filter-menu')).toBeHidden()

  await filter.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(220)

  const coreTitleNow = (await page.getByTestId('map-node-title').innerText()).trim()
  if (coreTitleNow !== 'WORKSPACEX CORE') {
    await page.getByTestId('map-inspector-close').click({ force: true })
    await expect(page.getByTestId('map-empty-state')).toBeVisible()
    await page.getByTestId('map-show-core').click({ force: true })
  }
  await expect(page.getByTestId('map-node-title')).toContainText('WORKSPACEX CORE')

  const coreClusters = page.locator('[data-testid^="map-core-cluster-"]')
  expect(await coreClusters.count()).toBeGreaterThan(0)
  await coreClusters.first().click({ force: true })
  await page.waitForTimeout(260)

  await page.getByTestId('map-inspector-close').click({ force: true })
  await expect(page.getByTestId('map-empty-state')).toBeVisible()
  await page.getByTestId('map-show-core').click({ force: true })
  await expect(page.getByTestId('map-node-title')).toContainText('WORKSPACEX CORE')

  const details = page.getByTestId('map-activity')
  await expect(details).not.toHaveAttribute('open', '')
  await page.getByTestId('map-activity-toggle').click({ force: true })
  await expect(details).toHaveAttribute('open', '')
  await page.getByTestId('map-activity-toggle').focus()
  await page.keyboard.press('Space')
  await expect(details).not.toHaveAttribute('open', '')
  await page.keyboard.press('Enter')
  await expect(details).toHaveAttribute('open', '')

  const picked = await selectAnyRealNode(page)
  expect(picked, 'failed to select real map node after click+trace attempts').toBeTruthy()

  const currentTitle = (await page.getByTestId('map-node-title').innerText()).trim()
  const neighbors = page.locator('[data-testid^="map-neighbor-"]')
  if ((await neighbors.count()) > 0) {
    await neighbors.first().click({ force: true })
    await page.waitForTimeout(260)
    const changed = (await page.getByTestId('map-node-title').innerText()).trim()
    expect(changed === currentTitle).toBeFalsy()
  }

  const actionParentCheck = await page.evaluate(() => {
    const actions = document.querySelector('[data-testid="map-node-actions"]') as HTMLElement | null
    const scroll = document.querySelector('[data-testid="map-inspector-content"]') as HTMLElement | null
    const inspector = document.querySelector('[data-testid="map-inspector"]') as HTMLElement | null
    if (!actions || !scroll || !inspector) return { ok: false, reason: 'missing-elements' }
    scroll.scrollTop = scroll.scrollHeight
    const inScroll = scroll.contains(actions)
    const a = actions.getBoundingClientRect()
    const i = inspector.getBoundingClientRect()
    return {
      ok: !inScroll && a.bottom <= i.bottom + 1,
      inScroll,
      aBottom: a.bottom,
      iBottom: i.bottom,
    }
  })
  expect(actionParentCheck.ok, JSON.stringify(actionParentCheck)).toBeTruthy()

  await page.getByTestId('map-open-node').click({ force: true })
  await expect(page.getByTestId('nav-library')).toHaveAttribute('aria-current', 'page')

  await page.getByTestId('nav-map').click({ force: true })
  await expect(page.getByTestId('screen-map')).toBeVisible()
  if ((await page.getByTestId('map-show-core').count()) === 0) {
    await page.getByTestId('map-inspector-close').click({ force: true })
    await expect(page.getByTestId('map-empty-state')).toBeVisible()
  }
  await page.getByTestId('map-show-core').click({ force: true })
  await page.getByTestId('map-open-cluster').click({ force: true })
  await expect(page.getByTestId('nav-library')).toHaveAttribute('aria-current', 'page')
  const filesLayer = page.getByRole('button', { name: 'Файлы', exact: true })
  if (await filesLayer.isVisible()) await filesLayer.click({ force: true })
  const clusterButtons = page.locator('.filters[aria-label="Кластеры файлов"] button')
  let allChip = clusterButtons.filter({ hasText: /^Всё\s+\d+/ }).first()
  if ((await allChip.count()) === 0) {
    allChip = clusterButtons.filter({ hasText: /^Все\s+\d+/ }).first()
  }
  await expect(
    allChip,
  ).toHaveAttribute('aria-pressed', 'true')

  await context.close()
})

for (const viewport of VIEWPORTS) {
  for (const scale of SCALES) {
    test(`map desktop layout matrix @ ${viewport.width}x${viewport.height} z${scale}`, async ({ browser }) => {
      test.setTimeout(120_000)
      const { context, page } = await newContextPage(browser, viewport, scale)
      await openMap(page)

      const geo = await page.evaluate(() => {
        const r = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect() ?? null
        const toolbar = r('[data-testid="map-toolbar"]')
        const inspector = r('[data-testid="map-inspector"]')
        const footer = r('[data-testid="map-footer"]')
        const html = document.documentElement
        const overlaps = {
          toolbarInspector:
            !!toolbar &&
            !!inspector &&
            toolbar.left < inspector.right &&
            toolbar.right > inspector.left &&
            toolbar.top < inspector.bottom &&
            toolbar.bottom > inspector.top,
          toolbarFooter:
            !!toolbar && !!footer && toolbar.left < footer.right && toolbar.right > footer.left && toolbar.top < footer.bottom && toolbar.bottom > footer.top,
          inspectorFooter:
            !!inspector &&
            !!footer &&
            inspector.left < footer.right &&
            inspector.right > footer.left &&
            inspector.top < footer.bottom &&
            inspector.bottom > footer.top,
        }
        return {
          toolbar,
          inspector,
          footer,
          overlaps,
          horizontalOverflow: html.scrollWidth > html.clientWidth + 1,
        }
      })

      expect(geo.toolbar).not.toBeNull()
      expect(geo.inspector).not.toBeNull()
      expect(geo.footer).not.toBeNull()
      expect(geo.overlaps.toolbarInspector, `overlap TI at ${viewport.width}x${viewport.height} z${scale}`).toBeFalsy()
      expect(geo.overlaps.toolbarFooter, `overlap TF at ${viewport.width}x${viewport.height} z${scale}`).toBeFalsy()
      expect(geo.overlaps.inspectorFooter, `overlap IF at ${viewport.width}x${viewport.height} z${scale}`).toBeFalsy()
      expect(geo.horizontalOverflow, `horizontal overflow at ${viewport.width}x${viewport.height} z${scale}`).toBeFalsy()

      const metricTops = await page.locator('.ni-m-val').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
      expect(Math.abs(metricTops[0] - metricTops[1]), 'metric values should align').toBeLessThanOrEqual(2)

      await page.getByTestId('map-cluster-filter').click({ force: true })
      await page.waitForTimeout(200)
      const options = page.locator('[data-testid^="map-cluster-filter-option-"]')
      expect(await options.count()).toBeGreaterThan(0)
      const lastOption = options.last()
      await lastOption.scrollIntoViewIfNeeded()
      const lb = await lastOption.boundingBox()
      expect(lb).not.toBeNull()
      if (lb) {
        expect(lb.x).toBeGreaterThanOrEqual(0)
        expect(lb.x + lb.width).toBeLessThanOrEqual(viewport.width + 2)
        expect(lb.y + lb.height).toBeLessThanOrEqual(viewport.height + 2)
      }
      await page.keyboard.press('Escape')

      if (viewport.width === 1280 && viewport.height === 720 && scale === 150) {
        await page.screenshot({
          path: `${SHOTS_DIR}/map-1280x720-z150.jpeg`,
          type: 'jpeg',
          quality: 40,
          fullPage: false,
        })
      }

      await context.close()
    })
  }
}

test('map long-text DOM stress does not break inspector width or action access', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await newContextPage(browser, { width: 1280, height: 720 }, 150)
  await openMap(page)

  const picked = await selectAnyRealNode(page)
  expect(picked).toBeTruthy()

  for (const unbroken of [false, true]) {
  const longCheck = await page.evaluate((unbroken) => {
    const longA = unbroken ? 'ОченьДлинноеИмяБезПробелов'.repeat(16) + '.pdf' : 'ДЛИННОЕ ИМЯ '.repeat(22) + 'X'
    const longB = 'meta '.repeat(80)
    const title = document.querySelector('[data-testid="map-node-title"]') as HTMLElement | null
    const meta = document.querySelector('[data-testid="map-node-meta"]') as HTMLElement | null
    const neighbor = document.querySelector('[data-testid^="map-neighbor-"] .ni-link-name') as HTMLElement | null
    if (title) title.textContent = longA
    if (meta) meta.textContent = longB
    if (neighbor) neighbor.textContent = `${longA} ${longA}`

    const inspector = document.querySelector('[data-testid="map-inspector"]') as HTMLElement | null
    const checks: string[] = []
    for (const sel of ['[data-testid="map-node-title"]', '[data-testid="map-node-meta"]', '.ni-link-name']) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) continue
      if (el.scrollWidth - el.clientWidth > 1 && getComputedStyle(el).overflowX !== 'visible') {
        checks.push(`clip:${sel}`)
      }
      const r = el.getBoundingClientRect()
      const ir = inspector?.getBoundingClientRect()
      if (ir && r.right > ir.right + 1) checks.push(`overflow-right:${sel}`)
    }

    const hittable = (id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
      if (!el || !inspector) return false
      const r = el.getBoundingClientRect()
      const ir = inspector.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return r.width > 0 && r.top >= ir.top && r.bottom <= ir.bottom && r.bottom <= innerHeight && !!hit && el.contains(hit)
    }
    return {
      checks,
      closeVisible: hittable('map-inspector-close'),
      openClusterVisible: hittable('map-open-cluster'),
      openNodeVisible: hittable('map-open-node'),
    }
  }, unbroken)

  expect(longCheck.checks, `layout stress issues: ${JSON.stringify(longCheck)}`).toEqual([])
  expect(longCheck.closeVisible).toBeTruthy()
  expect(longCheck.openClusterVisible).toBeTruthy()
  expect(longCheck.openNodeVisible).toBeTruthy()
  }

  await context.close()
})
