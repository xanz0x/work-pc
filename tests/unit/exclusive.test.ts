import { describe, expect, it, vi } from 'vitest'
import { createExclusiveRunner } from '@/lib/exclusive'

/** Отложенный промис: тест сам решает, когда операция закончится. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('LG-5 · runExclusive', () => {
  it('двойной клик по одному действию выполняет его один раз', async () => {
    const r = createExclusiveRunner()
    const d = deferred<string>()
    const fn = vi.fn(() => d.promise)

    const first = r.run('index:files', fn)
    const second = await r.run('index:files', fn)

    expect(second).toEqual({ ok: false, reason: 'busy' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(r.isPending('index:files')).toBe(true)

    d.resolve('готово')
    await expect(first).resolves.toEqual({ ok: true, value: 'готово' })
    expect(r.isPending('index:files')).toBe(false)
  })

  it('разные ключи не мешают друг другу', async () => {
    const r = createExclusiveRunner()
    const d = deferred<number>()
    const a = r.run('a', () => d.promise)
    const b = await r.run('b', () => 2)

    expect(b).toEqual({ ok: true, value: 2 })
    d.resolve(1)
    await expect(a).resolves.toEqual({ ok: true, value: 1 })
  })

  it('ошибка откатывает изменения и не оставляет ключ занятым', async () => {
    const r = createExclusiveRunner()
    const rollback = vi.fn()
    const boom = new Error('диск отвалился')

    const res = await r.run(
      'secrets:import',
      () => {
        throw boom
      },
      { rollback },
    )

    expect(res).toEqual({ ok: false, reason: 'error', error: boom })
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(r.isPending('secrets:import')).toBe(false)
  })

  it('после ошибки действие можно повторить, после успеха с dedupMs — нет', async () => {
    let t = 1_000
    const r = createExclusiveRunner(() => t)
    const fn = vi.fn(() => 'ok')

    await r.run('skill:save_password:x', fn, { dedupMs: 60_000 })
    const again = await r.run('skill:save_password:x', fn, { dedupMs: 60_000 })
    expect(again).toEqual({ ok: false, reason: 'duplicate' })
    expect(fn).toHaveBeenCalledTimes(1)

    /* Память о запуске не вечная: через минуту повтор разрешён. */
    t += 61_000
    const later = await r.run('skill:save_password:x', fn, { dedupMs: 60_000 })
    expect(later).toEqual({ ok: true, value: 'ok' })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('подписчик видит состав идущих операций', async () => {
    const r = createExclusiveRunner()
    const seen: number[] = []
    const off = r.subscribe(() => seen.push(r.getSnapshot().length))
    const d = deferred<void>()

    const p = r.run('a', () => d.promise)
    d.resolve()
    await p
    off()

    expect(seen).toEqual([1, 0])
    expect(r.getSnapshot()).toEqual([])
  })
})
