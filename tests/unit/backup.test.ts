/* ============================================================
   NF-7 · БЭКАП ВСЕГО СЕЙФА: ROUND-TRIP НА ЧИСТОМ УСТРОЙСТВЕ
   Главный критерий задачи проверяется буквально: снимок снимается на
   устройстве A, база и localStorage стираются, мастер-ключ становится
   ДРУГИМ (как на новом устройстве) — и после восстановления состояние
   совпадает с исходным, включая расшифровку секретов, файловых ключей и
   секретов стикеров.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest'
import { DB_NAME } from '@/lib/db/schema'
import { resetDbHandle } from '@/lib/db/idb'
import { docs } from '@/lib/db/repo'
import {
  aesDecrypt,
  aesEncrypt,
  bytesToB64,
  randomBytesOf,
  removeLockState,
  setMasterSecret,
} from '@/lib/crypto-vault'
import { adoptMasterSession, dropMasterSession, getMasterSession } from '@/hooks/use-file-keys'
import {
  dropSecretsSession,
  ensureSecretsSession,
  openField,
  sealField,
} from '@/lib/secrets-crypto'
import {
  fileKeysSnapshot,
  loadFileKeys,
  putFileKey,
  resetFileKeysCache,
} from '@/lib/file-keys-store'
import { logJournal, readJournal } from '@/lib/journal'
import {
  ALL_MODULE_IDS,
  DAY_MS,
  DEFAULT_BACKUP_CONFIG,
  WEEK_MS,
  createSnapshot,
  intervalOf,
  isDue,
  listSnapshots,
  nextDueAt,
  openSnapshot,
  parseSnapshotFile,
  readSnapshot,
  restoreSnapshot,
  snapshotFile,
  summarize,
  writeConfig,
} from '@/lib/backup'

const MASTER_A = 'мастер-устройства-A-123'
const MASTER_B = 'мастер-устройства-B-456'
const SNAP_PWD = 'пароль-снимка-7890'

const SETTINGS = { engine: 'local', model: 'qwen-7b', folder: '/архив' }
const FILES = [{ id: 'f1', name: 'договор.pdf', bytes: 12_345 }]
const CHATS = [{ id: 's1', title: 'первый разговор' }]

function wipeDb(): Promise<void> {
  resetDbHandle()
  return new Promise((resolve) => {
    const del = indexedDB.deleteDatabase(DB_NAME)
    del.onsuccess = () => resolve()
    del.onerror = () => resolve()
    del.onblocked = () => resolve()
  })
}

/** «Чистое устройство»: ни базы, ни localStorage, ни сеансов в памяти. */
async function cleanDevice(): Promise<void> {
  dropSecretsSession()
  dropMasterSession()
  resetFileKeysCache()
  await wipeDb()
  localStorage.clear()
  removeLockState()
}

type Seeded = { packedField: string; fileKeyRaw: string; noteSecret: string; journalId: string }

/** Сейф устройства A: секрет под SEK, файловый ключ и locked-стикер. */
async function seedDeviceA(): Promise<Seeded> {
  await setMasterSecret(MASTER_A)
  expect(await adoptMasterSession(MASTER_A)).toBe(true)
  expect(await ensureSecretsSession()).toBe(true)
  const master = getMasterSession()
  expect(master).not.toBeNull()

  const packedField = await sealField('e1', 'пароль-от-банка')
  expect(packedField).not.toBeNull()

  const fileKeyRaw = bytesToB64(randomBytesOf(32))
  const wrapped = await aesEncrypt(master!, fileKeyRaw)
  await putFileKey('f1', {
    v: 1,
    wct: wrapped.ctB64,
    wiv: wrapped.ivB64,
    pct: 'x',
    piv: 'y',
    kct: 'z',
    kiv: 'w',
  })

  const noteSecret = 'секрет стикера'
  const sealedNote = await aesEncrypt(master!, noteSecret)

  await docs.put('wf.settings.v1', SETTINGS)
  await docs.put('wf.files.v1', FILES)
  await docs.put('wf.chat.v1', CHATS)
  await docs.put('wf.notes.v1', [
    { id: 'n1', locked: true, secret: `${sealedNote.ctB64}:${sealedNote.ivB64}` },
    { id: 'n2', locked: false, secret: null },
  ])
  await docs.put('wf.secrets.v1', {
    version: 1,
    entries: [{ id: 'e1', title: 'Банк', fields: [{ id: 'p', value: packedField }] }],
  })

  const journalId = await logJournal('lock-setup', 'Замок включён', 'Тестовая запись до снимка')

  return { packedField: packedField!, fileKeyRaw, noteSecret, journalId }
}

