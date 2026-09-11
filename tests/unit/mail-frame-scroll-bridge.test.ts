import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAIL_BRIDGE } from '@/components/mail/mail-frame-bridge'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

describe('прокрутка открытого письма', () => {
  it('мост отдаёт наружу высоту письма и дельту колеса', () => {
    expect(MAIL_BRIDGE).toContain("post('size'")
    expect(MAIL_BRIDGE).toContain("post('wheel'")
    expect(MAIL_BRIDGE).toContain('ResizeObserver')
  })

  it('страница подгоняет высоту iframe под содержимое в обоих просмотрщиках', () => {
    for (const f of ['components/mail/mail-temp-pane.tsx', 'components/mail/mail-msg-view.tsx']) {
      const src = read(f)
      expect(src).toContain('frameHeight')
      expect(src).toContain('style={frameHeight ? { height: `${frameHeight}px` } : undefined}')
    }
  })

  it('контейнер письма прокручивается сам', () => {
    const css = read('app/styles/screen-mail.css')
    const body = css.slice(css.indexOf('.mail-view-body {'), css.indexOf('.mail-frame {'))
    expect(body).toContain('overflow-y: auto')
  })
})
