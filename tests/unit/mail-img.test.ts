import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasRemoteImages, inlineRemoteImages } from '@/lib/mail-img'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

class FR {
  result = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  error: unknown = null
  readAsDataURL(_blob: Blob) {
    this.result = PNG
    setTimeout(() => this.onload?.(), 0)
  }
}

function mockFetch(map: Record<string, { ok: boolean; size?: number }>) {
  const calls: string[] = []
  vi.stubGlobal('FileReader', FR as unknown as typeof FileReader)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = decodeURIComponent(String(input).replace('/ai-api/mail/img?url=', ''))
      calls.push(url)
      const hit = map[url]
      if (!hit || !hit.ok) return { ok: false, blob: async () => new Blob([]) }
      return { ok: true, blob: async () => new Blob([new Uint8Array(hit.size ?? 8)]) }
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('картинки письма', () => {
  it('видит внешние картинки и не путает их с data:/cid:', () => {
    expect(hasRemoteImages('<img src="https://cdn.example/a.png">')).toBe(true)
    expect(hasRemoteImages('<img src="http://cdn.example/a.png">')).toBe(true)
    expect(hasRemoteImages(`<img src="${PNG}">`)).toBe(false)
    expect(hasRemoteImages('<img src="cid:logo@1">')).toBe(false)
  })

  it('подставляет data:-URI и сохраняет исходный адрес', async () => {
    const calls = mockFetch({ 'https://cdn.example/a.png': { ok: true } })
    const out = await inlineRemoteImages('<img src="https://cdn.example/a.png">')
    expect(calls).toEqual(['https://cdn.example/a.png'])
    expect(out).toContain(`src="${PNG}"`)
    expect(out).toContain('data-wsx-src="https://cdn.example/a.png"')
  })

  it('каждый адрес качает один раз', async () => {
    const calls = mockFetch({ 'https://cdn.example/a.png': { ok: true } })
    const out = await inlineRemoteImages(
      '<img src="https://cdn.example/a.png"><img src="https://cdn.example/a.png">',
    )
    expect(calls).toHaveLength(1)
    expect(out.match(new RegExp(PNG.replace(/[+/=]/g, '\\$&'), 'g'))).toHaveLength(2)
  })

  it('что не скачалось — остаётся прежним адресом', async () => {
    mockFetch({ 'https://cdn.example/ok.png': { ok: true }, 'https://cdn.example/bad.png': { ok: false } })
    const out = await inlineRemoteImages(
      '<img src="https://cdn.example/ok.png"><img src="https://cdn.example/bad.png">',
    )
    expect(out).toContain(`src="${PNG}"`)
    expect(out).toContain('src="https://cdn.example/bad.png"')
  })

  it('слишком большая картинка не подставляется', async () => {
    mockFetch({ 'https://cdn.example/big.png': { ok: true, size: 5 * 1024 * 1024 } })
    const out = await inlineRemoteImages('<img src="https://cdn.example/big.png">')
    expect(out).toBe('<img src="https://cdn.example/big.png">')
  })

  it('письмо без внешних картинок не меняется', async () => {
    mockFetch({})
    const html = `<img src="${PNG}"><p>привет</p>`
    expect(await inlineRemoteImages(html)).toBe(html)
  })

  it('суммарный бюджет ограничен: лишние картинки остаются адресами', async () => {
    const mb3 = 3 * 1024 * 1024
    const map: Record<string, { ok: boolean; size?: number }> = {}
    for (let i = 0; i < 6; i++) map[`https://cdn.example/${i}.png`] = { ok: true, size: mb3 }
    mockFetch(map)
    const html = Object.keys(map)
      .map((u) => `<img src="${u}">`)
      .join('')
    const out = await inlineRemoteImages(html)
    const inlined = out.match(/src="data:image/g)?.length ?? 0
    expect(inlined).toBeLessThanOrEqual(4)
    expect(out).toContain('src="https://cdn.example/')
  })
})
