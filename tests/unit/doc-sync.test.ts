import { afterEach, describe, expect, it } from 'vitest'
import {
  DOC_CHANNEL_ID,
  publishDocChange,
  readDocSyncMsg,
  resetDocSync,
  subscribeDocChange,
} from '@/lib/db/sync'

/**
 * §1.5 хвоста волны 2: документы уехали в IndexedDB, событий `storage` у
 * него нет — вкладки расходились молча. Синхронизация идёт через
 * BroadcastChannel: пишущая вкладка объявляет ключ, остальные перечитывают.
 */
describe('синхронизация документов между вкладками', () => {
  afterEach(() => {
    resetDocSync()
  })

  it('сообщение канала разбирается строго', () => {
    expect(readDocSyncMsg({ key: 'wf.files.v1', at: 5 })).toEqual({ key: 'wf.files.v1', at: 5 })
    expect(readDocSyncMsg({ key: 'wf.files.v1' })).toEqual({ key: 'wf.files.v1', at: 0 })
    expect(readDocSyncMsg({ key: '' })).toBeNull()
    expect(readDocSyncMsg({ at: 1 })).toBeNull()
    expect(readDocSyncMsg('нет')).toBeNull()
  })

  it('запись объявляется другой вкладке', async () => {
    const other = new BroadcastChannel(DOC_CHANNEL_ID)
    const got = new Promise<string>((resolve) => {
      other.onmessage = (e: MessageEvent) => resolve(readDocSyncMsg(e.data)?.key ?? '')
    })
    publishDocChange('wf.files.v1')
    expect(await got).toBe('wf.files.v1')
    other.close()
  })

  it('подписка срабатывает только на свой ключ', async () => {
    const hits: string[] = []
    const off = subscribeDocChange('wf.notes.v1', () => hits.push('notes'))
    subscribeDocChange('wf.files.v1', () => hits.push('files'))

    const other = new BroadcastChannel(DOC_CHANNEL_ID)
    other.postMessage({ key: 'wf.notes.v1', at: Date.now() })
    await new Promise((r) => setTimeout(r, 50))
    expect(hits).toEqual(['notes'])

    off()
    other.postMessage({ key: 'wf.notes.v1', at: Date.now() })
    await new Promise((r) => setTimeout(r, 50))
    expect(hits).toEqual(['notes'])
    other.close()
  })
})
