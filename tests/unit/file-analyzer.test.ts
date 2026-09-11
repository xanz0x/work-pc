/* ============================================================
   ЮНИТ-ТЕСТЫ КОНВЕЙЕРА АНАЛИЗА ФАЙЛОВ
   Чистые парсеры на fixture-строках, без настоящей модели:
   ZIP собирается в памяти через adm-zip, DOCX подменяется mock'ом,
   ответы модели — строки с JSON и мусором.
   ============================================================ */

import { describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(async ({ buffer }: { buffer: Buffer }) => ({
      value: `RAW:${buffer.length}`,
    })),
  },
}))

import {
  buildAnalysisMessages,
  decodeTextUtf8,
  detectKind,
  descriptionFromLines,
  DESCRIBE_SYSTEM,
  docxText,
  exifSummary,
  humanSize,
  imageExif,
  MAX_BYTES_FULL,
  parseTitleDescription,
  pdfText,
  titleFromName,
  truncateText,
  zipOverview,
  ZIP_MAX_ENTRY_BYTES,
  ZIP_MAX_TEXT_ENTRIES,
  zipSample,
} from '@/lib/file-analyzer'

const buildZip = (files: { name: string; data: string | Buffer }[]): Buffer => {
  const zip = new AdmZip()
  for (const f of files) zip.addFile(f.name, Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'))
  return zip.toBuffer()
}

describe('detectKind: тип по mime/расширению', () => {
  const cases: Array<[string, string, string]> = [
    ['report.pdf', 'application/pdf', 'pdf'],
    ['REPORT.PDF', 'application/octet-stream', 'pdf'],
    ['anything.bin', 'application/pdf', 'pdf'], // однозначный mime сильнее расширения
    ['документ.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['archive.zip', 'application/zip', 'archive'],
    ['archive.zip', 'application/octet-stream', 'archive'], // ext спасает при общем mime
    ['photo.jpg', 'image/jpeg', 'image'],
    ['shot.heic', '', 'image'],
    ['vector.svg', 'image/svg+xml', 'text'], // SVG — читаемый текст
    ['notes.md', 'text/markdown', 'markdown'],
    ['notes.md', '', 'markdown'],
    ['main.tsx', '', 'code'],
    ['script.py', 'text/plain', 'code'], // расширение точнее общего text/plain
    ['readme.txt', 'text/plain', 'text'],
    ['data.json', 'application/json', 'text'],
    ['blob.bin', 'application/octet-stream', 'unknown'],
  ]
  for (const [name, mime, want] of cases) {
    it(`${name} (${mime || 'без mime'}) → ${want}`, () => {
      expect(detectKind(name, mime)).toBe(want)
    })
  }
})

describe('decodeTextUtf8 / truncateText', () => {
  it('декодирует UTF-8 и убирает NUL', () => {
    const bytes = new TextEncoder().encode('при\u0000вет\u0000')
    expect(decodeTextUtf8(bytes)).toBe('привет')
  })

  it('битые байты не роняют декодер', () => {
    const broken = new Uint8Array([0xd0, 0xbf, 0xff, 0xfe, 0xd1, 0x80])
    expect(typeof decodeTextUtf8(broken)).toBe('string')
  })

  it('truncateText ставит многоточие только на длинных строках', () => {
    expect(truncateText('коротко', 10)).toBe('коротко')
    expect(truncateText('0123456789abc', 10)).toBe('0123456789…')
  })
})

describe('zipOverview: ZIP собирается в памяти и разбирается', () => {
  const zipBytes = buildZip([
    { name: 'readme.txt', data: 'Привет из архива' },
    { name: 'deep/notes.md', data: '# Заметки\nвнутри вложенной папки' },
    { name: 'blob.bin', data: Buffer.from([0, 1, 2, 3]) },
  ])

  it('список имён и тексты текстовых файлов', () => {
    const ov = zipOverview(new Uint8Array(zipBytes))
    expect(ov.entryCount).toBe(3)
    expect([...ov.names].sort()).toEqual(['blob.bin', 'deep/notes.md', 'readme.txt']) // порядок задан zip-оглавлением
    expect(ov.texts.some((t) => t.startsWith('readme.txt: Привет из архива'))).toBe(true)
    expect(ov.texts.some((t) => t.includes('# Заметки'))).toBe(true)
    expect(ov.texts.some((t) => t.startsWith('blob.bin'))).toBe(false) // не текст — в тексты не попадает
  })

  it('файлы больше 2 МБ пропускаются, но остаются в списке', () => {
    const big = 'x'.repeat(ZIP_MAX_ENTRY_BYTES + 1)
    const ov = zipOverview(new Uint8Array(buildZip([
      { name: 'huge.log', data: big },
      { name: 'small.txt', data: 'ок' },
    ])))
    expect(ov.names).toContain('huge.log')
    expect(ov.texts.some((t) => t.startsWith('small.txt: ок'))).toBe(true)
    expect(ov.texts.some((t) => t.startsWith('huge.log'))).toBe(false)
  })

  it('не больше 10 текстовых файлов в выборке', () => {
    const files = Array.from({ length: ZIP_MAX_TEXT_ENTRIES + 5 }, (_, i) => ({ name: `f${i}.txt`, data: `текст ${i}` }))
    const ov = zipOverview(new Uint8Array(buildZip(files)))
    expect(ov.entryCount).toBe(ZIP_MAX_TEXT_ENTRIES + 5)
    expect(ov.texts.length).toBe(ZIP_MAX_TEXT_ENTRIES)
  })

  it('битый архив бросает исключение (обрабатывается конвейером)', () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x00, 0x00, 1, 2, 3])
    expect(() => zipOverview(garbage)).toThrow()
  })
})

