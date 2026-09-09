'use client'

/* ============================================================
   NF-11 · ДВИЖОК СИНХРОНИЗАЦИИ (сторона вкладки)
   Смотрит на файлы, стикеры и ленту уведомлений, превращает локальные
   правки в операции CRDT, шифрует их ключом синхронизации и отправляет
   в слепое хранилище; чужие операции забирает long-poll'ом,
   расшифровывает, сливает и подменяет состояние сторов.
   Ключ живёт в localStorage этого браузера (`wf.sync.v1`), состояние
   CRDT — в IndexedDB (`wf.sync.crdt.v1`). Секреты и стикеры под
   локальным ключом наружу не уходят.
   ============================================================ */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { loadPersisted, savePersisted } from '@/lib/db/persist'
import { docRemove } from '@/lib/db/idb'
import { logJournal } from '@/lib/journal'
import type { Note } from '@/lib/notes'
import type { VaultFile } from '@/lib/data'
import { useDataStore } from '@/lib/store/data'
import { useNotifsStore, type Notif } from '@/lib/store/notifs'
import {
  applyOp,
  diffLocal,
  emptyState,
  makeClock,
  materialize,
  type CrdtState,
  type Op,
} from './crdt'
import {
  entropyToHex,
  hexToEntropy,
  keysFromEntropy,
  newEntropy,
  openJson,
  openOps,
  sealJson,
  sealOps,
  wordsFromEntropy,
  type SyncKeys,
} from './crypto'

export const SYNC_CONFIG_KEY = 'wf.sync.v1'
const CRDT_KEY = 'wf.sync.crdt.v1'

type Config = {
  v: 1
  entropy: string
  spaceId: string
  deviceId: string
  token: string
  label: string
  lastSeq: number
  n: number
}

export type DeviceView = {
  id: string
  label: string
  createdAt: number
  lastSeenAt: number
  revokedAt: number | null
  self: boolean
}

export type SyncStatus = 'off' | 'connecting' | 'live' | 'error'

export type SyncState = {
  status: SyncStatus
  spaceId: string | null
  deviceId: string | null
  label: string
  lastSyncAt: number | null
  pushed: number
  pulled: number
  devices: DeviceView[]
  error: string | null
}

const OFF: SyncState = {
  status: 'off',
  spaceId: null,
  deviceId: null,
  label: '',
  lastSyncAt: null,
  pushed: 0,
  pulled: 0,
  devices: [],
  error: null,
}

let state: SyncState = OFF
const listeners = new Set<() => void>()
function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, () => state, () => OFF)
}

function readConfig(): Config | null {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY)
    const c = raw ? (JSON.parse(raw) as Config) : null
    return c && c.v === 1 && hexToEntropy(c.entropy) ? c : null
  } catch {
    return null
  }
}
function writeConfig(c: Config | null): void {
  if (c) localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(c))
  else localStorage.removeItem(SYNC_CONFIG_KEY)
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

/* ---------- сетевой слой ---------- */

function headers(c: Config): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Sync-Space': c.spaceId,
    'X-Sync-Device': c.deviceId,
    'X-Sync-Token': c.token,
  }
}

/* ---------- движок ---------- */

type Snapshot = { files: VaultFile[]; notes: Note[]; notifs: Notif[] }
type Apply = (s: Partial<Snapshot>) => void

const SKIP: Record<keyof Snapshot, string[]> = { files: ['processing'], notes: [], notifs: [] }

class Engine {
  private cfg: Config
  private keys: SyncKeys
  private crdt: CrdtState = emptyState()
  private clock
  private alive = true
  private ctrl: AbortController | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pushQueue: Op[] = []
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private snapshot: Snapshot | null = null
  onRemote: Apply = () => {}

  constructor(cfg: Config, keys: SyncKeys) {
    this.cfg = cfg
    this.keys = keys
    this.clock = makeClock(cfg.deviceId)
  }

  async start(): Promise<void> {
    const stored = await loadPersisted<CrdtState>(CRDT_KEY)
    if (stored?.v === 1) this.crdt = stored
    setState({
      status: 'connecting',
      spaceId: this.cfg.spaceId,
      deviceId: this.cfg.deviceId,
      label: this.cfg.label,
      error: null,
    })
    void this.loop()
  }

  stop(): void {
    this.alive = false
    this.ctrl?.abort()
  }

