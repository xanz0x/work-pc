import { describe, expect, it } from 'vitest'
import {
  CTX_BUDGET_CHARS,
  MAX_TURNS,
  chars,
  fillPercent,
  summarize,
  trimLlm,
  type CtxMsg,
} from '@/lib/context-window'

function dialog(turns: number, size = 40): CtxMsg[] {
  const out: CtxMsg[] = []
  for (let i = 0; i < turns; i += 1) {
    out.push({ role: 'user', content: `вопрос ${i} ${'x'.repeat(size)}` })
    out.push({ role: 'assistant', content: `ответ ${i} ${'y'.repeat(size)}` })
  }
  return out
}

describe('окно контекста диалога', () => {
  it('короткий диалог уходит целиком и без резюме', () => {
    const all = dialog(3)
    const win = trimLlm(all)
    expect(win.msgs).toHaveLength(all.length)
    expect(win.dropped).toBe(0)
    expect(win.summary).toBeNull()
  })

  it('длинный диалог обрезается до последних ходов', () => {
    const all = dialog(200)
    const win = trimLlm(all)
    const users = win.msgs.filter((m) => m.role === 'user').length
    expect(users).toBeLessThanOrEqual(MAX_TURNS + 1)
    expect(win.dropped).toBeGreaterThan(0)
    expect(win.msgs[win.msgs.length - 1]).toEqual(all[all.length - 1])
  })

  it('стоимость хода не растёт линейно: бюджет символов соблюдён', () => {
    const win = trimLlm(dialog(500, 400))
    expect(chars(win.msgs)).toBeLessThanOrEqual(CTX_BUDGET_CHARS * 1.2)
  })

  it('вытесненное сворачивается в резюме с вопросами пользователя', () => {
    const win = trimLlm(dialog(200))
    expect(win.summary).toContain('Ранее в этом диалоге обсуждали')
    expect(win.summary!.length).toBeLessThan(1_000)
  })

  it('окно никогда не начинается с результата скилла', () => {
    const all: CtxMsg[] = [
      ...dialog(30),
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_file', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'результат' },
      { role: 'user', content: 'спасибо' },
    ]
    const win = trimLlm(all, { maxTurns: 2, budget: 200 })
    expect(win.msgs[0].role).not.toBe('tool')
  })

  it('пустая история не ломает обрезку', () => {
    const win = trimLlm([])
    expect(win.msgs).toEqual([])
    expect(win.summary).toBeNull()
    expect(summarize([])).toBeNull()
  })

  it('индикатор заполнения считается по реальным символам', () => {
    expect(fillPercent(0, 100)).toBe(0)
    expect(fillPercent(50, 100)).toBe(50)
    expect(fillPercent(500, 100)).toBe(100)
  })
})
