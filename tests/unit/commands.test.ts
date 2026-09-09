/* ============================================================
   NF-6 · РЕЕСТР КОМАНД ПРОВЕРЯЕТСЯ ТЕСТОМ
   Критерий задачи — «не меньше 20 команд работают с клавиатуры из
   любого экрана». Проверяем состав реестра, поиск по нему, честную
   доступность по контексту и то, что у каждой команды есть подсказка.
   ============================================================ */

import { describe, expect, it, vi } from 'vitest'
import {
  COMMANDS,
  commandById,
  filterCommands,
  isAvailable,
  matchCommand,
  type CommandCtx,
} from '@/lib/commands'

function ctx(over: Partial<CommandCtx> = {}): CommandCtx {
  return {
    screen: 'library',
    lockStatus: 'unlocked',
    secretsReady: true,
    folderConnected: true,
    indexBusy: false,
    unread: 3,
    clipActive: false,
    telemetry: true,
    go: vi.fn(),
    openSetting: vi.fn(),
    flash: vi.fn(),
    setQuery: vi.fn(),
    setScope: vi.fn(),
    setToggle: vi.fn(),
    lockNow: vi.fn(),
    markAllRead: vi.fn(),
    hideSecrets: vi.fn(),
    clearClipboard: vi.fn(),
    backupSecrets: vi.fn(),
    connectFolder: vi.fn(),
    reindex: vi.fn(),
    ...over,
  }
}

describe('NF-6 · состав реестра', () => {
  it('команд не меньше двадцати и все id уникальны', () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length)
  })

  it('у каждой команды есть заголовок, подсказка и иконка', () => {
    for (const c of COMMANDS) {
      expect(c.title.length, c.id).toBeGreaterThan(2)
      expect(c.hint.length, c.id).toBeGreaterThan(8)
      expect(c.icon, c.id).toBeTruthy()
    }
  })

  it('условная команда объясняет, почему недоступна', () => {
    for (const c of COMMANDS.filter((x) => x.when)) {
      expect(c.blocked, `${c.id}: нужна причина недоступности`).toBeTruthy()
    }
  })

  it('в реестре есть все семь переходов по экранам', () => {
    const nav = COMMANDS.filter((c) => c.group === 'nav')
    expect(nav).toHaveLength(7)
    const c = ctx()
    nav.forEach((cmd) => cmd.run(c))
    expect((c.go as ReturnType<typeof vi.fn>).mock.calls.flat().sort()).toEqual([
      'activity',
      'chat',
      'library',
      'mail',
      'map',
      'settings',
      'vault',
    ])
  })
})

describe('NF-6 · доступность по контексту', () => {
  it('замок выключен — «Заблокировать сейф» недоступна', () => {
    const cmd = commandById('lock.now')!
    expect(isAvailable(cmd, ctx({ lockStatus: 'off' }))).toBe(false)
    expect(isAvailable(cmd, ctx({ lockStatus: 'unlocked' }))).toBe(true)
  })

  it('сейф секретов закрыт — команды модуля недоступны', () => {
    const closed = ctx({ secretsReady: false })
    for (const id of ['vault.new', 'vault.generator', 'vault.io', 'vault.backup', 'vault.select']) {
      expect(isAvailable(commandById(id)!, closed), id).toBe(false)
    }
  })

  it('папка не подключена — переиндексация недоступна', () => {
    expect(isAvailable(commandById('index.reindex')!, ctx({ folderConnected: false }))).toBe(false)
  })

  it('непрочитанных нет — команда ленты недоступна', () => {
    expect(isAvailable(commandById('notifs.read-all')!, ctx({ unread: 0 }))).toBe(false)
  })

  it('недоступные команды уходят в конец выдачи, но не исчезают', () => {
    const rows = filterCommands('', ctx({ secretsReady: false, lockStatus: 'off' }))
    expect(rows).toHaveLength(COMMANDS.length)
    const firstOff = rows.findIndex((r) => !r.available)
    expect(rows.slice(firstOff).every((r) => !r.available)).toBe(true)
  })
})

describe('NF-6 · поиск по команде', () => {
  it('находит по заголовку, слову и окончанию', () => {
    expect(matchCommand(commandById('library.new-note')!, 'стикер')).toBe(true)
    expect(matchCommand(commandById('library.new-note')!, 'заметки')).toBe(true)
    expect(matchCommand(commandById('lock.now')!, 'замок')).toBe(true)
    expect(matchCommand(commandById('lock.now')!, 'генератор')).toBe(false)
  })

  it('пустой запрос отдаёт весь реестр', () => {
    expect(filterCommands('', ctx())).toHaveLength(COMMANDS.length)
  })

  it('запрос сужает выдачу и оставляет осмысленное', () => {
    const rows = filterCommands('пароль', ctx())
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.map((r) => r.cmd.id)).toContain('vault.generator')
  })
})

describe('NF-6 · запуск', () => {
  it('команда настроек ведёт в свой раздел', () => {
    const c = ctx()
    commandById('set.privacy')!.run(c)
    expect(c.openSetting).toHaveBeenCalledWith('privacy')
  })

  it('«Выключить телеметрию» действительно её выключает', () => {
    const c = ctx()
    commandById('privacy.telemetry-off')!.run(c)
    expect(c.setToggle).toHaveBeenCalledWith('telemetry', false)
  })

  it('команда экрана сначала открывает экран', () => {
    const c = ctx({ screen: 'settings' })
    commandById('library.select')!.run(c)
    expect(c.go).toHaveBeenCalledWith('library')
  })
})
