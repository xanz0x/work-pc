import { promises as fs } from 'fs'
import path from 'path'
import { assertEnv } from '@/lib/env'
import { log } from '@/lib/log'

/**
 * Автосев AI_DIR (§4.3 хвоста волны 2). После сброса пода каталог скиллов
 * пуст, и /ai-api/skills отвечает 404. Копируем эталон из репозитория, но
 * НИКОГДА не перезаписываем то, что уже есть: правки пользователя важнее.
 */
async function seedAiDir(): Promise<void> {
  const root = process.env.AI_DIR?.trim()
  if (!root) return
  const src = path.join(process.cwd(), 'ai')
  for (const dir of ['skills', 'mcp', 'sessions']) {
    const to = path.join(root, dir)
    await fs.mkdir(to, { recursive: true })
    if (dir === 'sessions') continue
    const from = path.join(src, dir)
    let names: string[] = []
    try {
      names = await fs.readdir(from)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const target = path.join(to, name)
      try {
        await fs.access(target)
      } catch {
        await fs.copyFile(path.join(from, name), target)
        log('info', 'boot.seed', { where: `${dir}/${name}` })
      }
    }
  }
  for (const name of ['system.md']) {
    const target = path.join(root, name)
    try {
      await fs.access(target)
    } catch {
      await fs.copyFile(path.join(src, name), target).catch(() => {})
    }
  }
}

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
  void seedAiDir().catch((e) => {
    log('error', 'boot.seed-failed', { reason: e instanceof Error ? e.message : 'неизвестно' })
  })
}
