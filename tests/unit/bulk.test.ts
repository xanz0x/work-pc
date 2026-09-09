/* ============================================================
   NF-5 · МАССОВЫЕ ОПЕРАЦИИ ПРОВЕРЯЮТСЯ НА ПЯТИСТАХ ОБЪЕКТАХ
   Критерий задачи — «операция над 500 объектами идёт с прогрессом
   и не блокирует интерфейс». Проверяем ровно это: порции, живой
   счётчик прогресса, отдача потока между порциями и отмена,
   которая останавливается на границе порции, а не в середине.
   ============================================================ */

import { describe, expect, it } from 'vitest'
import { BULK_CHUNK, chunkIds, runChunked } from '@/lib/bulk'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

describe('NF-5 · порции', () => {
  it('пятьсот объектов режутся на порции по 25 без потерь', () => {
    const batches = chunkIds(ids(500), BULK_CHUNK)
    expect(batches).toHaveLength(20)
    expect(batches.flat()).toHaveLength(500)
    expect(new Set(batches.flat()).size).toBe(500)
  })

  it('последняя порция короче, если объектов не кратно', () => {
    const batches = chunkIds(ids(53), 25)
    expect(batches.map((b) => b.length)).toEqual([25, 25, 3])
  })
})

describe('NF-5 · прогон', () => {
  it('прогресс растёт порциями и доходит до 500, поток отдаётся между порциями', async () => {
    const seen: number[] = []
    let yields = 0
    const touched: string[] = []
    const res = await runChunked(ids(500), (batch) => {
      touched.push(...batch)
    }, {
      onProgress: (done) => seen.push(done),
      yieldFn: async () => {
        yields += 1
      },
    })
    expect(res).toEqual({ applied: 500, cancelled: false })
    expect(touched).toHaveLength(500)
    expect(seen[0]).toBe(25)
    expect(seen.at(-1)).toBe(500)
    /* Один возврат потока на порцию: интерфейс успевает нарисовать кадр. */
    expect(yields).toBe(20)
  })

  it('отмена останавливает на границе порции: применённое остаётся', async () => {
    const touched: string[] = []
    let cancelled = false
    const res = await runChunked(ids(500), (batch) => {
      touched.push(...batch)
    }, {
      shouldCancel: () => cancelled,
      onProgress: (done) => {
        if (done >= 100) cancelled = true
      },
      yieldFn: async () => {},
    })
    expect(res.cancelled).toBe(true)
    expect(res.applied).toBe(100)
    expect(touched).toHaveLength(100)
  })

  it('асинхронный шаг дожидается каждой порции', async () => {
    let inFlight = 0
    let overlap = false
    await runChunked(
      ids(100),
      async () => {
        inFlight += 1
        if (inFlight > 1) overlap = true
        await Promise.resolve()
        inFlight -= 1
      },
      { chunk: 10, yieldFn: async () => {} },
    )
    expect(overlap).toBe(false)
  })

  it('пустой список — операции нет', async () => {
    const res = await runChunked([], () => expect.unreachable('шаг не должен вызываться'))
    expect(res).toEqual({ applied: 0, cancelled: false })
  })
})