  /** Локальные сторы изменились: считаем разницу и отправляем. */
  localChanged(snap: Snapshot): void {
    this.snapshot = snap
    const nextN = () => ++this.cfg.n
    const ops: Op[] = []
    for (const col of ['files', 'notes', 'notifs'] as const) {
      const current = col === 'notes' ? snap.notes.filter((n) => !n.locked) : snap[col]
      ops.push(...diffLocal(this.crdt, col, current as { id: string }[], this.clock, nextN, SKIP[col]))
    }
    if (ops.length > 0) {
      writeConfig(this.cfg)
      this.persist()
      this.pushQueue.push(...ops)
      if (!this.pushTimer) this.pushTimer = setTimeout(() => void this.flush(), 400)
    }
    /* Чужие операции могли прийти до первого снимка — доносим их в сторы. */
    this.emit()
  }

  private async flush(): Promise<void> {
    this.pushTimer = null
    const ops = this.pushQueue.splice(0)
    if (ops.length === 0 || !this.alive) return
    try {
      const chunks: Op[][] = []
      for (let i = 0; i < ops.length; i += 200) chunks.push(ops.slice(i, i + 200))
      const sealed = await Promise.all(chunks.map((c) => sealOps(this.keys.key, c)))
      const r = await fetch('/sync/ops', { method: 'POST', headers: headers(this.cfg), body: JSON.stringify({ ops: sealed }) })
      if (r.status === 403) return this.fail('Устройство отозвано или пространство недоступно')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setState({ pushed: state.pushed + ops.length, lastSyncAt: Date.now(), status: 'live', error: null })
    } catch (e) {
      /* Не потеряно: операции уже в CRDT и уйдут при следующей правке или перезапуске. */
      this.pushQueue.unshift(...ops)
      setState({ status: 'error', error: e instanceof Error ? e.message : 'сеть' })
      if (!this.pushTimer) this.pushTimer = setTimeout(() => void this.flush(), 5000)
    }
  }

  private fail(msg: string): void {
    setState({ status: 'error', error: msg })
  }

  private async loop(): Promise<void> {
    let wait = 0
    while (this.alive) {
      this.ctrl = new AbortController()
      try {
        const r = await fetch(`/sync/ops?since=${this.cfg.lastSeq}&wait=${wait}`, {
          headers: headers(this.cfg),
          signal: this.ctrl.signal,
        })
        wait = 20_000
        if (r.status === 403) {
          this.fail('Устройство отозвано владельцем на другом устройстве')
          await sleep(30_000)
          continue
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = (await r.json()) as {
          ops: { seq: number; dev: string; ct: string; iv: string }[]
          seq: number
          devices: { id: string; label: { ct: string; iv: string }; createdAt: number; lastSeenAt: number; revokedAt: number | null }[]
        }
        let changed = false
        let count = 0
        for (const env of data.ops) {
          const ops = await openOps(this.keys.key, env)
          if (!ops) continue
          for (const op of ops) {
            this.clock.observe(op.ts)
            if (applyOp(this.crdt, op)) changed = true
            count += 1
          }
        }
        if (data.seq !== this.cfg.lastSeq) {
          this.cfg.lastSeq = data.seq
          writeConfig(this.cfg)
        }
        if (changed) {
          this.persist()
          this.emit()
        }
        const devices: DeviceView[] = []
        for (const d of data.devices) {
          const label = (await openJson(this.keys.key, d.label)) as string | null
          devices.push({ ...d, label: typeof label === 'string' ? label : '—', self: d.id === this.cfg.deviceId })
        }
        setState({
          status: 'live',
          error: null,
          devices,
          pulled: state.pulled + count,
          lastSyncAt: count ? Date.now() : state.lastSyncAt ?? Date.now(),
        })
      } catch (e) {
        if (!this.alive) return
        wait = 0
        setState({ status: 'error', error: e instanceof Error ? e.message : 'сеть' })
        await sleep(10_000)
      }
    }
  }

  /** Материализованное состояние → сторы (только если что-то отличается). */
  private emit(): void {
    const snap = this.snapshot
    /* До первого снимка сторы ещё не прочитаны из базы — подменять их нельзя. */
    if (!snap) return
    const patch: Partial<Snapshot> = {}
    const files = materialize<VaultFile>(this.crdt, 'files', snap.files.map((f) => f.id))
    if (JSON.stringify(files) !== JSON.stringify(snap.files)) patch.files = files
    const remoteNotes = materialize<Note>(this.crdt, 'notes', snap.notes.map((n) => n.id))
    const lockedLocal = snap.notes.filter((n) => n.locked)
    const notes = [...remoteNotes.filter((n) => !lockedLocal.some((l) => l.id === n.id)), ...lockedLocal]
    if (JSON.stringify(notes) !== JSON.stringify(snap.notes)) patch.notes = notes
    const notifs = materialize<Notif>(this.crdt, 'notifs', snap.notifs.map((n) => n.id))
    if (JSON.stringify(notifs) !== JSON.stringify(snap.notifs)) patch.notifs = notifs
    if (Object.keys(patch).length) this.onRemote(patch)
  }

  private persist(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      savePersisted(CRDT_KEY, this.crdt)
    }, 300)
  }

  async words(): Promise<string[]> {
    return wordsFromEntropy(hexToEntropy(this.cfg.entropy)!)
  }

  async revoke(id: string): Promise<boolean> {
    const r = await fetch(`/sync/devices?id=${id}`, { method: 'DELETE', headers: headers(this.cfg) })
    return r.ok
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ---------- управление: одна живая копия движка на вкладку ---------- */

let engine: Engine | null = null
let onRemoteRef: Apply = () => {}

async function boot(cfg: Config): Promise<void> {
  const keys = await keysFromEntropy(hexToEntropy(cfg.entropy)!)
  engine?.stop()
  engine = new Engine(cfg, keys)
  engine.onRemote = (p) => onRemoteRef(p)
  await engine.start()
}

/** Включить: новая фраза (entropy=null) или присоединение по словам. */
export async function enableSync(label: string, entropy: Uint8Array | null): Promise<string | null> {
  const ent = entropy ?? newEntropy()
  const keys = await keysFromEntropy(ent)
  const deviceId = randomHex(8)
  const sealedLabel = await sealJson(keys.key, label.trim() || 'Это устройство')
  const r = await fetch('/sync/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId: keys.spaceId, spacePass: keys.spacePass, deviceId, label: sealedLabel }),
  })
  if (r.status === 403) return 'Фраза не подходит: такое пространство уже есть, а пароль не совпал'
  if (!r.ok) return `Сервер отказал: HTTP ${r.status}`
  const { token, created } = (await r.json()) as { token: string; created: boolean }
  const cfg: Config = {
    v: 1,
    entropy: entropyToHex(ent),
    spaceId: keys.spaceId,
    deviceId,
    token,
    label: label.trim() || 'Это устройство',
    lastSeq: 0,
    n: 0,
  }
  writeConfig(cfg)
  await docRemove(CRDT_KEY).catch(() => {})
  await boot(cfg)
  void logJournal(
    'sync-enabled',
    created ? 'Синхронизация включена' : 'Устройство присоединено',
    `${created ? 'Создано новое пространство' : 'Присоединение к существующему пространству'} · устройство «${cfg.label}» · пространство ${keys.spaceId.slice(0, 8)}…`,
  )
  return null
}

