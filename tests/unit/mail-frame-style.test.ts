import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAIL_FRAME_SCROLL_STYLE } from '@/lib/mail-frame-style'

describe('mail-frame scroll style guard', () => {
  it('forces root scrolling and does not touch inner content selectors', () => {
    expect(MAIL_FRAME_SCROLL_STYLE).toContain('html:root')
    expect(MAIL_FRAME_SCROLL_STYLE).toContain('overflow: auto !important')
    expect(MAIL_FRAME_SCROLL_STYLE).toContain('html:root > body')
    expect(MAIL_FRAME_SCROLL_STYLE).toContain('overflow: visible !important')
    expect(MAIL_FRAME_SCROLL_STYLE).not.toMatch(/table|img|a\s*\{/)
  })

  it('is injected in both viewers before bridge script', () => {
    const tempPane = readFileSync(path.join(process.cwd(), 'components/mail/mail-temp-pane.tsx'), 'utf8')
    const msgView = readFileSync(path.join(process.cwd(), 'components/mail/mail-msg-view.tsx'), 'utf8')

    expect(tempPane).toContain('${MAIL_FRAME_SCROLL_STYLE}${bridgeTag()}')
    expect(msgView).toContain('${MAIL_FRAME_SCROLL_STYLE}${bridgeTag()}')
  })
})
