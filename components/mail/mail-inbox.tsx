'use client'

/* Почтовый клиент одним экраном: рейка (ящики + папки) → список → письмо / паспорт ящика.
   Скорость: страницы папок и открытые письма кешируются на сессию, верх списка подгружается заранее,
   сервер держит IMAP-соединение открытым — повторные действия без ожидания. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconInbox, IconMail, IconPlus, IconRefresh } from '../icons'
import { MailAccountPanel } from './mail-account-panel'
import { MailAccountRow } from './mail-account-row'
import { MailFolderList } from './mail-folder-list'
import { MailMsgList } from './mail-msg-list'
import { MailMsgView } from './mail-msg-view'
import { MailTempPane } from './mail-temp-pane'
import { MailTempRail } from './mail-temp-rail'
import {
  isFail,
  mailApi,
  tempApi,
  type AccountView,
  type FolderView,
  type MessageFull,
  type MessageRow,
  type TempBoxView,
  type TempKind,
} from '@/lib/mail-client'
import { REFRESH_KEY, REFRESH_OPTIONS, letterWord, mergeRows, readRefresh } from '@/lib/mail-format'
import { folderLabel } from '@/lib/mail-read'
import { useToast } from '@/lib/vault-store'

type Props = {
  accounts: AccountView[]
  active: AccountView | null
  busyId: string | null
  enabled: boolean
  onPickAccount: (id: string) => void
  onAdd: () => void
  onTest: (id: string) => void
  onRemove: (acc: AccountView) => void
  onCompose: () => void
  onAccountPatch: (id: string, patch: Partial<AccountView>) => void
  /** Подпись в шапке экрана: адрес активного временного ящика или null (тогда показывается обычный ящик). */
  onTempAddress: (address: string | null) => void
}

type PageCache = { rows: MessageRow[]; total: number; cursor: number | null; at: number }

const fmtTime = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const NET_CODES = new Set(['AUTH_FAILED', 'NEEDS_APP_PASSWORD', 'CONNECT_FAILED', 'TLS_FAILED'])
const PREFETCH = 4
const MSG_CACHE_MAX = 60