/** Выключить на этом устройстве: отозвать себя на сервере, стереть ключ и состояние. */
export async function disableSync(): Promise<void> {
  const cfg = readConfig()
  if (cfg) {
    await fetch(`/sync/devices?id=${cfg.deviceId}`, { method: 'DELETE', headers: headers(cfg) }).catch(() => {})
    void logJournal('sync-disabled', 'Синхронизация выключена', `Устройство «${cfg.label}» вышло из пространства; ключ стёрт с этого устройства`)
  }
  engine?.stop()
  engine = null
  writeConfig(null)
  await docRemove(CRDT_KEY).catch(() => {})
  setState(OFF)
}

export async function revokeSyncDevice(id: string, label: string): Promise<boolean> {
  const ok = (await engine?.revoke(id)) ?? false
  if (ok) void logJournal('sync-device-revoked', 'Устройство отозвано', `«${label}» больше не получает и не пишет изменения. Оно всё ещё знает фразу: смените её, если устройство утеряно`)
  return ok
}

export async function syncWords(): Promise<string[] | null> {
  return engine ? engine.words() : null
}

/* ---------- провайдер ---------- */

export function SyncProvider() {
  const D = useDataStore()
  const N = useNotifsStore()
  const S = useSyncState()
  const ready = D.ready && N.ready
  const applyRef = useRef<Apply>(() => {})

  useEffect(() => {
    applyRef.current = (p) => {
      if (p.files) D.replaceFiles(p.files)
      if (p.notes) D.replaceNotes(p.notes)
      if (p.notifs) N.replaceNotifs(p.notifs)
    }
  })

  useEffect(() => {
    onRemoteRef = (p) => applyRef.current(p)
    const cfg = readConfig()
    if (cfg && !engine) void boot(cfg)
    return () => {
      engine?.stop()
      engine = null
      setState(OFF)
    }
  }, [])

  useEffect(() => {
    if (!ready || S.status === 'off') return
    engine?.localChanged({ files: D.files, notes: D.notes, notifs: N.notifs })
  }, [ready, D.files, D.notes, N.notifs, S.status])

  return null
}
