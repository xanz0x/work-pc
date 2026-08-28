'use client'

/* ============================================================
   SECRETS-STORE v1 · состояние менеджера секретов
   Живёт ПОВЕРХ замка: без открытого сеанса мастера модуль ничего
   не расшифровывает и ничего не сохраняет (никаких plaintext-путей).
   Хранилища: wf.secrets.v1 / .folders.v1 / .settings.v1 / .backups.v1
   Всё через usePersistedState — как остальной сейф.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { useVault } from './vault-store'
import {
  DEFAULT_SECRETS_SETTINGS,
  EMPTY_SECRETS,
  SECRETS_BACKUPS_KEY,
  SECRETS_FOLDERS_KEY,
  SECRETS_KEY,
  SECRETS_SETTINGS_KEY,
  TYPE_META,
  blankRecord,
  domainOf,
  isLive,
  migrateSecrets,
  sid,
  type ClipTarget,
  type SecretField,
  type SecretFolder,
  type SecretRecord,
  type SecretType,
  type SecretsFile,
  type SecretsSettings,
} from './secrets'
import {
  dropSecretsSession,
  ensureSecretsSession,
  isPortableBlob,
  isSealed,
  openField,
  openPortable,
  openWithMaster,
  sealField,
  sealPortable,
  sealWithMaster,
} from './secrets-crypto'
import type { ImportDraft, ImportPreview } from './secrets-io'
import { totpCode } from './secrets-totp'

const MAX_BACKUPS = 5

type BackupRec = { at: number; count: number; ct: string; iv: string; auto: boolean }

export type ClipState = { label: string; until: number; target: ClipTarget } | null

export type SecretsCtx = {
  ready: boolean
  /** Замок выключен — модуль честно просит его включить. */
  needsLock: boolean
  entries: SecretRecord[]
  live: SecretRecord[]
  trash: SecretRecord[]
  folders: SecretFolder[]
  settings: SecretsSettings
  setSettings: (fn: (s: SecretsSettings) => SecretsSettings) => void

  createEntry: (
    type: SecretType,
    title: string,
    fields: { name: string; kind: SecretField['kind']; value: string; secret: boolean }[],
    extra?: Partial<Pick<SecretRecord, 'tags' | 'folderId' | 'favorite' | 'expiredAfter'>>,
    totpSecret?: string | null,
  ) => Promise<string | null>
  updateEntry: (
    id: string,
    patch: {
      title?: string
      tags?: string[]
      folderId?: string | null
      favorite?: boolean
      expiredAfter?: number | null
      fields?: { id?: string; name: string; kind: SecretField['kind']; value: string; secret: boolean }[]
      totpSecret?: string | null
    },
  ) => Promise<string | null>
  toggleFavorite: (id: string) => void
  softDelete: (id: string) => void
  restoreEntry: (id: string) => void
  purgeEntry: (id: string) => void
  purgeAll: () => void

  addFolder: (name: string) => void
  renameFolder: (id: string, name: string) => void
  removeFolder: (id: string) => void

  /** Расшифровать значение поля (для показа/копирования). */
  openValue: (entryId: string, fieldId: string) => Promise<string | null>
  /** Все значения записи в открытом виде — редактор и экспорт. */
  openEntry: (entryId: string) => Promise<Record<string, string> | null>
  openTotpSecret: (entryId: string) => Promise<string | null>
  totpNow: (entryId: string) => Promise<{ code: string; remaining: number } | null>

  clip: ClipState
  copySecret: (value: string, target: ClipTarget, label: string) => Promise<void>
  clearClipboard: () => Promise<void>

  applyImport: (preview: ImportPreview) => Promise<{ added: number; failed: number }>
  exportPlain: (format: 'csv' | 'json') => Promise<string | null>
  exportEncrypted: (password: string) => Promise<string | null>
  importEncrypted: (password: string, text: string) => Promise<ImportPreview | null>

  backups: { at: number; count: number; auto: boolean }[]
  backupNow: (auto?: boolean) => Promise<boolean>
  /** Восстановление ЗАМЕНЯЕТ текущий состав сейфа снимком (не дублирует). */
  restoreBackup: (at: number) => Promise<number | null>
  removeBackup: (at: number) => void

  loadIcon: (entryId: string) => Promise<void>
  /** Счётчик закрытий раскрытых значений: экраны прячут reveal по нему. */
  hideEpoch: number
  hideAll: () => void
}

