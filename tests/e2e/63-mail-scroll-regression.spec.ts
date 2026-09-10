import { expect, test, type Page } from '@playwright/test'
import { skipOnboarding } from './onboard'
import { waitAppReady } from './ready'

type Viewport = { width: number; height: number; label: string }

const VIEWPORTS: Viewport[] = [
  { width: 1920, height: 800, label: 'desktop-wide' },
  { width: 1280, height: 800, label: 'desktop-narrow' },
  { width: 390, height: 800, label: 'mobile' },
]

const now = Date.now()

const longHtmlHidden = (important: boolean) => {
  const force = important ? ' !important' : ''
  const rows = Array.from({ length: 95 }, (_, i) => `<p id="p-${i + 1}">Параграф ${i + 1}: длинный текст для прокрутки.</p>`).join('')
  return `
    <style>
      html,body{height:100%;overflow:hidden${force}}
      .prehead{display:none;max-height:0;overflow:hidden;opacity:0;color:transparent}
      .block{padding:6px 0}
    </style>
    <div class="prehead" id="preheader">THIS SHOULD STAY HIDDEN</div>
    <h1>Длинное письмо</h1>
    <p id="lead">Начало письма c <a id="cta" href="https://example.com/confirm?token=abc">ссылкой подтверждения</a>.</p>
    <img id="pic" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="dot">
    ${rows}
    <p id="last">LAST PARAGRAPH MARKER</p>
    <script>window.__senderExecuted = 1</script>
  `
}

const longText = Array.from({ length: 120 }, (_, i) => `Строка ${i + 1} plain text message.`).join('\n')

