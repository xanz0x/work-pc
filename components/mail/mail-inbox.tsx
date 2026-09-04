'use client'

/* Входящие: папки → список → письмо. Один активный ящик; обновление вручную и по таймеру —
   одним IMAP-соединением (страница + папки), чтобы не плодить логины у провайдера. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconInbox, IconRefresh } from '../icons'
import { MailFolderList } from './mail-folder-list'
import { MailMsgList } from './mail-msg-list'
import { MailMsgView } from './mail-msg-view'
import { isFail, mailApi, type AccountView, type FolderView, type MessageFull, type MessageRow } from '@/lib/mail-client'
import { REFRESH_KEY, REFRESH_OPTIONS, mergeRows, readRefresh } from '@/lib/mail-format'
import { folderLabel } from '@/lib/mail-read'
import { useToast } from '@/lib/vault-store'

type Props = { account: AccountView; onAccountPatch: (id: string, patch: Partial<AccountView>) => void }

const fmtTime = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const NET_CODES = new Set(['AUTH_FAILED', 'NEEDS_APP_PASSWORD', 'CONNECT_FAILED', 'TLS_FAILED'])

export function MailInbox({ account, onAccountPatch }: Props) {
  const { flash } = useToast()
  const [folders, setFolders] = useState<FolderView[] | null>(null)
  const [folder, setFolder] = useState('INBOX')
  const [rows, setRows] = useState<MessageRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<number | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [message, setMessage] = useState<MessageFull | null>(null)
  const [msgLoading, setMsgLoading] = useState(false)
  const [msgError, setMsgError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(60)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const gen = useRef(0)
  const folderRef = useRef('INBOX')
  const syncingRef = useRef(false)
  const accId = account.id
  const accStatus = useRef(account.status)
  accStatus.current = account.status

  useEffect(() => setRefresh(readRefresh()), [])

  const patchRows = useCallback((uid: number, patch: Partial<MessageRow>) => {
    setRows((cur) => cur?.map((r) => (r.uid === uid ? { ...r, ...patch } : r)) ?? null)
  }, [])

  const bumpUnseen = useCallback((path: string, delta: number) => {
    setFolders((cur) => cur?.map((f) => (f.path === path ? { ...f, unseen: Math.max(0, (f.unseen ?? 0) + delta) } : f)) ?? null)
  }, [])

  const applyFolders = useCallback(
    (list: FolderView[], at: number) => {
      setFolders(list)
      const inbox = list.find((f) => f.path.toUpperCase() === 'INBOX')
      onAccountPatch(accId, {
        status: { ...accStatus.current, imap: 'ok', error: accStatus.current.smtp === 'fail' ? accStatus.current.error : undefined },
        imapSync: { at, unseen: inbox?.unseen ?? 0, total: inbox?.total ?? 0 },
      })
    },
    [accId, onAccountPatch],
  )

  /** Страница писем; from=null — первая (merge: поверх уже загруженных), иначе продолжение. */
  const loadPage = useCallback(
    async (path: string, from: number | null, merge: boolean, withFolders: boolean) => {
      const g = gen.current
      setListLoading(true)
      const r = await mailApi.messages(accId, path, from, { withFolders })
      if (g !== gen.current) return
      setListLoading(false)
      if (isFail(r)) {
        setListError(r.error)
        if (withFolders) setFolders((cur) => cur ?? [])
        if (NET_CODES.has(r.code)) onAccountPatch(accId, { status: { ...accStatus.current, imap: 'fail', checkedAt: Date.now(), error: `IMAP: ${r.error}` } })
        return
      }
      setListError(null)
      setTotal(r.total)
      setSyncedAt(r.syncedAt)
      if (from === null) {
        setRows((cur) => (merge && cur ? mergeRows(r.rows, cur) : r.rows))
        setCursor((cur) => (merge && cur !== null ? cur : r.nextCursor))
      } else {
        setRows((cur) => [...(cur ?? []), ...r.rows.filter((n) => !cur?.some((o) => o.uid === n.uid))])
        setCursor(r.nextCursor)
      }
      if (r.folders) applyFolders(r.folders, r.syncedAt)
      else if (from === null && r.nextCursor === null) {
        const unseen = r.rows.filter((x) => !x.seen).length
        setFolders((cur) => cur?.map((f) => (f.path === path ? { ...f, unseen, total: r.total } : f)) ?? null)
      }
    },
    [accId, applyFolders, onAccountPatch],
  )

  const sync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    await loadPage(folderRef.current, null, true, true)
    syncingRef.current = false
    setSyncing(false)
  }, [loadPage])

  /* Смена ящика: всё с нуля. */
  useEffect(() => {
    gen.current += 1
    folderRef.current = 'INBOX'
    setFolders(null)
    setFolder('INBOX')
    setRows(null)
    setCursor(null)
    setSelected(null)
    setMessage(null)
    setMsgError(null)
    setListError(null)
    void loadPage('INBOX', null, false, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accId])

  function pickFolder(path: string) {
    if (path === folder) return
    gen.current += 1
    folderRef.current = path
    setFolder(path)
    setRows(null)
    setCursor(null)
    setSelected(null)
    setMessage(null)
    setMsgError(null)
    setListError(null)
    void loadPage(path, null, false, false)
  }

  /* Таймер: стабильный колбэк через ref, тикает только на видимой вкладке. */
  const syncRef = useRef(sync)
  syncRef.current = sync
  useEffect(() => {
    if (!refresh) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void syncRef.current()
    }, refresh * 1000)
    return () => clearInterval(t)
  }, [refresh])

  function changeRefresh(v: number) {
    setRefresh(v)
    window.localStorage.setItem(REFRESH_KEY, String(v))
  }

  async function open(uid: number) {
    const g = gen.current
    setSelected(uid)
    setMsgLoading(true)
    setMsgError(null)
    const row = rows?.find((r) => r.uid === uid)
    const r = await mailApi.message(accId, folder, uid)
    if (g !== gen.current) return
    setMsgLoading(false)
    if (isFail(r)) {
      setMessage(null)
      setMsgError(r.error)
      return
    }
    setMessage(r.message)
    if (row && !row.seen && r.message.seen) {
      patchRows(uid, { seen: true })
      bumpUnseen(folder, -1)
    }
  }

  async function flag(uid: number, patch: { seen?: boolean; flagged?: boolean }) {
    const row = rows?.find((r) => r.uid === uid)
    const before = { seen: row?.seen ?? message?.seen ?? true, flagged: row?.flagged ?? message?.flagged ?? false }
    const optimistic = { ...before, ...patch }
    const seenDelta = patch.seen !== undefined && patch.seen !== before.seen ? (patch.seen ? -1 : 1) : 0
    patchRows(uid, optimistic)
    if (message?.uid === uid) setMessage((m) => (m ? { ...m, ...optimistic } : m))
    if (seenDelta) bumpUnseen(folder, seenDelta)
    const r = await mailApi.flags(accId, folder, uid, patch)
    if (isFail(r)) {
      patchRows(uid, before)
      if (message?.uid === uid) setMessage((m) => (m ? { ...m, ...before } : m))
      if (seenDelta) bumpUnseen(folder, -seenDelta)
      flash(r.error)
    }
  }

  const cur = folders?.find((f) => f.path === folder)
  const title = cur ? folderLabel(cur) : folder === 'INBOX' ? 'Входящие' : folder

  return (
    <section className="mail-inbox" aria-label="Чтение почты" data-testid="mail-inbox">
      <div className="mail-col-head mail-inbox-head">
        <span className="mail-inbox-title">
          <IconInbox width={14} height={14} aria-hidden="true" />
          <span className="label-mono">{title}</span>
          <span className="mail-inbox-acc mono" data-testid="mail-inbox-account">
            {account.email}
          </span>
        </span>
        <span className="mail-inbox-tools">
          <span className="mail-synced mono" data-testid="mail-inbox-synced">
            {syncing ? 'синхронизация…' : syncedAt ? `обновлено ${fmtTime(syncedAt)}` : ''}
          </span>
          <label className="mail-refresh">
            <span className="label-mono">обновлять</span>
            <select className="mcp-input" value={refresh} onChange={(e) => changeRefresh(Number(e.target.value))} data-testid="mail-inbox-refresh-interval">
              {REFRESH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-sm btn-ghost" onClick={() => void sync()} disabled={syncing} title="Проверить почту сейчас" data-testid="mail-inbox-refresh">
            <IconRefresh width={12} height={12} aria-hidden="true" className={syncing ? 'mail-spin' : undefined} />
            Обновить
          </button>
        </span>
      </div>
      <div className="mail-inbox-grid">
        <MailFolderList folders={folders} current={folder} onPick={pickFolder} />
        <div className="mail-list-col">
          <MailMsgList
            rows={rows}
            total={total}
            selected={selected}
            loading={listLoading}
            more={cursor !== null}
            error={listError}
            onPick={(uid) => void open(uid)}
            onStar={(r) => void flag(r.uid, { flagged: !r.flagged })}
            onMore={() => void loadPage(folder, cursor, false, false)}
          />
        </div>
        <div className="mail-view-col">
          <MailMsgView message={message} loading={msgLoading} error={msgError} onFlag={(p) => selected !== null && void flag(selected, p)} />
        </div>
      </div>
    </section>
  )
}
