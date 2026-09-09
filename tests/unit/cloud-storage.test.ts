import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { RequestUser } from '@/lib/request-context'

/**
 * Папка хранения общего диска: путь валидируется и хранится в
 * AI_DIR/cloud/storage-root.json; новые загрузки физически пишутся в неё
 * под исходными именами; старые объекты (data/cloud/objects) остаются
 * читаемыми.
 */

let cloudStore: typeof import('@/lib/cloud-store')
let usersServer: typeof import('@/lib/users-server')
let reqCtx: typeof import('@/lib/request-context')
let aiDir = ''
let adminUser: RequestUser
let firstFileId = ''

const bytes = (s: string) => new TextEncoder().encode(s)
const run = <T,>(fn: () => Promise<T>) => reqCtx.runWithUser(adminUser, fn)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('cloud storage root', () => {
  it('validates and persists the chosen folder, then clears it', async () => {
    aiDir = await mkdtemp(path.join(tmpdir(), 'wsx-cloud-'))
    process.env.AI_DIR = aiDir
    process.env.ADMIN_LOGIN = 'admin'
    process.env.APP_PASSWORD = 'storage-test-pass'
    process.env.CLOUD_STORAGE = 'local'
    vi.resetModules()
    cloudStore = await import('@/lib/cloud-store')
    usersServer = await import('@/lib/users-server')
    reqCtx = await import('@/lib/request-context')
    await usersServer.load()
    const admin = (await usersServer.listUsers()).find((u) => u.role === 'admin')
    expect(admin).toBeTruthy()
    adminUser = { uid: admin!.id, role: 'admin', legacy: true, sid: 'test-sid' }

    // Относительный путь — ошибка.
    await expect(run(() => cloudStore.setStorageRoot('relative\\folder'))).rejects.toThrow(/абсолютный путь/i)

    // Существующий файл вместо папки — ошибка.
    const filePath = path.join(aiDir, 'not-a-dir.txt')
    await writeFile(filePath, 'x')
    await expect(run(() => cloudStore.setStorageRoot(filePath))).rejects.toThrow(/лежит файл/i)

    // Новая вложенная папка создаётся и запоминается.
    const root = path.join(aiDir, 'storage', 'root')
    const resolved = path.resolve(root)
    await expect(run(() => cloudStore.setStorageRoot(root))).resolves.toBe(resolved)
    const persisted = JSON.parse(await readFile(path.join(aiDir, 'cloud', 'storage-root.json'), 'utf8')) as { root: string }
    expect(persisted.root).toBe(resolved)
    await expect(run(() => cloudStore.storageRootView())).resolves.toEqual({ root: resolved })

    // Пустая строка отключает папку (файл настройки удаляется).
    await expect(run(() => cloudStore.setStorageRoot(''))).resolves.toBeNull()
    await expect(run(() => cloudStore.storageRootView())).resolves.toEqual({ root: null })

    // Снова включаем для следующих тестов загрузки.
    await expect(run(() => cloudStore.setStorageRoot(root))).resolves.toBe(resolved)
  })

  it('uploads write original-named files into the root, collisions get -1, metadata keeps sha256/relPath', async () => {
    const root = path.resolve(aiDir, 'storage', 'root')

    const payload = bytes('содержимое отчёта')
    const first = await run(() => cloudStore.uploadFile('отчёт.txt', 'docs', payload, 'text/plain'))
    firstFileId = first.id
    expect(first.relPath).toBe('отчёт.txt')
    expect(first.size).toBe(payload.byteLength)
    expect(first.sha256).toBe(createHash('sha256').update(payload).digest('hex'))
    expect(new Uint8Array(await readFile(path.join(root, 'отчёт.txt')))).toEqual(payload)

    // Коллизия: то же имя → «имя-1.ext», прежний файл не тронут.
    const second = await run(() => cloudStore.uploadFile('отчёт.txt', 'docs', bytes('второй'), 'text/plain'))
    expect(second.relPath).toBe('отчёт-1.txt')
    expect(new Uint8Array(await readFile(path.join(root, 'отчёт-1.txt')))).toEqual(bytes('второй'))
    expect(new Uint8Array(await readFile(path.join(root, 'отчёт.txt')))).toEqual(payload)

    // Windows-запрещённые символы чистятся, зарезервированные имена — с префиксом.
    const weird = await run(() => cloudStore.uploadFile('CON?.txt', '', bytes('reserved'), 'text/plain'))
    expect(weird.relPath).toBe('CON .txt')
    const reserved = await run(() => cloudStore.uploadFile('CON.txt', '', bytes('reserved2'), 'text/plain'))
    expect(reserved.relPath).toBe('_CON.txt')

    // Вид для клиента: папка хранения видна админу, path скрыт, relPath/sha256 на месте.
    const view = await run(() => cloudStore.driveView())
    expect(view.storageRoot).toBe(root)
    const viewFile = view.files.find((f) => f.id === first.id)
    expect(viewFile?.relPath).toBe('отчёт.txt')
    expect(viewFile?.sha256).toBe(first.sha256)
    expect('path' in (viewFile ?? {})).toBe(false)
  })

  it('serves bytes from the storage root under the original name', async () => {
    const viaRoot = await run(() => cloudStore.readFileBytes(firstFileId))
    expect(viaRoot.name).toBe('отчёт.txt')
    expect(new Uint8Array(viaRoot.data)).toEqual(bytes('содержимое отчёта'))
  })

  it('legacy objects (data/cloud/objects) stay readable when the root is off and on', async () => {
    // Файл, загруженный при выключенной папке, идёт прежним путём.
    await expect(run(() => cloudStore.setStorageRoot(''))).resolves.toBeNull()
    const legacy = await run(() => cloudStore.uploadFile('старый.txt', '', bytes('легаси-байты'), 'text/plain'))
    expect(legacy.relPath).toBeUndefined()
    const blobName = `${createHash('sha256').update(legacy.path).digest('hex')}.blob`
    expect(new Uint8Array(await readFile(path.join(aiDir, 'cloud', 'objects', blobName)))).toEqual(bytes('легаси-байты'))
    const back = await run(() => cloudStore.readFileBytes(legacy.id))
    expect(new Uint8Array(back.data)).toEqual(bytes('легаси-байты'))

    // Включаем папку обратно: старый объект читается, новый — пишется в папку.
    const root = path.resolve(aiDir, 'storage', 'root')
    await expect(run(() => cloudStore.setStorageRoot(root))).resolves.toBe(root)
    await expect(run(() => cloudStore.readFileBytes(legacy.id))).resolves.toEqual(back)
    const fresh = await run(() => cloudStore.uploadFile('новый.txt', '', bytes('в папке'), 'text/plain'))
    expect(fresh.relPath).toBe('новый.txt')
  })

  it('migrate:true re-selecting the same folder copies legacy objects and fills absPath for admin', async () => {
    const root = path.resolve(aiDir, 'storage', 'root')

    // Папка выключена: новый файл уходит в объектное хранилище (легаси-путь).
    await expect(run(() => cloudStore.setStorageRoot(''))).resolves.toBeNull()
    const late = await run(() => cloudStore.uploadFile('миграция.txt', '', bytes('поздний легаси'), 'text/plain'))
    expect(late.relPath).toBeUndefined()

    // Та же папка выбирается снова с migrate:true: легаси переносится,
    // файлы с relPath физически уже там — дублей «имя-1» не появляется.
    const result = await run(() => cloudStore.setStorageRootMigrating(root, true))
    expect(result.root).toBe(root)
    expect(result.migrated).toEqual({ copied: 2, failed: 0, errors: [] })
    expect(new Uint8Array(await readFile(path.join(root, 'миграция.txt')))).toEqual(bytes('поздний легаси'))
    expect(new Uint8Array(await readFile(path.join(root, 'старый.txt')))).toEqual(bytes('легаси-байты'))
    await expect(run(() => cloudStore.readFileBytes(late.id))).resolves.toMatchObject({ name: 'миграция.txt' })

    // Метаданные: relPath появился, path совпадает с relPath.
    const drive = JSON.parse(await readFile(path.join(aiDir, 'cloud', 'drive.json'), 'utf8')) as {
      files: Array<{ id: string; name: string; path: string; relPath?: string; deleted: boolean }>
    }
    const migratedRow = drive.files.find((f) => f.id === late.id)
    expect(migratedRow?.relPath).toBe('миграция.txt')
    expect(migratedRow?.path).toBe('миграция.txt')

    // Вид для админа: absPath = root + relPath у каждого файла из папки.
    const view = await run(() => cloudStore.driveView())
    const viewMigrated = view.files.find((f) => f.id === late.id)
    expect(viewMigrated?.absPath).toBe(path.resolve(root, 'миграция.txt'))
    for (const f of view.files) {
      expect(f.relPath).toBeDefined()
      expect(f.absPath).toBeDefined()
    }
  })

  it('migrate:true to a NEW folder moves root files too: collisions get -1, one broken source is not fatal', async () => {
    const oldRoot = path.resolve(aiDir, 'storage', 'root')
    const root2 = path.resolve(aiDir, 'storage', 'root2')
    await mkdir(root2, { recursive: true })

    // Конфликт имён в новой папке: «новый.txt» уже занят посторонним файлом.
    await writeFile(path.join(root2, 'новый.txt'), 'занято')
    // Один источник портим: файла больше нет в прежней папке.
    await rm(path.join(oldRoot, 'отчёт-1.txt'))

    const result = await run(() => cloudStore.setStorageRootMigrating(root2, true))
    expect(result.root).toBe(root2)
    expect(result.migrated?.copied).toBe(6)
    expect(result.migrated?.failed).toBe(1)
    expect(result.migrated?.errors[0]).toContain('отчёт-1.txt')

    // Копии в новой папке: контент тот же, коллизия разрешилась «-1».
    expect(new Uint8Array(await readFile(path.join(root2, 'отчёт.txt')))).toEqual(bytes('содержимое отчёта'))
    expect(await readFile(path.join(root2, 'новый.txt'), 'utf8')).toBe('занято')
    expect(new Uint8Array(await readFile(path.join(root2, 'новый-1.txt')))).toEqual(bytes('в папке'))
    expect(new Uint8Array(await readFile(path.join(root2, 'старый.txt')))).toEqual(bytes('легаси-байты'))

    // Метаданные переехали на новую папку: relPath обновлён, path = relPath.
    const drive = JSON.parse(await readFile(path.join(aiDir, 'cloud', 'drive.json'), 'utf8')) as {
      files: Array<{ id: string; name: string; path: string; relPath?: string }>
    }
    const renamed = drive.files.find((f) => f.name === 'новый.txt')
    expect(renamed?.relPath).toBe('новый-1.txt')
    expect(renamed?.path).toBe('новый-1.txt')

    // Чтение и вид идут из новой папки.
    await expect(run(() => cloudStore.readFileBytes(firstFileId))).resolves.toMatchObject({ name: 'отчёт.txt' })
    const view = await run(() => cloudStore.driveView())
    expect(view.storageRoot).toBe(root2)
    const viewFirst = view.files.find((f) => f.id === firstFileId)
    expect(viewFirst?.absPath).toBe(path.resolve(root2, 'отчёт.txt'))
  })

  it('migrate is opt-in: without the flag nothing is copied, empty root clears without a report', async () => {
    const root2 = path.resolve(aiDir, 'storage', 'root2')
    // Отключение папки — отчёта о переносе нет.
    await expect(run(() => cloudStore.setStorageRootMigrating('', true))).resolves.toEqual({ root: null })

    // Легаси-файл при выключенной папке; выбор БЕЗ migrate:true его не переносит.
    const optOut = await run(() => cloudStore.uploadFile('оптин.txt', '', bytes('не переношу'), 'text/plain'))
    expect(optOut.relPath).toBeUndefined()
    const result = await run(() => cloudStore.setStorageRootMigrating(root2, false))
    expect(result).toEqual({ root: root2 })
    expect(result.migrated).toBeUndefined()
    await expect(readFile(path.join(root2, 'оптин.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    // Легаси-файл остаётся читаемым из объектного хранилища и без absPath в виде.
    await expect(run(() => cloudStore.readFileBytes(optOut.id))).resolves.toMatchObject({ name: 'оптин.txt' })
    const view = await run(() => cloudStore.driveView())
    const viewOptOut = view.files.find((f) => f.id === optOut.id)
    expect(viewOptOut?.relPath).toBeUndefined()
    expect(viewOptOut?.absPath).toBeUndefined()
  })
})
