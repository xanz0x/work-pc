import { describe, expect, it } from 'vitest'
import { chunkText, keywordsOf, CHUNK_SIZE } from '@/lib/indexer/chunk'
import { extractText, extOf, isTextExt } from '@/lib/indexer/extract'
import { contentText, pdfText, readableRatio } from '@/lib/indexer/pdf'
import { idOfPath, processFile, sha256Hex } from '@/lib/indexer/pipeline'
import { searchAll } from '@/lib/search'

const enc = (s: string) => new TextEncoder().encode(s)

describe('индексатор: чанки', () => {
  it('короткий текст остаётся одним чанком', () => {
    expect(chunkText('привет мир')).toEqual(['привет мир'])
  })

  it('длинный текст режется с перекрытием и без потери слов', () => {
    const para = 'Договор аренды офиса подписан двенадцатого февраля. '
    const text = para.repeat(120)
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= CHUNK_SIZE + 40)).toBe(true)
    /* Ни один чанк не начинается с обрубка слова. */
    expect(chunks.every((c) => /^[\p{L}\p{N}]/u.test(c))).toBe(true)
  })

  it('пустой текст чанков не даёт', () => {
    expect(chunkText('   \n  ')).toEqual([])
  })
})

describe('индексатор: ключевые слова', () => {
  it('частотные слова поднимаются наверх, стоп-слова отбрасываются', () => {
    const kw = keywordsOf('аренда аренда аренда офис офис который который который который')
    expect(kw[0]).toBe('аренда')
    expect(kw).not.toContain('который')
  })
})

describe('индексатор: извлечение текста', () => {
  it('расширение и признак текстового формата', () => {
    expect(extOf('смета_офис.XLSX')).toBe('xlsx')
    expect(isTextExt('md')).toBe(true)
    expect(isTextExt('xlsx')).toBe(false)
  })

  it('markdown читается как текст', async () => {
    const out = await extractText('заметки.md', enc('# Идеи\nбюджет офиса'))
    expect(out.text).toContain('бюджет')
    expect(out.noText).toBeUndefined()
  })

  it('бинарник помечается честно, а не выдаёт мусор', async () => {
    const out = await extractText('фото.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]))
    expect(out.text).toBe('')
    expect(out.noText).toBe('binary')
  })

  it('пустой файл — отдельная причина', async () => {
    expect((await extractText('пусто.txt', new Uint8Array())).noText).toBe('empty')
  })
})

/** Минимальный PDF с несжатым контент-потоком: текстовый слой есть. */
function makePdf(text: string): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const body = `%PDF-1.4\n1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`
  return enc(body)
}

describe('индексатор: PDF без зависимостей', () => {
  it('текстовый слой извлекается из контент-потока', async () => {
    const text = await pdfText(makePdf('Договор аренды офиса 2026'))
    expect(text).toContain('Договор аренды офиса 2026')
  })

  it('скан без текстового слоя даёт пустую строку, а не мусор', async () => {
    const scan = enc('%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Length 4 >>\nstream\n\x00\x01\x02\x03\nendstream\n%%EOF')
    expect(await pdfText(scan)).toBe('')
  })

  it('зашифрованный документ не разбирается', async () => {
    const encrypted = enc('%PDF-1.6\n<< /Encrypt 9 0 R >>\ntrailer\n<< /Encrypt 9 0 R >>\n%%EOF')
    expect(await pdfText(encrypted)).toBe('')
  })

  it('операторы показа текста собираются в порядке чтения', () => {
    const out = contentText(enc('BT (Смета) Tj 0 -14 Td (Итог 1,24 млн) Tj ET'))
    expect(out.replace(/\s+/g, ' ').trim()).toBe('Смета Итог 1,24 млн')
  })

  it('читаемость мусора ниже порога', () => {
    expect(readableRatio('обычный текст')).toBeGreaterThan(0.9)
    expect(readableRatio('\u0001\u0002\u0003\u0004')).toBeLessThan(0.3)
  })
})

describe('индексатор: конвейер файла', () => {
  it('id стабилен по пути, хеш — по содержимому', async () => {
    const a = await idOfPath('docs/аренда.txt')
    const b = await idOfPath('docs/аренда.txt')
    const c = await idOfPath('docs/другой.txt')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(await sha256Hex(enc('a'))).not.toBe(await sha256Hex(enc('b')))
  })

  it('запись содержит настоящие числа, а не заглушки', async () => {
    const { record, entry, chunks } = await processFile({
      path: 'docs/аренда.txt',
      name: 'аренда.txt',
      size: 40,
      mtime: 1_700_000_000_000,
      bytes: enc('Договор аренды офиса, бюджет и смета на ремонт помещения.'),
    })
    expect(record.textLen).toBeGreaterThan(20)
    expect(record.chunks).toBe(chunks.length)
    expect(record.keywords).toContain('аренды')
    expect(entry.text).toContain('смета')
    expect(record.noText).toBeUndefined()
  })

  it('изменение содержимого меняет хеш при том же пути', async () => {
    const base = { path: 'a.txt', name: 'a.txt', size: 3, mtime: 1 }
    const first = await processFile({ ...base, bytes: enc('раз') })
    const second = await processFile({ ...base, bytes: enc('два') })
    expect(first.record.id).toBe(second.record.id)
    expect(first.record.hash).not.toBe(second.record.hash)
  })
})

describe('поиск по содержимому (NF-1, шаг 6)', () => {
  const files = [
    { id: 'f1', icon: 'doc', cluster: 'docs', name: 'файл-один.txt', desc: '', bytes: 10, date: 'сегодня' },
    { id: 'f2', icon: 'doc', cluster: 'docs', name: 'файл-два.txt', desc: '', bytes: 10, date: 'сегодня' },
  ] as never

  const content = new Map([
    ['f1', { text: 'смета на ремонт помещения', keywords: ['смета', 'ремонт'] }],
    ['f2', { text: 'протокол разногласий', keywords: ['протокол'] }],
  ])

  it('слово из текста находит файл, которого нет в имени', () => {
    const hits = searchAll('ремонт', 'all', { files, notes: [], sessions: [], now: 0, content })
    expect(hits.filter((h) => h.kind === 'file').map((h) => h.id)).toEqual(['f1'])
  })

  it('файл под ключом по содержимому не находится (redact)', () => {
    const hits = searchAll('ремонт', 'all', {
      files,
      notes: [],
      sessions: [],
      now: 0,
      content,
      redactIds: new Set(['f1']),
    })
    expect(hits.filter((h) => h.kind === 'file')).toHaveLength(0)
  })

  it('режим «только имена» содержимое не читает', () => {
    const hits = searchAll('ремонт', 'names', { files, notes: [], sessions: [], now: 0, content })
    expect(hits.filter((h) => h.kind === 'file')).toHaveLength(0)
  })
})
