import { NextResponse, type NextRequest } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { withRoute } from '@/lib/route-log'
import { requireUser } from '@/lib/request-context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Обзор папок на машине, где работает программа: нужен, чтобы выбрать
 * папку хранения без нативного диалога (в браузере абсолютный путь
 * получить нельзя). Отдаём только имена подпапок — файлы не перечисляем.
 * `?path=` пусто — стартовые точки (домашняя папка, корень, диски).
 * `?create=имя` — создать подпапку и вернуть её содержимое.
 */
export const GET = withRoute('/ai-api/cloud/browse', async (req: NextRequest) => {
  if (requireUser().role !== 'admin') {
    return NextResponse.json({ code: 'FORBIDDEN', error: 'Обзор папок доступен только администратору.' }, { status: 403 })
  }
  const raw = (req.nextUrl.searchParams.get('path') ?? '').trim()
  const create = (req.nextUrl.searchParams.get('create') ?? '').trim()

  if (!raw) {
    const home = os.homedir()
    const roots = [
      { name: 'Домашняя папка', path: home },
      { name: process.platform === 'win32' ? 'Диск C:\\' : 'Корень файловой системы', path: process.platform === 'win32' ? 'C:\\' : '/' },
    ]
    return NextResponse.json({ path: null, parent: null, roots, dirs: [] })
  }

  let dir = path.resolve(raw)
  if (create) {
    if (/[\\/:*?"<>|]/.test(create)) {
      return NextResponse.json({ code: 'INVALID_ARGS', error: 'В имени папки нельзя использовать \\ / : * ? " < > |' }, { status: 400 })
    }
    dir = path.join(dir, create)
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return NextResponse.json({ code: 'PROVIDER', error: 'Не удалось создать папку: проверьте права доступа.' }, { status: 400 })
    }
  }

  let entries: Awaited<ReturnType<typeof fs.readdir>> = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true }) as never
  } catch {
    return NextResponse.json({ code: 'NOT_FOUND', error: 'Папка недоступна: проверьте путь и права доступа.' }, { status: 404 })
  }
  const dirs = (entries as unknown as { name: string; isDirectory: () => boolean }[])
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .slice(0, 500)

  const parent = path.dirname(dir)
  return NextResponse.json({ path: dir, parent: parent === dir ? null : parent, roots: [], dirs })
})