const Ctx = createContext<SecretsCtx | null>(null)

export function useSecrets(): SecretsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSecrets вызван вне SecretsProvider')
  return v
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* нет разрешения — пробуем ниже */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function SecretsProvider({ children }: { children: ReactNode }) {
  const v = useVault()
  const [box, setBox] = usePersistedState<SecretsFile>(SECRETS_KEY, EMPTY_SECRETS)
  const [folders, setFolders] = usePersistedState<SecretFolder[]>(SECRETS_FOLDERS_KEY, [])
  const [settings, setSettingsRaw] = usePersistedState<SecretsSettings>(
    SECRETS_SETTINGS_KEY,
    DEFAULT_SECRETS_SETTINGS,
  )
  const [backupRecs, setBackupRecs] = usePersistedState<BackupRec[]>(SECRETS_BACKUPS_KEY, [])

  const [ready, setReady] = useState(false)
  const [clip, setClip] = useState<ClipState>(null)
  const [hideEpoch, setHideEpoch] = useState(0)
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entriesRef = useRef<SecretRecord[]>(box.entries)
  entriesRef.current = box.entries

  const status = v.lock.status
  const needsLock = status === 'off'

  /* Формат приводится к v1 идемпотентно при первом чтении. */
  useEffect(() => {
    const fixed = migrateSecrets(box)
    if (fixed.entries.length !== box.entries.length || box.version !== 1) {
      setBox(fixed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Сеанс ключа сейфа секретов: появляется вместе с сеансом мастера. */
  useEffect(() => {
    let alive = true
    if (status !== 'unlocked') {
      dropSecretsSession()
      setReady(false)
      return
    }
    /* adoptMasterSession выполняется экраном блокировки чуть раньше нас;
       на всякий случай пробуем несколько раз в течение секунды. */
    let tries = 0
    const attempt = async () => {
      const ok = await ensureSecretsSession()
      if (!alive) return
      if (ok) setReady(true)
      else if (tries++ < 10) setTimeout(attempt, 120)
    }
    void attempt()
    return () => {
      alive = false
    }
  }, [status, v.lockEpoch])

  /* Panic Lock+: замок закрылся — буфер чистим, раскрытия гасим, ключи обнуляем. */
  const prevEpoch = useRef(v.lockEpoch)
  useEffect(() => {
    if (v.lockEpoch === prevEpoch.current) return
    prevEpoch.current = v.lockEpoch
    dropSecretsSession()
    setHideEpoch((n) => n + 1)
    if (clipTimer.current) clearTimeout(clipTimer.current)
    setClip(null)
    void writeClipboard('')
  }, [v.lockEpoch])

  /* Индекс для глобального поиска: только title/type/tags — содержимое не отдаём. */
  useEffect(() => {
    if (status !== 'unlocked') {
      v.setSecretIndex([])
      return
    }
    v.setSecretIndex(
      box.entries
        .filter(isLive)
        .map((e) => ({ id: e.id, title: e.title, type: TYPE_META[e.type].label, tags: e.tags })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.entries, status])

  const setSettings = useCallback(
    (fn: (s: SecretsSettings) => SecretsSettings) =>
      setSettingsRaw((prev) => ({ ...fn(prev), excludeFromAi: true })),
    [setSettingsRaw],
  )

  const live = useMemo(() => box.entries.filter(isLive), [box.entries])
  const trash = useMemo(() => box.entries.filter((e) => !isLive(e)), [box.entries])

  const write = useCallback(
    (fn: (all: SecretRecord[]) => SecretRecord[]) =>
      setBox((prev) => ({ version: 1, entries: fn(prev.entries) })),
    [setBox],
  )

  /* ---------- CRUD ---------- */

  const sealAll = useCallback(
    async (
      entryId: string,
      fields: { id?: string; name: string; kind: SecretField['kind']; value: string; secret: boolean }[],
    ): Promise<SecretField[] | null> => {
      const out: SecretField[] = []
      for (const f of fields) {
        if (f.secret && f.value) {
          const packed = isSealed(f.value) ? f.value : await sealField(entryId, f.value)
          if (packed === null) return null
          out.push({ id: f.id ?? sid('fld'), name: f.name, kind: f.kind, value: packed, secret: true })
        } else {
          out.push({
            id: f.id ?? sid('fld'),
            name: f.name,
            kind: f.kind,
            value: f.secret ? '' : f.value,
            secret: f.secret,
          })
        }
      }
      return out
    },
    [],
  )

  const createEntry = useCallback<SecretsCtx['createEntry']>(
    async (type, title, fields, extra, totpSecret) => {
      if (!ready) return 'Сейф закрыт — разблокируйте замок'
      const base = blankRecord(type, extra?.folderId ?? null)
      const sealed = await sealAll(base.id, fields)
      if (!sealed) return 'Нет сеанса мастера — запись не сохранена'
      let totp = null as SecretRecord['totp']
      if (totpSecret) {
        const packed = await sealField(base.id, totpSecret)
        if (!packed) return 'Не удалось зашифровать TOTP-секрет'
        totp = { secret: packed, issuer: '', account: '', period: 30, digits: 6, algorithm: 'SHA1' }
      }
      const rec: SecretRecord = {
        ...base,
        title: title.trim() || TYPE_META[type].label,
        fields: sealed,
        totp,
        tags: extra?.tags ?? [],
        favorite: extra?.favorite ?? false,
        expiredAfter: extra?.expiredAfter ?? null,
      }
      write((all) => [rec, ...all])
      v.notify({
        kind: 'ok',
        cat: 'privacy',
        icon: 'key',
        title: 'Запись добавлена в сейф секретов',
        body: `«${rec.title}» · ${TYPE_META[type].label}. Секретные поля зашифрованы AES-GCM.`,
      })
      return null
    },
    [ready, sealAll, v, write],
  )

  const updateEntry = useCallback<SecretsCtx['updateEntry']>(
    async (id, patch) => {
      if (!ready) return 'Сейф закрыт — разблокируйте замок'
      const cur = entriesRef.current.find((e) => e.id === id)
      if (!cur) return 'Запись не найдена'

      let fields = cur.fields
      let history = cur.history
      if (patch.fields) {
        const sealed = await sealAll(id, patch.fields)
        if (!sealed) return 'Нет сеанса мастера — изменения не сохранены'
        /* История: снапшот прежнего шифртекста изменённых секретных полей. */
        const changed = cur.fields.filter((old) => {
          const next = sealed.find((f) => f.id === old.id)
          return old.secret && old.value && next && next.value !== old.value
        })
        history = [
          ...changed.map((f) => ({ at: Date.now(), fieldId: f.id, fieldName: f.name, prevCt: f.value })),
          ...cur.history,
        ].slice(0, 20)
        fields = sealed
      }

      let totp = cur.totp ?? null
      if (patch.totpSecret !== undefined) {
        if (!patch.totpSecret) totp = null
        else if (!isSealed(patch.totpSecret)) {
          const packed = await sealField(id, patch.totpSecret)
          if (!packed) return 'Не удалось зашифровать TOTP-секрет'
          totp = {
            secret: packed,
            issuer: totp?.issuer ?? '',
            account: totp?.account ?? '',
            period: totp?.period ?? 30,
            digits: totp?.digits ?? 6,
            algorithm: totp?.algorithm ?? 'SHA1',
          }
        }
      }

      write((all) =>
        all.map((e) =>
          e.id === id
            ? {
                ...e,
                title: patch.title?.trim() || e.title,
                tags: patch.tags ?? e.tags,
                folderId: patch.folderId !== undefined ? patch.folderId : e.folderId,
                favorite: patch.favorite ?? e.favorite,
                expiredAfter: patch.expiredAfter !== undefined ? patch.expiredAfter : e.expiredAfter,
                fields,
                totp,
                history,
                updatedAt: Date.now(),
              }
            : e,
        ),
      )
      return null
    },
    [ready, sealAll, write],
  )

  const toggleFavorite = useCallback(
    (id: string) =>
      write((all) => all.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e))),
    [write],
  )

  const softDelete = useCallback(
    (id: string) => {
      write((all) => all.map((e) => (e.id === id ? { ...e, deletedAt: Date.now() } : e)))
      v.flash('Запись перемещена в корзину сейфа секретов.')
    },
    [v, write],
  )

  const restoreEntry = useCallback(
    (id: string) => write((all) => all.map((e) => (e.id === id ? { ...e, deletedAt: null } : e))),
    [write],
  )

  const purgeEntry = useCallback(
    (id: string) => {
      const gone = entriesRef.current.find((e) => e.id === id)
      write((all) => all.filter((e) => e.id !== id))
      v.notify({
        kind: 'warn',
        cat: 'privacy',
        icon: 'trash',
        title: 'Запись удалена безвозвратно',
        body: `«${gone?.title ?? id}» стёрта из сейфа секретов вместе с шифртекстом.`,
      })
    },
    [v, write],
  )

  const purgeAll = useCallback(() => {
    write((all) => all.filter(isLive))
    v.flash('Корзина сейфа секретов очищена.')
  }, [v, write])

  /* ---------- папки ---------- */

  const PALETTE = ['47,190,126', '120,160,220', '210,160,90', '190,120,190', '150,180,140']

  const addFolder = useCallback(
    (name: string) => {
      const clean = name.trim()
      if (!clean) return
      setFolders((prev) => [
        ...prev,
        { id: sid('fol'), name: clean.slice(0, 40), rgb: PALETTE[prev.length % PALETTE.length] },
      ])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setFolders],
  )

  const renameFolder = useCallback(
    (id: string, name: string) =>
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: name.slice(0, 40) } : f))),
    [setFolders],
  )

  const removeFolder = useCallback(
    (id: string) => {
      setFolders((prev) => prev.filter((f) => f.id !== id))
      write((all) => all.map((e) => (e.folderId === id ? { ...e, folderId: null } : e)))
    },
    [setFolders, write],
  )

  /* ---------- расшифровка ---------- */

  const openValue = useCallback(
    async (entryId: string, fieldId: string): Promise<string | null> => {
      const e = entriesRef.current.find((x) => x.id === entryId)
      const f = e?.fields.find((x) => x.id === fieldId)
      if (!e || !f) return null
      if (!f.secret) return f.value
      if (!ready) return null
      const plain = await openField(entryId, f.value)
      if (plain !== null && (e.type === 'seed' || e.type === 'card')) {
        v.notify({
          kind: 'info',
          cat: 'privacy',
          icon: 'shield',
          title: 'Показан особо чувствительный секрет',
          body: `«${e.title}» · поле «${f.name}». Значение расшифровано только в памяти вкладки.`,
        })
      }
      return plain
    },
    [ready, v],
  )

  const openEntry = useCallback(
    async (entryId: string): Promise<Record<string, string> | null> => {
      const e = entriesRef.current.find((x) => x.id === entryId)
      if (!e) return null
      if (!ready) return null
      const out: Record<string, string> = {}
      for (const f of e.fields) {
        if (!f.secret || !f.value) {
          out[f.id] = f.value
          continue
        }
        const plain = await openField(entryId, f.value)
        if (plain === null) return null
        out[f.id] = plain
      }
      return out
    },
    [ready],
  )

  const openTotpSecret = useCallback(
    async (entryId: string): Promise<string | null> => {
      const e = entriesRef.current.find((x) => x.id === entryId)
      if (!e?.totp || !ready) return null
      return openField(entryId, e.totp.secret)
    },
    [ready],
  )

  const totpNow = useCallback(
    async (entryId: string) => {
      const e = entriesRef.current.find((x) => x.id === entryId)
      if (!e?.totp) return null
      const secret = await openTotpSecret(entryId)
      if (!secret) return null
      const code = await totpCode(secret, e.totp)
      if (!code) return null
      const period = e.totp.period > 0 ? e.totp.period : 30
      return { code, remaining: period - Math.floor((Date.now() / 1000) % period) }
    },
    [openTotpSecret],
  )

  /* ---------- буфер обмена с автоочисткой ---------- */

  const clearClipboard = useCallback(async () => {
    if (clipTimer.current) clearTimeout(clipTimer.current)
    clipTimer.current = null
    await writeClipboard('')
    setClip(null)
  }, [])

  const copySecret = useCallback<SecretsCtx['copySecret']>(
    async (value, target, label) => {
      const ok = await writeClipboard(value)
      if (!ok) {
        v.flash('Браузер не дал доступ к буферу обмена.')
        return
      }
      const sec = settings.clipboard[target] ?? 10
      if (clipTimer.current) clearTimeout(clipTimer.current)
      if (sec <= 0) {
        setClip({ label, until: 0, target })
        return
      }
      setClip({ label, until: Date.now() + sec * 1000, target })
      clipTimer.current = setTimeout(() => {
        void writeClipboard('')
        setClip(null)
      }, sec * 1000)
    },
    [settings.clipboard, v],
  )

  useEffect(
    () => () => {
      if (clipTimer.current) clearTimeout(clipTimer.current)
    },
    [],
  )

  /* ---------- импорт / экспорт ---------- */

  /** Собрать записи из превью: replace=true — снимок заменяет состав сейфа. */
  const materialize = useCallback(
    async (
      preview: ImportPreview,
      replace: boolean,
    ): Promise<{ added: number; failed: number }> => {
      if (!ready) return { added: 0, failed: preview.total }
      let added = 0
      let failed = 0
      const created: SecretRecord[] = []
      const newFolders: SecretFolder[] = []
      const folderByName = new Map(folders.map((f) => [f.name.toLowerCase(), f.id]))

      for (const d of preview.drafts) {
        const base = blankRecord(d.type, null)
        let folderId: string | null = null
        if (d.folderName) {
          const key = d.folderName.toLowerCase()
          const existing = folderByName.get(key)
          if (existing) folderId = existing
          else {
            const fresh: SecretFolder = {
              id: sid('fol'),
              name: d.folderName.slice(0, 40),
              rgb: PALETTE[(folders.length + newFolders.length) % PALETTE.length],
            }
            newFolders.push(fresh)
            folderByName.set(key, fresh.id)
            folderId = fresh.id
          }
        }
        const sealed = await sealAll(base.id, d.fields)
        if (!sealed) {
          failed++
          continue
        }
        let totp: SecretRecord['totp'] = null
        if (d.totpSecret) {
          const packed = await sealField(base.id, d.totpSecret)
          if (packed) {
            totp = {
              secret: packed,
              issuer: '',
              account: '',
              period: 30,
              digits: 6,
              algorithm: 'SHA1',
            }
          }
        }
        created.push({
          ...base,
          title: d.title,
          tags: d.tags,
          favorite: d.favorite,
          folderId,
          fields: sealed,
          totp,
        })
        added++
      }

      if (newFolders.length > 0) setFolders((prev) => [...prev, ...newFolders])
      if (replace) {
        /* Снимок — источник истины: живые записи заменяются, корзина не трогается. */
        setBox((prev) => ({
          version: 1,
          entries: [...created, ...prev.entries.filter((e) => !isLive(e))],
        }))
      } else if (created.length > 0) {
        write((all) => [...created, ...all])
      }
      return { added, failed }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders, ready, sealAll, setBox, setFolders, write],
  )

  const applyImport = useCallback(
    async (preview: ImportPreview) => {
      const res = await materialize(preview, false)
      v.notify({
        kind: 'ok',
        cat: 'privacy',
        icon: 'inbox',
        title: 'Импорт в сейф секретов',
        body: `${res.added} записей из «${preview.source}» зашифрованы локально${res.failed ? `, ${res.failed} не удалось` : ''}.`,
      })
      return res
    },
    [materialize, v],
  )

  /** Полный снимок в открытом виде — используется экспортом и бэкапом. */
  const plainSnapshot = useCallback(async (): Promise<string | null> => {
    if (!ready) return null
    const items: unknown[] = []
    for (const e of box.entries.filter(isLive)) {
      const opened = await openEntry(e.id)
      if (!opened) return null
      const totpSecret = e.totp ? await openTotpSecret(e.id) : null
      items.push({
        title: e.title,
        type: e.type,
        tags: e.tags,
        favorite: e.favorite,
        folderName: folders.find((f) => f.id === e.folderId)?.name ?? null,
        totpSecret,
        fields: e.fields.map((f) => ({
          name: f.name,
          kind: f.kind,
          value: opened[f.id] ?? '',
          secret: f.secret,
        })),
      })
    }
    return JSON.stringify({ kind: 'workflow-secrets-plain', at: Date.now(), entries: items }, null, 2)
  }, [box.entries, folders, openEntry, openTotpSecret, ready])

  const exportPlain = useCallback(
    async (format: 'csv' | 'json') => {
      const json = await plainSnapshot()
      if (!json) return null
      v.notify({
        kind: 'danger',
        cat: 'privacy',
        icon: 'shield',
        title: 'Экспорт без шифрования',
        body: `Секреты выгружены в ${format.toUpperCase()} в открытом виде. Удалите файл вручную — ОС не гарантирует безопасное стирание.`,
      })
      if (format === 'json') return json
      const parsed = JSON.parse(json) as {
        entries: {
          title: string
          type: string
          tags: string[]
          totpSecret: string | null
          folderName: string | null
          fields: { name: string; value: string }[]
        }[]
      }
      const rows: string[][] = [['name', 'type', 'folder', 'tags', 'username', 'password', 'url', 'totp', 'notes']]
      for (const e of parsed.entries) {
        const get = (needle: string) =>
          e.fields.find((f) => f.name.toLowerCase().includes(needle))?.value ?? ''
        rows.push([
          e.title,
          e.type,
          e.folderName ?? '',
          e.tags.join(' '),
          get('логин'),
          get('пароль'),
          get('сайт'),
          e.totpSecret ?? '',
          get('заметк'),
        ])
      }
      const { toCsv } = await import('./secrets-io')
      return toCsv(rows)
    },
    [plainSnapshot, v],
  )

  const exportEncrypted = useCallback(
    async (password: string) => {
      const json = await plainSnapshot()
      if (!json) return null
      const blob = await sealPortable(password, json)
      v.notify({
        kind: 'ok',
        cat: 'privacy',
        icon: 'lockRound',
        title: 'Зашифрованный экспорт создан',
        body: 'AES-GCM поверх PBKDF2 600 000. Файл бесполезен без пароля экспорта.',
      })
      return JSON.stringify(blob, null, 2)
    },
    [plainSnapshot, v],
  )

  const importEncrypted = useCallback(
    async (password: string, text: string): Promise<ImportPreview | null> => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return null
      }
      if (!isPortableBlob(parsed)) return null
      const json = await openPortable(password, parsed)
      if (json === null) return null
      const { importNativeJson } = await import('./secrets-io')
      return importNativeJson(json, 'зашифрованный снимок')
    },
    [],
  )

  /* ---------- бэкапы под мастер-ключом ---------- */

  const backupNow = useCallback(
    async (auto = false) => {
      const json = await plainSnapshot()
      if (!json) return false
      const sealedBlob = await sealWithMaster(json)
      if (!sealedBlob) return false
      const count = box.entries.filter(isLive).length
      setBackupRecs((prev) =>
        [{ at: Date.now(), count, ct: sealedBlob.ct, iv: sealedBlob.iv, auto }, ...prev].slice(
          0,
          MAX_BACKUPS,
        ),
      )
      if (!auto) v.flash(`Бэкап сейфа секретов создан: ${count} записей, зашифровано мастер-ключом.`)
      return true
    },
    [box.entries, plainSnapshot, setBackupRecs, v],
  )

  const restoreBackup = useCallback(
    async (at: number) => {
      const rec = backupRecs.find((b) => b.at === at)
      if (!rec) return null
      const json = await openWithMaster(rec.ct, rec.iv)
      if (json === null) return null
      const { importNativeJson } = await import('./secrets-io')
      const preview = importNativeJson(json, `бэкап от ${new Date(at).toLocaleString('ru-RU')}`)
      /* Восстановление — это замена состава, а не импорт: иначе каждый restore
         удваивал бы сейф (баг, найденный на приёмке). */
      const res = await materialize(preview, true)
      v.notify({
        kind: 'warn',
        cat: 'privacy',
        icon: 'refresh',
        title: 'Сейф секретов восстановлен из бэкапа',
        body: `Состав заменён снимком от ${new Date(at).toLocaleString('ru-RU')}: ${res.added} записей. Корзина не тронута.`,
      })
      return res.added
    },
    [backupRecs, materialize, v],
  )

  const removeBackup = useCallback(
    (at: number) => setBackupRecs((prev) => prev.filter((b) => b.at !== at)),
    [setBackupRecs],
  )

  /* Авто-бэкап: не чаще раза в час, только когда состав изменился. */
  const lastAuto = useRef(0)
  useEffect(() => {
    if (!ready || !settings.autoBackup) return
    const newest = backupRecs[0]?.at ?? 0
    if (Date.now() - Math.max(newest, lastAuto.current) < 3_600_000) return
    if (box.entries.filter(isLive).length === 0) return
    lastAuto.current = Date.now()
    void backupNow(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, box.entries.length, settings.autoBackup])

  /* ---------- иконки сайтов ---------- */

  const loadIcon = useCallback(
    async (entryId: string) => {
      if (!settings.favicons) return
      const e = entriesRef.current.find((x) => x.id === entryId)
      if (!e || e.icon) return
      const domain = domainOf(e)
      if (!domain) return
      try {
        /* Наружу уходит ТОЛЬКО домен. Картинка сохраняется в сейф как b64,
           поэтому в DOM никогда нет внешнего src (никаких referrer-утечек). */
        const res = await fetch(
          `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`,
        )
        if (!res.ok) return
        const blob = await res.blob()
        if (blob.size > 64 * 1024) return
        const b64 = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result))
          fr.onerror = () => reject(new Error('read'))
          fr.readAsDataURL(blob)
        })
        write((all) => all.map((x) => (x.id === entryId ? { ...x, icon: { domain, b64 } } : x)))
      } catch {
        /* нет сети — остаётся офлайн-монограмма */
      }
    },
    [settings.favicons, write],
  )

  const hideAll = useCallback(() => setHideEpoch((n) => n + 1), [])

  const value: SecretsCtx = {
    ready,
    needsLock,
    entries: box.entries,
    live,
    trash,
    folders,
    settings,
    setSettings,
    createEntry,
    updateEntry,
    toggleFavorite,
    softDelete,
    restoreEntry,
    purgeEntry,
    purgeAll,
    addFolder,
    renameFolder,
    removeFolder,
    openValue,
    openEntry,
    openTotpSecret,
    totpNow,
    clip,
    copySecret,
    clearClipboard,
    applyImport,
    exportPlain,
    exportEncrypted,
    importEncrypted,
    backups: backupRecs.map((b) => ({ at: b.at, count: b.count, auto: b.auto })),
    backupNow,
    restoreBackup,
    removeBackup,
    loadIcon,
    hideEpoch,
    hideAll,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export type { ImportDraft }
