/* ============================================================
   LLM · КАРТА МОДЕЛЕЙ (NF-2)
   Файл читают и сервер, и браузер, поэтому здесь нет ни fetch,
   ни переменных окружения — только соответствие «модель в профиле →
   тег в Ollama». Настройки показывают человеку ту же строку, которую
   сервер отправит в движок.
   ============================================================ */

import type { ModelId } from '@/lib/data'

/** Модель профиля → тег Ollama. Теги — официальные имена из ollama.com/library. */
export const OLLAMA_TAGS: Record<ModelId, string> = {
  'qwen-3b': 'qwen2.5vl:3b',
  'qwen-7b': 'qwen2.5:7b',
  'llama-8b': 'llama3.1:8b',
  'mistral-7b': 'mistral:7b',
}

export function ollamaTag(model: ModelId): string {
  return OLLAMA_TAGS[model] ?? OLLAMA_TAGS['qwen-7b']
}

/**
 * Allow an explicit quantization suffix, but never substitute a different size:
 * qwen2.5:3b must not make qwen2.5:7b appear installed.
 */
export function hasModel(installed: string[], want: string): boolean {
  return installed.some((m) => m === want || m.startsWith(`${want}-`))
}

/** Команда, которую человек выполняет в терминале, если модели нет. */
export function pullCommand(tag: string): string {
  return `ollama pull ${tag}`
}
