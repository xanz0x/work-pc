import type { AiErrorCode } from '@/lib/ai-errors'

/**
 * Сбой провайдера с кодом каталога (NF-2). Наружу уходит только код:
 * ни адреса движка, ни ответа провайдера — детали живут в логе сервера.
 */
export class LlmFail extends Error {
  code: AiErrorCode
  detail: string
  constructor(code: AiErrorCode, detail: string) {
    super(code)
    this.code = code
    this.detail = detail
  }
}