describe('zipSample: выборка для модели', () => {
  it('список + тексты, обрезка по лимиту', () => {
    const ov = zipOverview(new Uint8Array(buildZip([
      { name: 'a.txt', data: 'первый' },
      { name: 'b.md', data: 'второй' },
    ])))
    const sample = zipSample(ov)
    expect(sample).toContain('Файлов в архиве: 2')
    expect(sample).toContain('a.txt: первый')
    expect(sample).toContain('b.md: второй')
  })

  it('имена обрезаются до 40, длинный список — с многоточием', () => {
    const names = Array.from({ length: 60 }, (_, i) => `n${i}.txt`)
    const sample = zipSample({ names, texts: [], entryCount: 60 })
    expect(sample).toContain('Файлов в архиве: 60')
    expect(sample).not.toContain('n59.txt')
    expect(sample.endsWith('…')).toBe(true)
  })
})

describe('docxText: DOCX-подобный сценарий на mock mammoth', () => {
  it('отдаёт текст из extractRawText', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    await expect(docxText(bytes)).resolves.toBe('RAW:4')
  })
})

describe('parseTitleDescription: ответ модели → JSON', () => {
  it('чистый JSON', () => {
    const got = parseTitleDescription('{"title": "Годовой отчёт", "description": "Таблица продаж за год"}')
    expect(got).toEqual({ title: 'Годовой отчёт', description: 'Таблица продаж за год' })
  })

  it('JSON в окружении пояснений', () => {
    const raw = 'Вот результат:\n{"title": "Счёт №12", "description": "Счёт на оплату услуг"}\nНадеюсь, помог.'
    expect(parseTitleDescription(raw)).toEqual({ title: 'Счёт №12', description: 'Счёт на оплату услуг' })
  })

  it('JSON в markdown-заборе', () => {
    const raw = '```json\n{"title": "Резюме", "description": "Резюме инженера"}\n```'
    expect(parseTitleDescription(raw)).toEqual({ title: 'Резюме', description: 'Резюме инженера' })
  })

  it('мусор → null', () => {
    expect(parseTitleDescription('')).toBeNull()
    expect(parseTitleDescription('просто слова без json')).toBeNull()
    expect(parseTitleDescription('{"title": 42, "description": null}')).toBeNull() // не строки
    expect(parseTitleDescription('{"title": "  ", "description": "  "}')).toBeNull() // пустые
  })

  it('переводы строк и табуляции внутри значений схлопываются, длинные обрезаются', () => {
    const got = parseTitleDescription(`{"title": "Много   слов\\tи  пробелов", "description": "${'д'.repeat(500)}"}`)
    expect(got?.title).toBe('Много слов и пробелов')
    expect(got?.description?.length).toBeLessThanOrEqual(400)
  })
})

describe('fallback-описания', () => {
  it('titleFromName: без расширения, разделители → пробелы, ≤8 слов', () => {
    expect(titleFromName('Отчёт_за-2026.год.финал.pdf')).toBe('Отчёт за 2026 год финал')
    expect(titleFromName('a_b-c.txt')).toBe('a b c')
    expect(titleFromName(`${Array.from({ length: 12 }, (_, i) => `слово${i}`).join(' ')}.md`).split(' ').length).toBeLessThanOrEqual(8)
    expect(titleFromName('.docx')).toBe('Файл')
  })

  it('descriptionFromLines: первые непустые строки', () => {
    expect(descriptionFromLines('\n\nПервая строка\n\nВторая\nТретья\nЧетвёртая')).toBe('Первая строка · Вторая · Третья')
    expect(descriptionFromLines('   ')).toBe('')
  })

  it('humanSize', () => {
    expect(humanSize(500)).toBe('500 Б')
    expect(humanSize(2048)).toBe('2 КБ')
    expect(humanSize(MAX_BYTES_FULL + 1)).toContain('МБ')
  })
})

