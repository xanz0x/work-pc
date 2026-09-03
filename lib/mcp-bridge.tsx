'use client'

/* ============================================================
   МОСТ MCP · сторона вкладки (NF-10)
   Данные сейфа живут в этой вкладке, а не на сервере. Поэтому вкладка
   опрашивает /mcp/admin/bridge, выполняет задания внешнего агента через
   те же сторы, что и интерфейс, и возвращает результат. Каждая запись
   аудита с сервера ложится в журнал безопасности — включая отказы,
   которых вкладка сама не видела.
   ============================================================ */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { contentIndex } from '@/lib/indexer/content'
import { logJournal, type JournalKind } from '@/lib/journal'
import { DAY, HOUR } from '@/lib/notes'
import { TOOL_SCOPE, type McpToolName, type PendingView } from '@/lib/permissions'
import { useRedacted } from '@/lib/redact-context'
import { searchAll } from '@/lib/search'
import { TYPE_META, type SecretType } from '@/lib/secrets'
import { useSecrets } from '@/lib/secrets-store'
import { useNavStore, useVault } from '@/lib/vault-store'

export type BridgeJob = { id: string; tool: McpToolName; args: Record<string, unknown>; tokenName: string }
export type JobResult = { ok: boolean; payload: unknown }

type AuditEntry = {
  seq: number
  at: number
  kind: 'call' | 'denied' | 'token-issued' | 'token-revoked' | 'approval'
  tokenName: string
  tool: McpToolName | null
  ok: boolean
  detail: string
}

/* ---------- внешнее состояние для интерфейса ---------- */

export type BridgeState = { connected: boolean; lastAt: number; pending: PendingView[] }

let state: BridgeState = { connected: false, lastAt: 0, pending: [] }
const listeners = new Set<() => void>()

function setState(patch: Partial<BridgeState>): void {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useMcpBridgeState(): BridgeState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** Ручное обновление списка ожидающих — после решения из интерфейса. */
export async function refreshPending(): Promise<void> {
  const r = await fetch('/mcp/admin/pending').catch(() => null)
  if (r?.ok) setState({ pending: (await r.json()) as PendingView[] })
}

const AUDIT_KIND: Record<AuditEntry['kind'], JournalKind> = {
  call: 'mcp-call',
  denied: 'mcp-denied',
  'token-issued': 'mcp-token-issued',
  'token-revoked': 'mcp-token-revoked',
  approval: 'mcp-approval',
}

const TTL_MS: Record<string, number | null> = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY, forever: null }
const SECRET_NAME = /парол|password|ключ|key|secret|токен|token|pin|seed|фраз|cvv|cvc/i

/** Исполнитель заданий: те же сторы, что и у экранов, — и те же ограничения. */
export function useMcpExecutor(): (job: BridgeJob) => Promise<JobResult> {
  const v = useVault()
  const nav = useNavStore()
  const { redactIds } = useRedacted()
  const secrets = useSecrets()

  const ref = useRef({ v, nav, redactIds, secrets })
  useEffect(() => {
    ref.current = { v, nav, redactIds, secrets }
  })

  return useCallback(async (job: BridgeJob): Promise<JobResult> => {
    const { v, nav, redactIds, secrets } = ref.current
    const a = job.args
    const fileMeta = (id: string) => {
      const f = v.fileById(id)
      if (!f) return null
      if (redactIds.has(id)) return { kind: 'file', id, name: f.name, locked: true }
      return {
        kind: 'file',
        id,
        name: f.name,
        cluster: f.cluster,
        bytes: f.bytes,
        date: f.date,
        pages: f.pages ?? null,
        tags: f.tags ?? [],
        keywords: f.keywords ?? [],
        hasText: (f.textLen ?? 0) > 0,
        path: f.path ?? null,
        demo: f.demo === true,
      }
    }

    switch (job.tool) {
      case 'search': {
        const limit = Math.min(50, Math.max(1, Number(a.limit) || 20))
        const hits = searchAll(String(a.query), 'all', {
          files: v.files,
          notes: v.liveNotes,
          sessions: v.sessions,
          now: Date.now(),
          redactIds,
          secrets: nav.secretIndex,
          content: contentIndex(),
        })
          .filter((h) => h.kind === 'file' || h.kind === 'note' || h.kind === 'chat' || h.kind === 'secret')
          .slice(0, limit)
          .map((h) => ({ kind: h.kind, id: h.id, title: h.title, sub: h.locked ? '' : h.sub, fuzzy: h.fuzzy === true }))
        return { ok: true, payload: { total: hits.length, hits } }
      }
      case 'list_files': {
        const limit = Math.min(200, Math.max(1, Number(a.limit) || 50))
        const files = v.files.filter((f) => !a.cluster || f.cluster === a.cluster).slice(0, limit)
        return { ok: true, payload: { total: v.files.length, files: files.map((f) => fileMeta(f.id)) } }
      }
      case 'get_metadata': {
        const id = String(a.id)
        const f = fileMeta(id)
        if (f) return { ok: true, payload: f }
        const n = v.liveNotes.find((x) => x.id === id)
        if (n) {
          return {
            ok: true,
            payload: {
              kind: 'note',
              id,
              title: n.title,
              tags: n.tags,
              createdAt: n.createdAt,
              expiresAt: n.expiresAt,
              pinnedTo: n.pinnedTo ?? null,
              locked: n.locked,
              bodyLength: n.locked ? null : n.body.length,
            },
          }
        }
        const s = nav.secretIndex.find((x) => x.id === id)
        if (s) return { ok: true, payload: { kind: 'secret', id, title: s.title, type: s.type, tags: s.tags } }
        return { ok: false, payload: 'NOT_FOUND' }
      }
      case 'create_sticker': {
        const ttl = TTL_MS[String(a.ttl ?? 'forever')] ?? null
        const pinnedTo = typeof a.pinnedTo === 'string' && v.fileById(a.pinnedTo) ? a.pinnedTo : undefined
        const id = v.addNote({
          title: String(a.title).trim(),
          body: String(a.body ?? ''),
          tags: Array.isArray(a.tags) ? (a.tags as string[]).map(String) : ['mcp'],
          expiresAt: ttl === null ? null : Date.now() + ttl,
          lifeSpan: ttl,
          locked: false,
          secret: null,
          pinnedTo,
        })
        return { ok: true, payload: { kind: 'note', id, title: String(a.title).trim(), pinnedTo: pinnedTo ?? null } }
      }
      case 'create_secret': {
        if (!secrets.ready) return { ok: false, payload: 'VAULT_LOCKED' }
        const type = (typeof a.type === 'string' && a.type in TYPE_META ? a.type : 'login') as SecretType
        const fields = (a.fields as { name: string; value: string; secret?: boolean }[]).map((f) => {
          const secret = f.secret ?? SECRET_NAME.test(f.name)
          return { name: f.name.trim(), kind: secret ? ('password' as const) : ('text' as const), value: f.value, secret }
        })
        const tags = Array.isArray(a.tags) ? (a.tags as string[]).map(String) : ['mcp']
        const problem = await secrets.createEntry(type, String(a.title), fields, { tags })
        if (problem) return { ok: false, payload: problem }
        return { ok: true, payload: { kind: 'secret', created: true, title: String(a.title), type, fields: fields.length } }
      }
    }
  }, [])
}

