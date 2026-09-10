import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/* Регресс на баг «поверх письма легла плёнка»: на самом деле одно движение
   мышью по списку писем или Ctrl+A закрашивали выделением весь интерфейс —
   меню, полосу поиска, список и статусную строку. Выделяться должно только
   то, что человек копирует: письмо (оно в iframe), адрес ящика, тема,
   отправитель, дата и поля ввода. */

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

describe('выделение текста на экране почты', () => {
  const mailCss = read('app/styles/screen-mail.css')
  const shellCss = read('app/styles/shell.css')
  const bridge = read('components/mail/mail-frame-bridge.ts')

  it('оболочка экрана почты выделению не поддаётся', () => {
    const block = mailCss.slice(mailCss.indexOf('ВЫДЕЛЕНИЕ ТЕКСТА НА ЭКРАНЕ ПОЧТЫ'))
    expect(block).toContain('.mail-page {')
    expect(block).toContain('user-select: none')
  })

  it('адрес ящика, тема, отправитель и дата остаются копируемыми', () => {
    const block = mailCss.slice(mailCss.indexOf('ВЫДЕЛЕНИЕ ТЕКСТА НА ЭКРАНЕ ПОЧТЫ'))
    for (const sel of [
      "[data-testid='mail-temp-address']",
      '.mail-view-title h2',
      '.mail-view-who',
      '.mail-view-date',
    ]) {
      expect(block).toContain(sel)
    }
    expect(block).toContain('user-select: text')
  })

  it('меню, верхняя полоса и статусная строка не выделяются', () => {
    const block = shellCss.slice(shellCss.indexOf('ВЫДЕЛЕНИЕ ТЕКСТА В ОБОЛОЧКЕ'))
    expect(block).toContain('.app .sidebar')
    expect(block).toContain('.app .topbar')
    expect(block).toContain('.app .shell-statusbar')
    expect(block).toContain('user-select: none')
  })

  it('Ctrl+A выделяет письмо, а не весь интерфейс', () => {
    expect(bridge).toContain("wsxMailCmd: 'select-all'")
    expect(bridge).toContain('e.ctrlKey || e.metaKey')
    expect(bridge).toContain('e.preventDefault()')
    /* в полях ввода Ctrl+A остаётся обычным «выделить всё поле» */
    expect(bridge).toContain("el.tagName === 'INPUT'")
  })

  it('смена письма сбрасывает выделение, начатое в списке', () => {
    expect(bridge).toContain('sel.removeAllRanges()')
  })
})
