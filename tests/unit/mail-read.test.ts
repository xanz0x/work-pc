/* ПОЧТА · фаза 2: чистая логика чтения — страницы, порядок папок, санитайзер HTML, слияние страниц. */

import { describe, expect, it } from 'vitest'
import { mergeRows } from '@/lib/mail-format'
import { sanitizeMailHtml } from '@/lib/mail-html'
import { folderLabel, pageRange, sortFolders } from '@/lib/mail-read'

describe('pageRange · от новых к старым', () => {
  it('первая страница берёт хвост ящика', () => {
    expect(pageRange(100, null, 30)).toEqual({ start: 71, end: 100, nextCursor: 71 })
  })
  it('курсор продолжает вниз и заканчивается на первом письме', () => {
    expect(pageRange(100, 71, 30)).toEqual({ start: 41, end: 70, nextCursor: 41 })
    expect(pageRange(100, 11, 30)).toEqual({ start: 1, end: 10, nextCursor: null })
  })
  it('пустой ящик и курсор за границей', () => {
    expect(pageRange(0, null, 30)).toEqual({ start: 0, end: 0, nextCursor: null })
    expect(pageRange(5, 1, 30)).toEqual({ start: 0, end: 0, nextCursor: null })
  })
  it('лимит ограничен сверху и снизу', () => {
    expect(pageRange(500, null, 999).start).toBe(451)
    expect(pageRange(500, null, 0).start).toBe(471)
    expect(pageRange(500, null, -3).start).toBe(500)
  })
  it('курсор больше размера ящика (письма удалили) — просто хвост', () => {
    expect(pageRange(10, 999, 30)).toEqual({ start: 1, end: 10, nextCursor: null })
  })
})

describe('sortFolders · INBOX первым, служебные по смыслу, остальные по алфавиту', () => {
  it('порядок', () => {
    const list = sortFolders([
      { path: 'Work', specialUse: null },
      { path: 'Trash', specialUse: '\\Trash' },
      { path: 'Sent', specialUse: '\\Sent' },
      { path: 'INBOX', specialUse: null },
      { path: 'Archive', specialUse: null },
      { path: 'Drafts', specialUse: '\\Drafts' },
    ]).map((f) => f.path)
    expect(list).toEqual(['INBOX', 'Drafts', 'Sent', 'Trash', 'Archive', 'Work'])
  })
  it('подписи по-русски для служебных папок', () => {
    expect(folderLabel({ path: 'INBOX', name: 'INBOX', specialUse: null })).toBe('Входящие')
    expect(folderLabel({ path: '[Gmail]/Sent Mail', name: 'Sent Mail', specialUse: '\\Sent' })).toBe('Отправленные')
    expect(folderLabel({ path: 'Work/2026', name: '2026', specialUse: null })).toBe('2026')
  })
})

describe('sanitizeMailHtml · скрипты и активное содержимое вырезаются', () => {
  it('script, iframe, form, on*, javascript: — удалены; текст и стили — остались', () => {
    const out = sanitizeMailHtml(`
      <html><head><style>p{color:red} @import url(x.css);</style><script>alert(1)</script></head>
      <body onload="x()"><p style="color:blue" onclick="evil()">Привет</p>
      <a href="javascript:alert(1)">bad</a><a href="https://example.com" target="_blank">ok</a>
      <img src="https://t.example/pix.gif" onerror="x()">
      <iframe src="https://evil"></iframe><form action="/x"><input name="a"></form>
      <object data="x"></object><!-- comment --></body></html>`)
    expect(out).not.toMatch(/<script|<iframe|<form|<input|<object|onload|onclick|onerror|javascript:|@import|<!--/i)
    expect(out).toContain('<p style="color:blue">Привет</p>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('<a>bad</a>')
    expect(out).toContain('<img src="https://t.example/pix.gif">')
    expect(out).toContain('<style>p{color:red} </style>')
  })
  it('обфусцированный javascript: и data: не картинка — тоже нет', () => {
    const out = sanitizeMailHtml(`<a href="  JaVaScRiPt&#58;alert(1)">x</a><a href="data:text/html;base64,AAAA">y</a><img src="data:image/png;base64,iVBOR">`)
    expect(out).toBe('<a>x</a><a>y</a><img src="data:image/png;base64,iVBOR">')
  })
  it('SVG и MathML вырезаются целиком, теги приводятся к нижнему регистру', () => {
    expect(sanitizeMailHtml('<DIV CLASS="a"><svg onload="x()"><circle/></svg>ok</DIV>')).toBe('<div class="a">ok</div>')
  })
  it('style с expression/behavior выбрасывается', () => {
    expect(sanitizeMailHtml('<p style="width:expression(alert(1))">a</p>')).toBe('<p>a</p>')
  })
})

describe('mergeRows · свежая страница поверх загруженных', () => {
  const r = (uid: number, seen = false) => ({ uid, seen })
  it('новые сверху, флаги обновлены, старые страницы сохранены', () => {
    const old = [r(10), r(9), r(8), r(7), r(6)]
    const fresh = [r(12), r(11), r(10, true), r(9)]
    expect(mergeRows(fresh, old)).toEqual([r(12), r(11), r(10, true), r(9), r(8), r(7), r(6)])
  })
  it('пустая свежая страница — папку опустошили', () => {
    expect(mergeRows([], [r(1)])).toEqual([])
  })
})