describe('exifreader', () => {
  it('не-изображение бросает исключение (конвейер переведёт в partial)', () => {
    expect(() => imageExif(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })

  it('exifSummary формирует человекочитаемую сводку', () => {
    const s = exifSummary({ width: 1920, height: 1080, date: '2026:05:01 12:00:00', camera: 'Apple iPhone 13', notes: ['ISO=100'] })
    expect(s).toContain('1920×1080')
    expect(s).toContain('снято 2026:05:01 12:00:00')
    expect(s).toContain('камера Apple iPhone 13')
    expect(s).toContain('ISO=100')
  })

  it('exifSummary без данных — честный текст', () => {
    expect(exifSummary({ notes: [] })).toBe('Изображение без читаемых EXIF-данных.')
  })
})

describe('pdfText: ленивая загрузка pdf-parse', () => {
  it('битый PDF не зависает и возвращает пустую строку или ошибку', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]) // %PDF...
    const result = await pdfText(bytes).then((t) => `ok:${t.length}`, (e) => `err:${(e as Error).message.slice(0, 40)}`)
    expect(result.startsWith('ok:') || result.startsWith('err:')).toBe(true)
  })
})

/* ============================================================
   ПРОМПТ АРХИВАРИУСА (2026-09-09): сборка сообщений без модели
   ============================================================ */

describe('промпт архивариуса: DESCRIBE_SYSTEM', () => {
  it('роль, строгий JSON и лимиты из решения пользователя', () => {
    expect(DESCRIBE_SYSTEM).toContain('архивариус')
    expect(DESCRIBE_SYSTEM).toContain('"title"')
    expect(DESCRIBE_SYSTEM).toContain('"description"')
    expect(DESCRIBE_SYSTEM).toContain('"tags"')
    expect(DESCRIBE_SYSTEM).toContain('8 слов')
    expect(DESCRIBE_SYSTEM).toContain('48 слов')
    expect(DESCRIBE_SYSTEM).toContain('до 5')
    expect(DESCRIBE_SYSTEM).toContain('русский язык')
    // все типы содержимого описаны одним промптом
    expect(DESCRIBE_SYSTEM).toContain('фото')
    expect(DESCRIBE_SYSTEM).toContain('ZIP-архив')
    expect(DESCRIBE_SYSTEM).toContain('документ')
  })
})

describe('промпт архивариуса: buildAnalysisMessages', () => {
  const input = { id: 'f1', name: 'report.pdf', contentType: 'application/pdf', size: 1024 }

  it('system + user, без images для текстового файла', () => {
    const msgs = buildAnalysisMessages(input, { sample: 'Отчёт о продажах за июнь. Сумма 100 000 ₽.' })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toBe(DESCRIBE_SYSTEM)
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('Имя файла: report.pdf')
    expect(msgs[1].content).toContain('Тип: application/pdf')
    expect(msgs[1].content).toContain('Содержимое:')
    expect(msgs[1].content).toContain('Сумма 100 000 ₽.')
    expect(typeof msgs[1].content).toBe('string')
  })

  it('фото: base64 уходит частью image_url в том же запросе', () => {
    const msgs = buildAnalysisMessages(
      { id: 'f2', name: 'фото.jpg', contentType: 'image/jpeg', size: 3 },
      { sample: 'Изображение: 640×480.', imageBase64: 'QUJD', imageMime: 'image/jpeg' },
    )
    expect(msgs).toHaveLength(2)
    const parts = msgs[1].content as { type: string; text?: string; image_url?: { url: string } }[]
    expect(Array.isArray(parts)).toBe(true)
    expect(parts[0].text).toContain('Имя файла: фото.jpg')
    expect(parts[1].image_url?.url).toBe('data:image/jpeg;base64,QUJD')
  })

  it('пустая выборка: модель просит описать по имени файла', () => {
    const msgs = buildAnalysisMessages({ id: 'f3', name: 'blob.bin', contentType: 'application/octet-stream', size: 0 }, { sample: '' })
    expect(msgs[1].content).toContain('Имя файла: blob.bin')
    expect(msgs[1].content).toContain('опиши по имени файла')
    expect(msgs[1].content).not.toContain('Содержимое:')
  })
})

describe('parseTitleDescription: метки архивариуса', () => {
  it('JSON с tags разбирается целиком', () => {
    expect(
      parseTitleDescription('{"title":"Отчёт о продажах","description":"Таблица продаж за июнь.","tags":["отчёт","деньги"]}'),
    ).toEqual({ title: 'Отчёт о продажах', description: 'Таблица продаж за июнь.', tags: ['отчёт', 'деньги'] })
  })

  it('теги чистятся: не-строки пропускаются, повторы схлопываются, лимит 5', () => {
    const got = parseTitleDescription('{"tags":["a","A"," b ","",1,"t2","t3","t4","t5","t6"]}')
    expect(got?.tags).toEqual(['a', 'b', 't2', 't3', 't4'])
  })

  it('только теги без title/description — тоже валидный ответ', () => {
    expect(parseTitleDescription('{"tags":["документ"]}')).toEqual({ tags: ['документ'] })
    expect(parseTitleDescription('{"tags":[]}')).toBeNull()
  })
})
