import { promises as fs } from 'fs'
import path from 'path'
import { log } from '@/lib/log'

/**
 * Автосев AI_DIR. После сброса пода каталог скиллов пуст, и /ai-api/skills
 * отвечает 404. Копируем эталон из репозитория, но НИКОГДА не перезаписываем
 * то, что уже есть: правки пользователя важнее.
 *
 * turbopackIgnore на путях: пути собираются из AI_DIR во время выполнения,
 * статический анализ иначе тянет в трассировку весь проект.
 */
export async function seedAiDir(): Promise<void> {
  const root = process.env.AI_DIR?.trim()
  if (!root) return
  const src = path.join(/*turbopackIgnore: true*/ process.cwd(), 'ai')
  for (const dir of ['skills', 'mcp', 'sessions']) {
    const to = path.join(/*turbopackIgnore: true*/ root, dir)
    await fs.mkdir(to, { recursive: true })
    if (dir === 'sessions') continue
    const from = path.join(/*turbopackIgnore: true*/ src, dir)
    let names: string[] = []
    try {
      names = await fs.readdir(/*turbopackIgnore: true*/ from)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const target = path.join(/*turbopackIgnore: true*/ to, name)
      try {
        await fs.access(/*turbopackIgnore: true*/ target)
      } catch {
        await fs.copyFile(path.join(/*turbopackIgnore: true*/ from, name), target)
        log('info', 'boot.seed', { where: `${dir}/${name}` })
      }
    }
  }
  for (const name of ['system.md']) {
    const target = path.join(/*turbopackIgnore: true*/ root, name)
    try {
      await fs.access(/*turbopackIgnore: true*/ target)
    } catch {
      await fs.copyFile(path.join(/*turbopackIgnore: true*/ src, name), target).catch(() => {})
    }
  }
}