async function mockMailRoutes(page: Page) {
  await page.route('**/ai-api/mail/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path.endsWith('/ai-api/mail/accounts')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          accounts: [
            {
              id: 'acc-fixture',
              name: 'QA Inbox',
              email: 'qa@example.com',
              provider: 'imap',
              smtp: { host: 'smtp.example.com', port: 587, security: 'starttls' },
              imap: { host: 'imap.example.com', port: 993, security: 'ssl' },
              user: 'qa@example.com',
              discovery: { source: 'manual', at: now },
              status: { smtp: 'ok', imap: 'ok', checkedAt: now },
              imapSync: { at: now, unseen: 2, total: 2 },
              createdAt: now,
              sentCount: 0,
              lastSentAt: null,
            },
          ],
        }),
      })
      return
    }

    if (path.endsWith('/ai-api/mail/temp')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          smailpro: true,
          boxes: [
            {
              id: 'temp-fixture',
              kind: 'mailtm',
              address: 'fixture@mail.test',
              createdAt: now,
              expiresAt: now + 60_000,
              lastSyncAt: now,
              count: 2,
            },
          ],
        }),
      })
      return
    }

    if (path.endsWith('/ai-api/mail/accounts/acc-fixture/messages')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          folder: 'INBOX',
          total: 2,
          nextCursor: null,
          syncedAt: now,
          folders: [
            { path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: null, total: 2, unseen: 2 },
          ],
          rows: [
            {
              uid: 1001,
              seq: 2,
              subject: 'Long HTML with !important',
              from: { name: 'Sender', address: 'sender@example.com' },
              to: [{ name: 'QA', address: 'qa@example.com' }],
              date: new Date(now).toISOString(),
              size: 24567,
              seen: false,
              flagged: false,
              answered: false,
              hasAttachments: false,
            },
            {
              uid: 1002,
              seq: 1,
              subject: 'Long plain text',
              from: { name: 'Sender', address: 'sender@example.com' },
              to: [{ name: 'QA', address: 'qa@example.com' }],
              date: new Date(now - 1000).toISOString(),
              size: 8123,
              seen: false,
              flagged: false,
              answered: false,
              hasAttachments: false,
            },
          ],
        }),
      })
      return
    }

    if (path.endsWith('/ai-api/mail/accounts/acc-fixture/messages/1001')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: {
            uid: 1001,
            subject: 'Long HTML with !important',
            from: { name: 'Sender', address: 'sender@example.com' },
            to: [{ name: 'QA', address: 'qa@example.com' }],
            cc: [],
            replyTo: [],
            date: new Date(now).toISOString(),
            size: 24567,
            seen: true,
            flagged: false,
            answered: false,
            folder: 'INBOX',
            html: longHtmlHidden(true),
            text: null,
            attachments: [],
            truncated: false,
          },
        }),
      })
      return
    }

    if (path.endsWith('/ai-api/mail/accounts/acc-fixture/messages/1002')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: {
            uid: 1002,
            subject: 'Long plain text',
            from: { name: 'Sender', address: 'sender@example.com' },
            to: [{ name: 'QA', address: 'qa@example.com' }],
            cc: [],
            replyTo: [],
            date: new Date(now - 1000).toISOString(),
            size: 8123,
            seen: true,
            flagged: false,
            answered: false,
            folder: 'INBOX',
            html: null,
            text: longText,
            attachments: [],
            truncated: false,
          },
        }),
      })
      return
    }

    if (path.endsWith('/ai-api/mail/temp/temp-fixture/inbox')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          syncedAt: now,
          box: {
            id: 'temp-fixture',
            kind: 'mailtm',
            address: 'fixture@mail.test',
            createdAt: now,
            expiresAt: now + 60_000,
            lastSyncAt: now,
            count: 2,
          },
          rows: [
            { mid: 'tmp-long', subject: 'Temp long html hidden root', from: 'Sender', date: new Date(now).toISOString(), intro: 'Long HTML fixture' },
            { mid: 'tmp-short', subject: 'Temp short html', from: 'Sender', date: new Date(now - 1000).toISOString(), intro: 'Short HTML fixture' },
          ],
        }),
      })
      return
    }

    if (path.endsWith('/ai-api/mail/temp/temp-fixture/messages/tmp-long')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: {
            mid: 'tmp-long',
            subject: 'Temp long html hidden root',
            from: 'sender@example.com',
            date: new Date(now).toISOString(),
            html: longHtmlHidden(false),
            text: null,
          },
        }),
      })
      return
    }

    if (path.endsWith('/ai-api/mail/temp/temp-fixture/messages/tmp-short')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: {
            mid: 'tmp-short',
            subject: 'Temp short html',
            from: 'sender@example.com',
            date: new Date(now - 1000).toISOString(),
            html: '<div><h2>Short</h2><p id="short-end">Короткое письмо</p></div>',
            text: null,
          },
        }),
      })
      return
    }

    if (path.includes('/flags') && route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uid: 1001, seen: true, flagged: false }) })
      return
    }

    await route.continue()
  })
}

async function scrollToLastParagraphByWheel(page: Page, frameTestId: string, lastSelector = '#last') {
  const host = page.getByTestId(frameTestId)
  await expect(host).toBeVisible()
  await host.scrollIntoViewIfNeeded()
  const box = await host.boundingBox()
  expect(box).toBeTruthy()
  if (!box) return

  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 160))
  const frame = page.frameLocator(`[data-testid="${frameTestId}"]`)
  await expect(frame.locator(lastSelector)).toBeVisible({ timeout: 15_000 })
  await frame.locator('body').click({ position: { x: 20, y: 20 } })

  // A visible iframe border alone is not a readable message (mobile regression).
  expect(await host.evaluate(el => el.clientHeight)).toBeGreaterThan(100)

  let reached = false
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, 560)
    await page.waitForTimeout(80)
    const rect = await frame.locator(lastSelector).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight }
    })
    if (rect.top < rect.vh && rect.bottom > 0) {
      reached = true
      break
    }
  }
  expect(reached, 'wheel should bring LAST paragraph into iframe viewport').toBe(true)
  await page.screenshot({ path: `test_reports/mail-scroll-${frameTestId}-${page.viewportSize()?.width}.jpeg`, quality: 20, fullPage: false })
}

async function expectFrameBottom(page: Page, frameTestId: string) {
  await expect.poll(async () => page.frameLocator(`[data-testid="${frameTestId}"]`).locator('html').evaluate(() => {
    const root = document.scrollingElement!
    return Math.abs(root.scrollHeight - innerHeight - root.scrollTop)
  })).toBeLessThan(3)
}

