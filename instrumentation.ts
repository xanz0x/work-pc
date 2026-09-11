import { assertEnv } from '@/lib/env'
import { log } from '@/lib/log'

/**
 * Проверка конфигурации на старте (AR-5): сервер не поднимается, если
 * обязательные переменные не заданы. Лучше упасть сразу, чем отдавать
 * 503 на каждый запрос и делать вид, что всё в порядке.
 *
 * Файловый автосев AI_DIR живёт в lib/boot-seed.ts и подгружается только
 * в Node-рантайме: в Edge-бандле модулей fs/path нет.
 */
export function register(): void {
  const report = assertEnv()
  log('info', 'boot', { count: report.present.length })
  if (!report.cloudReady) {
    log('warn', 'boot.cloud-off', { reason: 'AI_PROXY_URL/EMERGENT_LLM_KEY не заданы' })
  }
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  void import('@/lib/boot-seed')
    .then((m) => m.seedAiDir())
    .catch((e) => {
      log('error', 'boot.seed-failed', { reason: e instanceof Error ? e.message : 'неизвестно' })
    })
}
