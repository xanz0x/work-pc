import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AiMarkdown } from '@/components/chat/markdown'

describe('AiMarkdown', () => {
  it('рендерит текст ответа и сноски', () => {
    const html = renderToStaticMarkup(<AiMarkdown text={'Привет! Это **ответ** [1] модели.'} />)
    expect(html).toContain('Привет')
    expect(html).toContain('<strong>ответ</strong>')
    expect(html).toContain('aria-label="Источник 1"')
  })

  it('рендерит списки, таблицы и код', () => {
    const html = renderToStaticMarkup(
      <AiMarkdown text={'- пункт [2]\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst a = 1\n```'} />,
    )
    expect(html).toContain('пункт')
    expect(html).toContain('<table>')
    expect(html).toContain('const a = 1')
  })
})