async function assertIframeSafetyAndFormatting(page: Page, frameTestId: string) {
  const frame = page.frameLocator(`[data-testid="${frameTestId}"]`)

  const hidden = await frame.locator('#preheader').evaluate((el) => {
    const st = getComputedStyle(el)
    return {
      display: st.display,
      maxHeight: st.maxHeight,
      opacity: st.opacity,
    }
  })
  expect(hidden.display).toBe('none')
  expect(hidden.opacity).toBe('0')

  const imgWidth = await frame.locator('#pic').evaluate((el) => (el as HTMLImageElement).naturalWidth)
  expect(imgWidth).toBeGreaterThan(0)

  await frame.locator('#cta').scrollIntoViewIfNeeded()
  await frame.locator('#cta').click({ button: 'right' })
  await expect(page.getByTestId('mail-ctx-menu')).toBeVisible()
  await expect(page.getByTestId('mail-ctx-copy-link')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mail-ctx-menu')).toBeHidden()

  const senderScriptExecuted = await frame.locator('body').evaluate(() => (window as Window & { __senderExecuted?: number }).__senderExecuted ?? 0)
  expect(senderScriptExecuted).toBe(0)
}

for (const vp of VIEWPORTS) {
  test(`mail scroll guard: temp + account viewers (${vp.label})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await mockMailRoutes(page)

    await skipOnboarding(page)
    await page.goto('/')
    await waitAppReady(page)
    await page.getByTestId('nav-mail').click()
    await expect(page.getByTestId('mail-screen')).toBeVisible()

    // ---- MailMsgView (обычный ящик) ----
    await page.getByTestId('mail-account-row-acc-fixture').click()
    await page.getByTestId('mail-msg-open-1001').click()
    await expect(page.getByTestId('mail-msg-view-frame')).toBeVisible()

    await scrollToLastParagraphByWheel(page, 'mail-msg-view-frame')
    await assertIframeSafetyAndFormatting(page, 'mail-msg-view-frame')

    // Keyboard scroll inside focused iframe.
    await page.frameLocator('[data-testid="mail-msg-view-frame"]').locator('#lead').click()
    await page.keyboard.press('PageDown')
    await page.waitForTimeout(100)
    await page.keyboard.press('End')
    await expectFrameBottom(page, 'mail-msg-view-frame')

    // Switch message and verify scroll reset on new open.
    await page.getByTestId('mail-msg-open-1002').click()
    await expect(page.getByTestId('mail-msg-view-subject')).toContainText('Long plain text')
    const plain = page.frameLocator('[data-testid="mail-msg-view-frame"]').locator('pre.plain')
    await expect(plain).toContainText('Строка 120 plain text message.')
    await plain.click({ position: { x: 20, y: 20 } })
    await page.keyboard.press('End')
    await expectFrameBottom(page, 'mail-msg-view-frame')
    await page.getByTestId('mail-msg-open-1001').click()
    const topAfterSwitch = await page.frameLocator('[data-testid="mail-msg-view-frame"]').locator('body').evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement
      return root.scrollTop
    })
    expect(topAfterSwitch).toBeLessThan(30)

    // ---- MailTempPane (временный ящик) ----
    await page.getByTestId('mail-temp-row-temp-fixture').click()
    await page.getByTestId('mail-temp-open-tmp-long').click()
    await expect(page.getByTestId('mail-temp-frame')).toBeVisible()

    await scrollToLastParagraphByWheel(page, 'mail-temp-frame')
    await assertIframeSafetyAndFormatting(page, 'mail-temp-frame')

    // Scroll back to top and ensure body starts near top.
    await page.mouse.wheel(0, -9_000)
    await page.waitForTimeout(120)
    const topAfterBack = await page.frameLocator('[data-testid="mail-temp-frame"]').locator('body').evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement
      return root.scrollTop
    })
    expect(topAfterBack).toBeLessThan(20)

    await page.getByTestId('mail-temp-open-tmp-short').click()
    await expect(page.frameLocator('[data-testid="mail-temp-frame"]').locator('#short-end')).toBeVisible()
  })
}
