import { describe, expect, it } from 'vitest'
import { searchAll, type SearchInput } from '@/lib/search'
import type { VaultFile } from '@/lib/data'
import type { Note } from '@/lib/notes'

const file: VaultFile = {
  id: 'f1',
  icon: 'doc',
  cluster: 'docs',
  name: 'Договор аренды',
  desc: 'ипотека и залог квартиры',
  bytes: 1024,
  date: '01.01.2026',
  tags: ['ипотека'],
}

const note: Note = {
  id: 'n1',
  title: 'Пароль от роутера',
  body: 'секретное тело со словом ипотека',
  tags: [],
  expiresAt: null,
  lifeSpan: null,
  locked: true,
  secret: 'ct:iv',
  createdAt: 0,
}

const input = (over: Partial<SearchInput> = {}): SearchInput => ({
  files: [file],
  notes: [note],
  sessions: [],
  now: Date.now(),
  ...over,
})

describe('поиск и redact-слой', () => {
  it('файл находится по имени', () => {
    const hits = searchAll('договор', 'all', input())
    expect(hits.some((h) => h.id === 'f1')).toBe(true)
  })

  it('файл под ключом не всплывает по описанию и тегам', () => {
    const open = searchAll('ипотека', 'all', input())
    expect(open.some((h) => h.id === 'f1')).toBe(true)

    const closed = searchAll('ипотека', 'all', input({ redactIds: new Set(['f1']) }))
    const hit = closed.find((h) => h.id === 'f1')
    expect(hit).toBeUndefined()
  })

  it('файл под ключом всё ещё находится по имени и помечен как закрытый', () => {
    const hits = searchAll('договор', 'all', input({ redactIds: new Set(['f1']) }))
    const hit = hits.find((h) => h.id === 'f1')
    expect(hit?.locked).toBe(true)
    expect(hit?.sub).toBe('Под ключом')
  })

  it('тело locked-стикера в поиск не попадает', () => {
    const hits = searchAll('секретное', 'notes', input())
    expect(hits.some((h) => h.id === 'n1')).toBe(false)
    expect(searchAll('пароль', 'notes', input()).some((h) => h.id === 'n1')).toBe(true)
  })

  it('пустой запрос ничего не предлагает', () => {
    expect(searchAll('   ', 'all', input())).toEqual([])
  })
})
