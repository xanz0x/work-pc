import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/* Регресс: в инспекторе файла было две панели управления файлом —
   одна внутри блока «Моя папка на ПК / Общий диск», вторая внизу.
   Осталась одна, нижняя. */

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

describe('инспектор файла: одно меню действий', () => {
  const src = read('components/library-file-inspector.tsx')

  it('панель действий в разметке ровно одна', () => {
    expect(src.match(/className="insp-actions"/g)?.length ?? 0).toBe(1)
  })

  it('в блоке облака остались только пояснения, без кнопок', () => {
    const start = src.indexOf('data-testid="insp-cloud"')
    const end = src.indexOf("tab === 'details'")
    const block = src.slice(start, end)
    expect(block).not.toContain('<button')
    expect(block).not.toContain('btn-full')
  })

  it('нижняя панель умеет всё, что нужно файлу', () => {
    const acts = src.slice(src.indexOf('className="insp-actions"'))
    for (const label of [
      'Просмотр файла',
      'Скачать',
      'Открыть на ПК',
      'Показать в папке',
      'Показать на карте',
      'общую папку',
      'Удалить из сейфа',
    ]) {
      expect(acts).toContain(label)
    }
  })
})
