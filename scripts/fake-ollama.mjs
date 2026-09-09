#!/usr/bin/env node
/**
 * NF-2 · заглушка Ollama для проверки адаптера без 5 ГБ модели.
 *
 * Отвечает как настоящая Ollama на двух ручках: `GET /api/tags` и
 * `POST /api/chat` (поток NDJSON с финальным чанком метрик). Нужна ровно
 * для одного: убедиться, что наш адаптер, маршрут и интерфейс проходят
 * путь целиком. Это инструмент разработчика, а не часть продукта —
 * продукт разговаривает с настоящей Ollama по тому же протоколу.
 *
 * Запуск: node scripts/fake-ollama.mjs [порт=11434] [модель=qwen2.5:7b]
 */
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] ?? 11434)
const MODEL = process.argv[3] ?? 'qwen2.5:7b'
const WORDS = 'Локальный движок отвечает на этом устройстве: ни один байт не ушёл в сеть.'.split(' ')

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/api/tags')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ models: [{ name: MODEL, size: 4_700_000_000 }] }))
    return
  }
  if (req.method === 'POST' && req.url?.startsWith('/api/chat')) {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    for (const w of WORDS) {
      res.write(JSON.stringify({ message: { role: 'assistant', content: `${w} ` }, done: false }) + '\n')
      await new Promise((r) => setTimeout(r, 25))
    }
    res.write(
      JSON.stringify({
        message: { role: 'assistant', content: '' },
        done: true,
        prompt_eval_count: 128,
        eval_count: WORDS.length,
        eval_duration: 500_000_000, // 0.5 с в наносекундах
      }) + '\n',
    )
    res.end()
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`заглушка Ollama слушает http://127.0.0.1:${PORT}, модель ${MODEL}`)
})
