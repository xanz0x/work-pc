import { describe, expect, it, vi } from 'vitest'
import { hasModel } from '@/lib/llm/models'
import { ollamaMessages, ollamaProvider, parseOllamaLine } from '@/lib/llm/ollama'
import { LlmFail } from '@/lib/llm/fail'

function streamLines(lines: string[]) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(enc.encode(`${line}\n`))
      controller.close()
    },
  })
}

describe('ollama adapter: model matching and stream handling', () => {
  it('hasModel keeps model-size strict but allows quant suffix', () => {
    expect(hasModel(['qwen2.5:3b-q4_K_M'], 'qwen2.5:3b')).toBe(true)
    expect(hasModel(['qwen2.5:7b'], 'qwen2.5:3b')).toBe(false)
  })

  it('ollamaMessages converts persisted history to object arguments + tool_name', () => {
    const mapped = ollamaMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'find_file', arguments: '{"query":"rent"}' } }],
      },
      {
        role: 'tool',
        content: '{"found":[]}',
        tool_call_id: 'call_0',
      },
    ])
    expect(mapped[0].tool_calls?.[0].function?.arguments).toEqual({ query: 'rent' })
    expect(mapped[1].tool_name).toBe('find_file')
  })

  it('NDJSON error line surfaces as LlmFail', () => {
    expect(() => parseOllamaLine('{"error":"boom"}')).toThrow(LlmFail)
  })

  it('provider collects calls and fails on truncated stream without usage', async () => {
    process.env.OLLAMA_URL = 'http://127.0.0.1:11434'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: streamLines([
        '{"message":{"content":"hi"},"done":false}',
        '{"message":{"tool_calls":[{"function":{"name":"find_file","arguments":{"q":"x"}}}]},"done":false}',
      ]),
      text: async () => '',
      status: 200,
    })))
    const provider = ollamaProvider('qwen2.5:3b')
    const run = async () => {
      const out = []
      for await (const d of provider.stream({ system: 's', messages: [], tools: [], signal: new AbortController().signal })) out.push(d)
      return out
    }
    await expect(run()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
  })

  it('provider yields text, usage and collected calls on complete stream', async () => {
    process.env.OLLAMA_URL = 'http://127.0.0.1:11434'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: streamLines([
        '{"message":{"content":"hello"},"done":false}',
        '{"message":{"tool_calls":[{"function":{"name":"find_file","arguments":{"q":"x"}}}]},"done":false}',
        '{"done":true,"prompt_eval_count":1,"eval_count":2,"eval_duration":1000000000}',
      ]),
      text: async () => '',
      status: 200,
    })))
    const provider = ollamaProvider('qwen2.5:3b')
    const out = [] as Array<{ k: string }>
    for await (const d of provider.stream({ system: 's', messages: [], tools: [], signal: new AbortController().signal })) out.push(d as { k: string })
    expect(out.some((d) => d.k === 'text')).toBe(true)
    expect(out.some((d) => d.k === 'usage')).toBe(true)
    expect(out.some((d) => d.k === 'calls')).toBe(true)
  })
})