describe('NF-7 · снимок всего сейфа', () => {
  beforeEach(async () => {
    await cleanDevice()
  })

  it(
    'снимок восстанавливается на чистом устройстве до идентичного состояния',
    async () => {
      const seeded = await seedDeviceA()

      const made = await createSnapshot(SNAP_PWD, ALL_MODULE_IDS, false)
      expect(made).not.toBeNull()
      const blob = made!.blob
      expect(made!.meta.hasKeys).toBe(true)

      const sum = summarize(made!.payload)
      expect(sum.modules.find((m) => m.id === 'secrets')?.items).toBe(1)
      /* библиотека: 1 файл + 2 стикера + 1 обёртка файлового ключа */
      expect(sum.modules.find((m) => m.id === 'library')?.items).toBe(4)
      expect(sum.hasKeys).toBe(true)

      /* --- чистое устройство: другой мастер-ключ, пустая база --- */
      await cleanDevice()
      await setMasterSecret(MASTER_B)
      expect(await adoptMasterSession(MASTER_B)).toBe(true)
      const masterB = getMasterSession()!

      expect(await openSnapshot('не-тот-пароль-999', blob)).toBeNull()

      const payload = await openSnapshot(SNAP_PWD, blob)
      expect(payload).not.toBeNull()

      const report = await restoreSnapshot(payload!, ALL_MODULE_IDS, 'replace')
      expect(report.docs).toBeGreaterThan(0)
      expect(report.keys.sek).toBe(true)
      expect(report.keys.files).toBe(1)
      expect(report.keys.notes).toBe(1)

      /* документы вернулись дословно */
      expect(await docs.get('wf.settings.v1')).toEqual(SETTINGS)
      expect(await docs.get('wf.files.v1')).toEqual(FILES)
      expect(await docs.get('wf.chat.v1')).toEqual(CHATS)

      /* секрет открывается ПОД НОВЫМ мастером: SEK переупакован */
      const box = (await docs.get('wf.secrets.v1')) as {
        entries: { fields: { value: string }[] }[]
      }
      const value = box.entries[0].fields[0].value
      expect(value).toBe(seeded.packedField)
      expect(await openField('e1', value)).toBe('пароль-от-банка')

      /* файловый ключ завёрнут новым мастером и даёт то же сырьё */
      resetFileKeysCache()
      await loadFileKeys()
      const blobFk = fileKeysSnapshot()['f1']
      expect(blobFk).toBeTruthy()
      expect(await aesDecrypt(masterB, blobFk.wct, blobFk.wiv)).toBe(seeded.fileKeyRaw)
      /* второй фактор (пароль файла) не менялся */
      expect(blobFk.pct).toBe('x')

      /* секрет locked-стикера читается новым мастером */
      const notes = (await docs.get('wf.notes.v1')) as { id: string; secret: string | null }[]
      const packedNote = notes.find((n) => n.id === 'n1')!.secret!
      const i = packedNote.indexOf(':')
      expect(await aesDecrypt(masterB, packedNote.slice(0, i), packedNote.slice(i + 1))).toBe(
        seeded.noteSecret,
      )

      /* журнал только дополняется: запись до снимка на месте */
      const journal = await readJournal()
      expect(journal.some((e) => e.id === seeded.journalId)).toBe(true)
      expect(journal.some((e) => e.kind === 'backup-restore')).toBe(true)
    },
    60_000,
  )

  it(
    'восстанавливаются только выбранные модули',
    async () => {
      await seedDeviceA()
      const made = await createSnapshot(SNAP_PWD, ALL_MODULE_IDS, false)
      expect(made).not.toBeNull()

      await cleanDevice()
      await setMasterSecret(MASTER_B)
      await adoptMasterSession(MASTER_B)

      const payload = await openSnapshot(SNAP_PWD, made!.blob)
      const report = await restoreSnapshot(payload!, ['settings'], 'replace')

      expect(report.modules).toEqual(['settings'])
      expect(await docs.get('wf.settings.v1')).toEqual(SETTINGS)
      expect(await docs.get('wf.files.v1')).toBeUndefined()
      expect(await docs.get('wf.secrets.v1')).toBeUndefined()
    },
    60_000,
  )

  it(
    'ротация держит ровно `keep` снимков и убирает шифртекст лишних',
    async () => {
      await seedDeviceA()
      await writeConfig({ keep: 2 })

      const first = await createSnapshot(SNAP_PWD, ['settings'], false)
      const second = await createSnapshot(SNAP_PWD, ['settings'], false)
      const third = await createSnapshot(SNAP_PWD, ['settings'], true)
      expect(first && second && third).toBeTruthy()

      const list = await listSnapshots()
      expect(list).toHaveLength(2)
      expect(list.map((m) => m.id)).toEqual([third!.meta.id, second!.meta.id])
      expect(await readSnapshot(first!.meta.id)).toBeNull()
      expect(await readSnapshot(third!.meta.id)).not.toBeNull()
      expect(list[0].auto).toBe(true)
    },
    60_000,
  )

  it(
    'файл .vaultbak разбирается обратно и открывается своим паролем',
    async () => {
      await seedDeviceA()
      const made = await createSnapshot(SNAP_PWD, ['settings'], false)
      const file = snapshotFile(made!.meta, made!.blob)
      expect(file.name.endsWith('.vaultbak')).toBe(true)

      const parsed = parseSnapshotFile(file.text)
      expect(parsed).not.toBeNull()
      expect(parsed!.modules).toEqual(['settings'])
      expect(await openSnapshot(SNAP_PWD, parsed!.blob)).not.toBeNull()
      expect(parseSnapshotFile('{"kind":"что-то-другое"}')).toBeNull()
      expect(parseSnapshotFile('не json')).toBeNull()
    },
    60_000,
  )

  it('короткий пароль и пустой список модулей снимок не делают', async () => {
    expect(await createSnapshot('123', ALL_MODULE_IDS)).toBeNull()
    expect(await createSnapshot(SNAP_PWD, [])).toBeNull()
  })

  it('просрочку расписания считает чистая функция', () => {
    expect(intervalOf('off')).toBeNull()
    expect(intervalOf('daily')).toBe(DAY_MS)
    expect(intervalOf('weekly')).toBe(WEEK_MS)

    const off = { ...DEFAULT_BACKUP_CONFIG }
    expect(nextDueAt(off)).toBeNull()
    expect(isDue(off, Date.now())).toBe(false)

    const now = 1_800_000_000_000
    const daily = { ...DEFAULT_BACKUP_CONFIG, schedule: 'daily' as const, lastAt: now }
    expect(nextDueAt(daily)).toBe(now + DAY_MS)
    expect(isDue(daily, now + DAY_MS - 1)).toBe(false)
    expect(isDue(daily, now + DAY_MS)).toBe(true)

    const weekly = { ...DEFAULT_BACKUP_CONFIG, schedule: 'weekly' as const, lastAt: now }
    expect(isDue(weekly, now + DAY_MS * 6)).toBe(false)
    expect(isDue(weekly, now + WEEK_MS)).toBe(true)

    /* Снимков не было — просрочка с первого запуска. */
    const fresh = { ...DEFAULT_BACKUP_CONFIG, schedule: 'daily' as const, lastAt: null }
    expect(isDue(fresh, now)).toBe(true)
  })
})
