import { NextResponse, type NextRequest } from 'next/server'
import { withRoute } from '@/lib/route-log'
import { setStorageRootMigrating, storageRootView } from '@/lib/cloud-store'
import { cloudError } from '@/lib/cloud-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Текущая папка хранения общего диска (только администратор): { root: string | null }. */
export const GET = withRoute('/ai-api/cloud/storage-root', async () => {
  try {
    return NextResponse.json(await storageRootView())
  } catch (e) {
    return cloudError(e)
  }
})

/**
 * { root: 'C:\\путь\\к\\папке', migrate?: true } — задать/изменить папку на ПК
 * (создаётся при необходимости); при migrate:true все живые объекты диска
 * копируются в неё (коллизии имён — «-1»), отчёт: { migrated: { copied, failed, errors[] } }.
 * { root: '' } — отключить, вернув прежнее поведение (внутреннее объектное
 * хранилище). Только администратор.
 */
export const PUT = withRoute('/ai-api/cloud/storage-root', async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { root?: unknown; migrate?: unknown }
    const result = await setStorageRootMigrating(body.root, body.migrate === true)
    return NextResponse.json(result)
  } catch (e) {
    return cloudError(e)
  }
})