export function MailInbox(p: Props) {
  const { accounts, active, onAccountPatch } = p
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
  /* Временные ящики живут рядом с обычными: выбран один из двух списков. */
  const [temps, setTemps] = useState<TempBoxView[]>([])
  const [tempId, setTempId] = useState<string | null>(null)
  const [tempSmailpro, setTempSmailpro] = useState(false)
  const [tempCreating, setTempCreating] = useState<TempKind | null>(null)

  const gen = useRef(0)
  const folderRef = useRef('INBOX')
  const syncingRef = useRef(false)
  const pages = useRef(new Map<string, PageCache>())
  const msgs = useRef(new Map<string, MessageFull>())
  const prefetching = useRef(new Set<string>())
  const accStatus = useRef(active?.status)
  accStatus.current = active?.status
  const accSync = useRef(active?.imapSync)
  accSync.current = active?.imapSync
  const accId = active?.id ?? null
  const hasImap = !!active?.imap

  useEffect(() => setRefresh(readRefresh()), [])

  useEffect(() => {
    void (async () => {
      const r = await tempApi.list()
      if (isFail(r)) return
      setTemps(r.boxes)
      setTempSmailpro(r.smailpro)
    })()
  }, [])

  const tempActive = temps.find((b) => b.id === tempId) ?? null

  const { onTempAddress } = p
  useEffect(() => {
    onTempAddress(tempActive?.address ?? null)
  }, [onTempAddress, tempActive])

  const patchTemp = useCallback((box: TempBoxView) => {
    setTemps((cur) => cur.map((b) => (b.id === box.id ? box : b)))
  }, [])

  async function createTemp(kind: TempKind) {
    setTempCreating(kind)
    const r = await tempApi.create(kind)
    setTempCreating(null)
    if (isFail(r)) {
      flash(r.error)
      return
    }
    setTemps((cur) => [...cur, r.box])
    setTempId(r.box.id)
    flash(`Временный адрес готов: ${r.box.address}`)
  }

  async function removeTemp(box: TempBoxView) {
    setTemps((cur) => cur.filter((b) => b.id !== box.id))
    setTempId((cur) => (cur === box.id ? null : cur))
    const r = await tempApi.remove(box.id)
    if (isFail(r)) flash(r.error)
    else flash('Временный ящик удалён')
  }

  /* Патч идёт и в кеш страницы: иначе возврат в папку показывает старый флаг. */
  const patchRows = useCallback((uid: number, patch: Partial<MessageRow>) => {
    setRows((cur) => cur?.map((r) => (r.uid === uid ? { ...r, ...patch } : r)) ?? null)
    const path = folderRef.current
    const cached = pages.current.get(path)
    if (cached) pages.current.set(path, { ...cached, rows: cached.rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)) })
  }, [])

  const bumpUnseen = useCallback(
    (path: string, delta: number) => {
      setFolders((cur) => cur?.map((f) => (f.path === path ? { ...f, unseen: Math.max(0, (f.unseen ?? 0) + delta) } : f)) ?? null)
      const sync = accSync.current
      if (path.toUpperCase() !== 'INBOX' || !accId || !sync) return
      onAccountPatch(accId, { imapSync: { ...sync, unseen: Math.max(0, sync.unseen + delta) } })
    },
    [accId, onAccountPatch],
  )

  const remember = useCallback((key: string, m: MessageFull) => {
    const map = msgs.current
    if (map.size >= MSG_CACHE_MAX) map.delete(map.keys().next().value as string)
    map.set(key, m)
  }, [])

  /* Верх списка — заранее, без пометки «прочитано»: клик по письму открывает его мгновенно. */
  const prefetch = useCallback(
    async (id: string, path: string, list: MessageRow[]) => {
      for (const r of list.slice(0, PREFETCH)) {
        const key = `${path}:${r.uid}`
        if (msgs.current.has(key) || prefetching.current.has(key) || r.size > 1_500_000) continue
        prefetching.current.add(key)
        const res = await mailApi.message(id, path, r.uid, false)
        prefetching.current.delete(key)
        if (!isFail(res)) remember(key, res.message)
      }
    },
    [remember],
  )

  const applyFolders = useCallback(
    (id: string, list: FolderView[], at: number) => {
      setFolders(list)
      const inbox = list.find((f) => f.path.toUpperCase() === 'INBOX')
      const st = accStatus.current
      if (!st) return
      onAccountPatch(id, {
        status: { ...st, imap: 'ok', error: st.smtp === 'fail' ? st.error : undefined },
        imapSync: { at, unseen: inbox?.unseen ?? 0, total: inbox?.total ?? 0 },
      })
    },
    [onAccountPatch],
  )

  const loadPage = useCallback(
    async (id: string, path: string, from: number | null, merge: boolean, withFolders: boolean) => {
      const g = gen.current
      setListLoading(true)
      const r = await mailApi.messages(id, path, from, { withFolders })
      if (g !== gen.current) return
      setListLoading(false)
      if (isFail(r)) {
        setListError(r.error)
        if (withFolders) setFolders((cur) => cur ?? [])
        if (NET_CODES.has(r.code) && accStatus.current) onAccountPatch(id, { status: { ...accStatus.current, imap: 'fail', checkedAt: Date.now(), error: `IMAP: ${r.error}` } })
        return
      }
      setListError(null)
      setTotal(r.total)
      setSyncedAt(r.syncedAt)
      let nextRows: MessageRow[] = r.rows
      let nextCursor = r.nextCursor
      const prev = pages.current.get(path)
      if (from === null) {
        if (merge && prev) {
          nextRows = mergeRows(r.rows, prev.rows)
          nextCursor = prev.cursor
        }
      } else {
        nextRows = [...(prev?.rows ?? []), ...r.rows.filter((n) => !prev?.rows.some((o) => o.uid === n.uid))]
      }
      pages.current.set(path, { rows: nextRows, total: r.total, cursor: nextCursor, at: r.syncedAt })
      /* Флаги на сервере могли измениться после того, как письмо попало в кеш: сверяем со свежими строками. */
      for (const row of nextRows) {
        const k = `${path}:${row.uid}`
        const c = msgs.current.get(k)
        if (c && (c.seen !== row.seen || c.flagged !== row.flagged)) msgs.current.set(k, { ...c, seen: row.seen, flagged: row.flagged })
      }
      setRows(nextRows)
      setCursor(nextCursor)
      if (r.folders) applyFolders(id, r.folders, r.syncedAt)
      else if (from === null && nextCursor === null) {
        const unseen = nextRows.filter((x) => !x.seen).length
        setFolders((cur) => cur?.map((f) => (f.path === path ? { ...f, unseen, total: r.total } : f)) ?? null)
      }
      void prefetch(id, path, nextRows)
    },
    [applyFolders, onAccountPatch, prefetch],
  )

  const sync = useCallback(async () => {
    if (!accId || !hasImap || syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    await loadPage(accId, folderRef.current, null, true, true)
    syncingRef.current = false
    setSyncing(false)
  }, [accId, hasImap, loadPage])

  /* Смена ящика: кеши обнуляются, всё с нуля. */
  useEffect(() => {
    gen.current += 1
    pages.current.clear()
    msgs.current.clear()
    prefetching.current.clear()
    folderRef.current = 'INBOX'
    setFolders(null)
    setFolder('INBOX')
    setRows(null)
    setTotal(0)
    setCursor(null)
    setSelected(null)
    setMessage(null)
    setMsgError(null)
    setListError(null)
    setSyncedAt(null)
    if (accId && hasImap) void loadPage(accId, 'INBOX', null, false, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accId, hasImap])

  function pickFolder(path: string) {
    if (!accId || path === folder) return
    gen.current += 1
    folderRef.current = path
    setFolder(path)
    setSelected(null)
    setMessage(null)
    setMsgError(null)
    setListError(null)
    const cached = pages.current.get(path)
    if (cached) {
      setRows(cached.rows)
      setTotal(cached.total)
      setCursor(cached.cursor)
      void loadPage(accId, path, null, true, false)
    } else {
      setRows(null)
      setCursor(null)
      void loadPage(accId, path, null, false, false)
    }
  }

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
    if (!accId) return
    const g = gen.current
    const key = `${folder}:${uid}`
    const row = rows?.find((r) => r.uid === uid)
    setSelected(uid)
    setMsgError(null)
    const cached = msgs.current.get(key)
    if (cached) {
      /* Строка списка свежее кеша письма: она приходит с каждым обновлением папки. */
      const seen = row ? row.seen : cached.seen
      setMessage({ ...cached, seen })
      setMsgLoading(false)
      if (!seen) {
        const seenMsg = { ...cached, seen: true }
        remember(key, seenMsg)
        setMessage(seenMsg)
        patchRows(uid, { seen: true })
        bumpUnseen(folder, -1)
        void mailApi.flags(accId, folder, uid, { seen: true })
      }
      return
    }
    setMsgLoading(true)
    const r = await mailApi.message(accId, folder, uid, true)
    if (g !== gen.current) return
    setMsgLoading(false)
    if (isFail(r)) {
      setMessage(null)
      setMsgError(r.error)
      return
    }
    remember(key, r.message)
    setMessage(r.message)
    if (row && !row.seen && r.message.seen) {
      patchRows(uid, { seen: true })
      bumpUnseen(folder, -1)
    }
  }

  async function flag(uid: number, patch: { seen?: boolean; flagged?: boolean }) {
    if (!accId) return
    const key = `${folder}:${uid}`
    /* Источник истины — открытое письмо, если это оно: строка списка могла устареть после фонового обновления. */
    const src = message?.uid === uid ? message : rows?.find((r) => r.uid === uid)
    const revert: Partial<MessageRow> = {}
    if (patch.seen !== undefined) revert.seen = src?.seen ?? true
    if (patch.flagged !== undefined) revert.flagged = src?.flagged ?? false
    const seenDelta = patch.seen !== undefined && patch.seen !== revert.seen ? (patch.seen ? -1 : 1) : 0
    const apply = (v: Partial<MessageRow>) => {
      patchRows(uid, v)
      const c = msgs.current.get(key)
      if (c) remember(key, { ...c, ...v })
      if (message?.uid === uid) setMessage((m) => (m ? { ...m, ...v } : m))
    }
    apply(patch)
    if (seenDelta) bumpUnseen(folder, seenDelta)
    const r = await mailApi.flags(accId, folder, uid, patch)
    if (isFail(r)) {
      apply(revert)
      if (seenDelta) bumpUnseen(folder, -seenDelta)
      flash(r.error)
    }
  }

  const cur = folders?.find((f) => f.path === folder)
  const title = cur ? folderLabel(cur) : folder === 'INBOX' ? 'Входящие' : folder

  return (
    <div className="mail-client" data-testid="mail-inbox">
      <aside className="mail-rail" aria-label="Ящики и папки">
        <div className="mail-rail-sec">
          <span className="label-mono">Ящики</span>
          <span className="mail-rail-sec-r">
            <span className="mail-count num" data-testid="mail-account-count">
              {accounts.length}
            </span>
            <button className="mail-rail-plus" onClick={p.onAdd} disabled={!p.enabled} title="Добавить ящик" aria-label="Добавить ящик" data-testid="mail-add">
              <IconPlus width={12} height={12} aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="mail-acc-rows" data-testid="mail-account-list">
          {accounts.map((a) => (
            <MailAccountRow
              key={a.id}
              account={a}
              active={a.id === accId && !tempActive}
              onPick={() => {
                setTempId(null)
                p.onPickAccount(a.id)
              }}
              onRemove={() => p.onRemove(a)}
            />
          ))}
          {accounts.length === 0 && (
            <div className="mail-rail-empty" data-testid="mail-empty">
              Ящиков пока нет.
              <button className="btn btn-ghost btn-sm" onClick={p.onAdd} disabled={!p.enabled} data-testid="mail-add-empty">
                <IconPlus width={12} height={12} aria-hidden="true" /> Добавить ящик
              </button>
            </div>
          )}
        </div>
        <MailTempRail
          boxes={temps}
          activeId={tempActive ? tempId : null}
          smailpro={tempSmailpro}
          creating={tempCreating}
          onPick={(id) => setTempId(id)}
          onCreate={(kind) => void createTemp(kind)}
          onRemove={(box) => void removeTemp(box)}
        />
        {!tempActive && active && hasImap && (
          <>
            <div className="mail-rail-sec">
              <span className="label-mono">Папки</span>
            </div>
            <MailFolderList folders={folders} current={folder} onPick={pickFolder} />
          </>
        )}
        {!tempActive && active && !hasImap && (
          <p className="mail-rail-note" data-testid="mail-inbox-no-imap">
            IMAP не настроен — ящик только отправляет письма.
          </p>
        )}
      </aside>

      {tempActive ? (
        <MailTempPane box={tempActive} onBox={patchTemp} onRemove={() => void removeTemp(tempActive)} />
      ) : (
        <>
          <section className="mail-list-col" aria-label="Список писем">
        {active && hasImap ? (
          <>
            <div className="mail-list-head">
              <span className="mail-inbox-title">
                <IconInbox width={13} height={13} aria-hidden="true" />
                <span className="label-mono">{title}</span>
                <span className="mail-count num">{rows ? `${total} ${letterWord(total)}` : ''}</span>
              </span>
              <span className="mail-inbox-tools">
                <span className="mail-synced mono" data-testid="mail-inbox-synced" title={syncedAt ? `обновлено ${new Date(syncedAt).toLocaleTimeString('ru-RU')}` : ''}>
                  {syncing ? 'синхронизация…' : syncedAt ? fmtTime(syncedAt) : ''}
                </span>
                <select className="mcp-input mail-refresh-sel" value={refresh} onChange={(e) => changeRefresh(Number(e.target.value))} title="Автообновление" aria-label="Автообновление" data-testid="mail-inbox-refresh-interval">
                  {REFRESH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button className="mail-rail-plus" onClick={() => void sync()} disabled={syncing} title="Проверить почту сейчас" aria-label="Обновить" data-testid="mail-inbox-refresh">
                  <IconRefresh width={12} height={12} aria-hidden="true" className={syncing ? 'mail-spin' : undefined} />
                </button>
              </span>
            </div>
            <MailMsgList
              rows={rows}
              total={total}
              selected={selected}
              loading={listLoading}
              more={cursor !== null}
              error={listError}
              onPick={(uid) => void open(uid)}
              onStar={(r) => void flag(r.uid, { flagged: !r.flagged })}
              onMore={() => accId && void loadPage(accId, folder, cursor, false, false)}
            />
          </>
        ) : (
          <div className="mail-view-state" data-testid="mail-list-idle">
            <span className="mail-empty-ico" aria-hidden="true">
              <IconMail />
            </span>
            <span>{active ? 'Чтение недоступно: у ящика нет IMAP.' : 'Добавьте ящик — настройки найдём сами.'}</span>
          </div>
        )}
      </section>

      <section className="mail-view-col" aria-label="Письмо">
        {selected !== null ? (
          <MailMsgView message={message} loading={msgLoading} error={msgError} onFlag={(pt) => void flag(selected, pt)} onBack={() => setSelected(null)} />
        ) : active ? (
          <MailAccountPanel account={active} busy={p.busyId === active.id} onTest={() => p.onTest(active.id)} onRemove={() => p.onRemove(active)} onCompose={p.onCompose} />
        ) : (
          <div className="mail-view-state" data-testid="mail-msg-view-empty">
            <span className="mail-empty-ico" aria-hidden="true">
              <IconMail />
            </span>
            <b>Почта в одном окне</b>
            <span>Gmail, Яндекс, Mail.ru, iCloud, Proton, свой домен — пароль хранится на сервере зашифрованным.</span>
            <button className="btn btn-primary btn-sm" onClick={p.onAdd} disabled={!p.enabled} data-testid="mail-add-hero">
              <IconPlus width={12} height={12} aria-hidden="true" /> Добавить ящик
            </button>
          </div>
        )}
          </section>
        </>
      )}
    </div>
  )
}
