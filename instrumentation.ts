import { assertEnv } from '@/lib/env'
import { log } from '@/lib/log'

/**
 * Проверка конфигурации на старте (AR-5): сервер не поднимается, если
 * обязательные переменные не заданы. Лучше упасть сразу, чем отдавать
 * 503 на каждый запрос и делать вид, что всё в порядке.
 */
export function register(): void {
  const report = assertEnv()
  log('info', 'boot', { count: report.present.length })
  if (!report.cloudReady) {
    log('warn', 'boot.cloud-off', { reason: 'AI_PROXY_URL/EMERGENT_LLM_KEY не заданы' })
  }
}
