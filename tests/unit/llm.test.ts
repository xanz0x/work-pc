/* ============================================================
   NF-2 · ПАРСЕРЫ И ГЕЙТЫ ЛОКАЛЬНОГО ДВИЖКА
   Дальше всего от глаз и ближе всего к правде: если парсер потока или
   проверка живости соврут, продукт начнёт показывать выдуманные цифры.
   ============================================================ */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCloudEvent, type CallAcc } from '@/lib/llm/cloud'
import { hasModel, ollamaTag, pullCommand } from '@/lib/llm/models'
import { parseOllamaLine, probeOllama, tokensPerSec } from '@/lib/llm/ollama'
import { buildEngineView, DEFAULT_SETTINGS } from '@/lib/store/settings'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('карта моделей', () => {
  it('модель профиля превращается в тег Ollama', () => {
    expect(ollamaTag('qwen-7b')).toBe('qwen2.5:7b')
    expect(ollamaTag('llama-8b')).toBe('llama3.1:8b')
    expect(pullCommand(ollamaTag('mistral-7b'))).toBe('ollama pull mistral:7b')
  })

  it('квантованный тег считается той же моделью', () => {
    expect(hasModel(['qwen2.5:7b-instruct-q4_K_M'], 'qwen2.5:7b')).toBe(true)
    expect(hasModel(['llama3.1:8b'], 'qwen2.5:7b')).toBe(false)
    expect(hasModel([], 'qwen2.5:7b')).toBe(false)
  })
})

describe('поток Ollama (NDJSON)', () => {
  it('кусок текста становится дельтой', () => {
    expect(parseOllamaLine('{"message":{"content":"При"},"done":false}')).toEqual([
      { k: 'text', text: 'При' },
    ])
  })

  it('пустая строка и битый JSON не роняют разбор', () => {
    expect(parseOllamaLine('')).toEqual([])
    expect(parseOllamaLine('   ')).toEqual([])
    expect(parseOllamaLine('{не json')).toEqual([])
  })

  it('вызов инструмента приходит собранным', () => {
    const out = parseOllamaLine(
      '{"message":{"tool_calls":[{"function":{"name":"find_file","arguments":{"query":"аренда"}}}]},"done":false}',
    )
    expect(out).toEqual([
      { k: 'calls', calls: [{ id: 'call_0_find_file', name: 'find_file', args: '{"query":"аренда"}' }] },
    ])
  })

  it('последний чанк отдаёт расход и настоящую скорость', () => {
    const out = parseOllamaLine(
      '{"message":{"content":""},"done":true,"prompt_eval_count":42,"eval_count":100,"eval_duration":2000000000}',
    )
    expect(out).toEqual([
      { k: 'usage', promptTokens: 42, completionTokens: 100, tokensPerSec: 50 },
    ])
  })

  it('скорость считается по наносекундам движка, а не по стенным часам', () => {
    expect(tokensPerSec(100, 2_000_000_000)).toBe(50)
    expect(tokensPerSec(37, 1_000_000_000)).toBe(37)
    expect(tokensPerSec(100, 0)).toBeNull()
    expect(tokensPerSec(undefined, 1_000_000_000)).toBeNull()
  })
})

describe('поток облака (SSE)', () => {
  it('текст отдаётся дельтой, [DONE] игнорируется', () => {
    const acc: CallAcc = []
    expect(parseCloudEvent('[DONE]', acc).deltas).toEqual([])
    expect(parseCloudEvent('{"choices":[{"delta":{"content":"да"}}]}', acc).deltas).toEqual([
      { k: 'text', text: 'да' },
    ])
  })

  it('фрагменты вызова инструмента склеиваются', () => {
    const acc: CallAcc = []
    parseCloudEvent(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"find_file","arguments":"{\\"que"}}]}}]}',
      acc,
    )
    parseCloudEvent(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\\":\\"акт\\"}"}}]}}]}',
      acc,
    )
    expect(acc[0]).toEqual({ id: 'c1', name: 'find_file', args: '{"query":"акт"}' })
  })

  it('расход берётся из usage провайдера', () => {
    const acc: CallAcc = []
    const out = parseCloudEvent('{"usage":{"prompt_tokens":10,"completion_tokens":5}}', acc)
    expect(out.usage).toEqual({ prompt: 10, completion: 5 })
  })
})

describe('гейт локального движка', () => {
  it('движок не отвечает — ENGINE_NOT_RUNNING с инструкцией', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const st = await probeOllama('qwen2.5:7b')
    expect(st.ok).toBe(false)
    expect(st.code).toBe('ENGINE_NOT_RUNNING')
    expect(st.hint).toContain('ollama serve')
  })

  it('модели нет — MODEL_NOT_PULLED с готовой командой', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.1:8b' }] }),
      }),
    )
    const st = await probeOllama('qwen2.5:7b')
    expect(st.ok).toBe(false)
    expect(st.code).toBe('MODEL_NOT_PULLED')
    expect(st.hint).toContain('ollama pull qwen2.5:7b')
    expect(st.models).toEqual(['llama3.1:8b'])
  })

  it('движок с моделью — ok без подсказок', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'qwen2.5:7b' }] }),
      }),
    )
    const st = await probeOllama('qwen2.5:7b')
    expect(st.ok).toBe(true)
    expect(st.code).toBeNull()
    expect(st.hint).toBeNull()
  })
})

describe('подпись движка в интерфейсе', () => {
  it('без данных о движке продукт не обещает локальную готовность', () => {
    const view = buildEngineView({ ...DEFAULT_SETTINGS, engine: 'local' })
    expect(view.ready).toBe(false)
    expect(view.statusLabel).toBe('ЛОКАЛЬНЫЙ ДВИЖОК НЕ ПОДКЛЮЧЁН')
    expect(view.netLabel).toBe('НЕТ ИСХОДЯЩИХ ЗАПРОСОВ')
  })

  it('живой движок даёт локальный режим и настоящий тег модели', () => {
    const view = buildEngineView({ ...DEFAULT_SETTINGS, engine: 'local' }, {
      ok: true,
      model: 'qwen2.5:7b',
    })
    expect(view.ready).toBe(true)
    expect(view.statusLabel).toBe('ЛОКАЛЬНЫЙ РЕЖИМ')
    expect(view.model).toBe('qwen2.5:7b')
    expect(view.isCloud).toBe(false)
  })

  it('облачный режим не зависит от локального движка', () => {
    const view = buildEngineView({ ...DEFAULT_SETTINGS, engine: 'cloud' }, { ok: false, model: null })
    expect(view.ready).toBe(true)
    expect(view.isCloud).toBe(true)
    expect(view.netLabel).toBe('ВНИМАНИЕ · ЕСТЬ ИСХОДЯЩИЕ')
  })
})
