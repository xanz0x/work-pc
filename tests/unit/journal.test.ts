import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, resetDbHandle } from '@/lib/db/idb'
import {
  JOURNAL_KINDS,
  journalKindLabel,
  journalToFile,
  logJournal,
  readJournal,
  subscribeJournal,
} from '@/lib/journal'
import { DB_NAME } from '@/lib/db/schema'

async function wipe(): Promise<void> {
  resetDbHandle()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

describe('LG-3 · журнал безопасности', () => {
  beforeEach(async () => {
    await wipe()
  })

  it('записи только добавляются и читаются свежими сверху', async () => {
    await logJournal('lock-setup', 'Замок включён', 'PBKDF2')
    await logJournal('master-changed', 'Мастер-ключ изменён', 'новая соль')
    await logJournal('vault-wipe', 'Сейф стёрт', '3 файла')

    const rows = await readJournal()
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.kind)).toEqual(['vault-wipe', 'master-changed', 'lock-setup'])
    expect(rows.every((r) => r.at > 0 && r.id.startsWith('j-'))).toBe(true)
  })

  it('журнал живёт в своём сторе: очистка документов его не трогает', async () => {
    const id = await logJournal('plaintext-export', 'Экспорт без шифрования', 'CSV')

    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('docs', 'readwrite')
      tx.objectStore('docs').clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    const rows = await readJournal()
    expect(rows.map((r) => r.id)).toContain(id)
  })

  it('уведомление получает id записи, по которому её можно найти', async () => {
    const id = await logJournal('lock-reset', 'Замок сброшен', '2 обёртки стёрты')
    const rows = await readJournal()
    expect(rows.find((r) => r.id === id)?.title).toBe('Замок сброшен')
  })

  it('подписка сообщает интерфейсу о новом событии', async () => {
    let hits = 0
    const off = subscribeJournal(() => {
      hits += 1
    })
    await logJournal('cloud-request', 'Исходящий запрос', 'гибридный режим')
    off()
    await logJournal('cloud-request', 'Исходящий запрос', 'гибридный режим')
    expect(hits).toBe(1)
  })

  it('выгрузка отдаёт JSON с расшифрованными типами и не теряет записей', async () => {
    await logJournal('backup-restore', 'Восстановление бэкапа', '12 записей')
    const rows = await readJournal()
    const file = journalToFile(rows)
    expect(file.name).toMatch(/^workflow-journal-.*\.json$/)
    const parsed = JSON.parse(file.text) as {
      count: number
      entries: { kindLabel: string }[]
    }
    expect(parsed.count).toBe(1)
    expect(parsed.entries[0].kindLabel).toBe('Восстановление бэкапа')
  })

  it('каждый тип события подписан по-русски', () => {
    expect(JOURNAL_KINDS.length).toBeGreaterThanOrEqual(10)
    for (const k of JOURNAL_KINDS) expect(journalKindLabel(k.id)).toBe(k.label)
  })
})