/* ---------- цикл опроса ---------- */

const POLL_WAIT_MS = 20_000
const BACKOFF_MS = 15_000

export function McpBridge() {
  const execute = useMcpExecutor()
  const v = useVault()
  const seen = useRef<Set<string>>(new Set())
  const notifyRef = useRef(v.notify)
  useEffect(() => {
    notifyRef.current = v.notify
  })

  useEffect(() => {
    let alive = true
    let ctrl: AbortController | null = null

    async function applyAudit(list: AuditEntry[]) {
      for (const e of list) {
        const tool = e.tool ? ` · ${e.tool} (${TOOL_SCOPE[e.tool]})` : ''
        await logJournal(AUDIT_KIND[e.kind], `Токен «${e.tokenName}»${tool}`, e.detail)
      }
    }

    function announcePending(list: PendingView[]) {
      for (const p of list) {
        if (seen.current.has(p.id)) continue
        seen.current.add(p.id)
        notifyRef.current({
          kind: 'warn',
          cat: 'privacy',
          icon: 'shield',
          title: 'Агент просит записать секрет',
          body: `Токен «${p.tokenName}» · ${p.summary}. Без вашего подтверждения запись не произойдёт.`,
          link: { kind: 'setting', id: 'mcp' },
        })
      }
    }

    async function loop() {
      let wait = 0
      while (alive) {
        ctrl = new AbortController()
        try {
          const r = await fetch(`/mcp/admin/bridge?wait=${wait}`, { signal: ctrl.signal })
          wait = POLL_WAIT_MS
          if (!r.ok) {
            setState({ connected: false })
            wait = 0
            await sleep(BACKOFF_MS)
            continue
          }
          const data = (await r.json()) as {
            jobs: BridgeJob[]
            audit: AuditEntry[]
            pending: PendingView[]
            serverAt: number
          }
          setState({ connected: true, lastAt: Date.now(), pending: data.pending })
          announcePending(data.pending)
          if (data.jobs.length) {
            const results = []
            for (const job of data.jobs) {
              const res = await execute(job).catch((e: unknown) => ({
                ok: false,
                payload: e instanceof Error ? e.message : 'EXEC_FAILED',
              }))
              results.push({ id: job.id, ...res })
            }
            await fetch('/mcp/admin/bridge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ results }),
            })
          }
          if (data.audit.length) await applyAudit(data.audit)
        } catch {
          if (!alive) return
          setState({ connected: false })
          wait = 0
          await sleep(BACKOFF_MS)
        }
      }
    }

    void loop()
    return () => {
      alive = false
      ctrl?.abort()
      setState({ connected: false })
    }
  }, [execute])

  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
