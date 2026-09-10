import { describe, expect, it } from 'vitest'
import { buildGraph, MAX_DEGREE } from '@/lib/graph'
import type { VaultFile } from '@/lib/data'

function corpus(n: number): VaultFile[] {
  const clusters = ['docs', 'code', 'media', 'misc'] as VaultFile['cluster'][]
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    icon: 'doc' as VaultFile['icon'],
    cluster: clusters[i % clusters.length],
    name: `файл-${i}.txt`,
    desc: 'тест',
    bytes: 1000 + i,
    date: '2026-06-01',
    tags: [`t${i % 40}`, `g${i % 7}`],
  }))
}

describe('граф большого сейфа', () => {
  it('строится быстро и держит бюджет связей', () => {
    const files = corpus(1200)
    const t0 = performance.now()
    const g = buildGraph(files, [], 0)
    const ms = performance.now() - t0
    expect(g.nodes).toHaveLength(1200)
    expect(Math.max(...g.degree)).toBeLessThanOrEqual(MAX_DEGREE + 1)
    expect(ms).toBeLessThan(2000)
  })

  it('связи не дублируются', () => {
    const g = buildGraph(corpus(200), [], 0)
    const keys = new Set(g.edges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`))
    expect(keys.size).toBe(g.edges.length)
  })
})
