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
import { logJournal } from './journal'

const MAX_BACKUPS = 5

/** Лимиты вложений: localStorage конечен, base64 раздувает данные на треть. */
export const ATTACH_MAX_BYTES = 256 * 1024
export const ATTACH_MAX_TOTAL = 1024 * 1024

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
  /** NF-5: одна запись на порцию записей — теги, папка, избранное, корзина. */
  bulkPatch: (
    ids: string[],
    patch: {
      addTag?: string
      folderId?: string | null
      favorite?: boolean
      /** true — в корзину, false — вернуть из корзины. */
      trashed?: boolean
    },
  ) => void
  /** NF-5: безвозвратное удаление порции записей из корзины. */
  bulkPurge: (ids: string[]) => void
  /** NF-5: вернуть прежние значения порции записей (окно отмены). */
  bulkRestore: (
    snap: {
      id: string
      tags: string[]
      folderId: string | null
      favorite: boolean
      deletedAt: number | null
    }[],
  ) => void

  addFolder: (name: string) => void
  renameFolder: (id: string, name: string) => void
  removeFolder: (id: string) => void

  /** Расшифровать значение поля (для показа/копирования). */
  openValue: (entryId: string, fieldId: string) => Promise<string | null>
  /** Расшифровать произвольный шифртекст записи (история изменений, аудит). */
  openCipher: (entryId: string, ct: string) => Promise<string | null>
  /** Вернуть прежнее значение поля из истории одним нажатием. */
  restoreHistory: (entryId: string, at: number, fieldId: string) => void
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
  /** Зашифровать и приложить файл к записи; строка — текст ошибки. */
  addAttachment: (entryId: string, file: File) => Promise<string | null>
  removeAttachment: (entryId: string, attId: string) => void
  /** Расшифровать вложение в память и отдать браузеру как файл. */
  downloadAttachment: (entryId: string, attId: string) => Promise<boolean>
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
    if (document.hasFocus() && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* нет разрешения — пробуем ниже */
  }
  try {
    const ta = document.createElement('textarea')
    /* Пустую строку execCommand не копирует: «очистка» кладёт одиночный пробел. */
    ta.value = text === '' ? ' ' : text
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
  const [box, setBox, boxHydrated] = usePersistedState<SecretsFile>(SECRETS_KEY, EMPTY_SECRETS)
  const [folders, setFolders] = usePersistedState<SecretFolder[]>(SECRETS_FOLDERS_KEY, [])
  const [settingsRaw, setSettingsRaw] = usePersistedState<SecretsSettings>(
    SECRETS_SETTINGS_KEY,
    DEFAULT_SECRETS_SETTINGS,
  )
  /* Сохранённые настройки дополняются дефолтами: снимок старого формата без
     какого-то ключа не должен превращать таймеры в NaN (баг «не гаснет»). */
  const settings = useMemo<SecretsSettings>(
    () => ({
      ...DEFAULT_SECRETS_SETTINGS,
      ...settingsRaw,
      clipboard: { ...DEFAULT_SECRETS_SETTINGS.clipboard, ...(settingsRaw?.clipboard ?? {}) },
      /* Иконки сайтов включены по умолчанию; старый снимок с favicons:false
         уважается только если пользователь сам трогал тумблер (faviconsSet). */
      favicons: settingsRaw?.faviconsSet ? Boolean(settingsRaw.favicons) : true,
      excludeFromAi: true,
    }),
    [settingsRaw],
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
    void writeClipboard('').then((cleared) => {
      pendingClear.current = !cleared
    })
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
        link: { kind: 'secret', id: rec.id },
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

  /* ---------- NF-5: массовые операции ----------
     Метки, папка, избранное и корзина не требуют крипто: значения полей
     не пересобираются, поэтому порция записей меняется одной записью в
     хранилище, а не пятьюстами вызовами updateEntry. */

  const bulkPatch = useCallback<SecretsCtx['bulkPatch']>(
    (ids, patch) => {
      if (ids.length === 0) return
      const set = new Set(ids)
      const at = Date.now()
      write((all) =>
        all.map((e) => {
          if (!set.has(e.id)) return e
          const tags =
            patch.addTag && !e.tags.includes(patch.addTag) ? [...e.tags, patch.addTag] : e.tags
          return {
            ...e,
            tags,
            folderId: patch.folderId !== undefined ? patch.folderId : e.folderId,
            favorite: patch.favorite !== undefined ? patch.favorite : e.favorite,
            deletedAt:
              patch.trashed === undefined ? e.deletedAt : patch.trashed ? (e.deletedAt ?? at) : null,
            updatedAt: at,
          }
        }),
      )
    },
    [write],
  )

  const bulkPurge = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const set = new Set(ids)
      write((all) => all.filter((e) => !set.has(e.id)))
    },
    [write],
  )

  const bulkRestore = useCallback<SecretsCtx['bulkRestore']>(
    (snap) => {
      if (snap.length === 0) return
      const by = new Map(snap.map((s) => [s.id, s]))
      write((all) =>
        all.map((e) => {
          const prev = by.get(e.id)
          return prev
            ? {
                ...e,
                tags: prev.tags,
                folderId: prev.folderId,
                favorite: prev.favorite,
                deletedAt: prev.deletedAt,
                updatedAt: Date.now(),
              }
            : e
        }),
      )
    },
    [write],
  )

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

  const openCipher = useCallback(
    async (entryId: string, ct: string): Promise<string | null> => {
      if (!ready || !ct) return null
      return openField(entryId, ct)
    },
    [ready],
  )

  const restoreHistory = useCallback(
    (entryId: string, at: number, fieldId: string) => {
      write((all) =>
        all.map((e) => {
          if (e.id !== entryId) return e
          const h = e.history.find((x) => x.at === at && x.fieldId === fieldId)
          const f = e.fields.find((x) => x.id === fieldId)
          if (!h || !f) return e
          /* Оба значения — шифртексты одного ключа записи: обмен без пере-крипто.
             Текущее значение уходит в историю, так что откат обратим. */
          const history = [
            { at: Date.now(), fieldId: f.id, fieldName: f.name, prevCt: f.value },
            ...e.history.filter((x) => !(x.at === at && x.fieldId === fieldId)),
          ].slice(0, 20)
          return {
            ...e,
            fields: e.fields.map((x) => (x.id === fieldId ? { ...x, value: h.prevCt } : x)),
            history,
            updatedAt: Date.now(),
          }
        }),
      )
      v.flash('Прежнее значение возвращено')
    },
    [v, write],
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

  /* Очистка требует фокуса документа. Если пользователь ушёл вставлять пароль
     в другое окно, очистка откладывается и выполняется при возврате фокуса. */
  const pendingClear = useRef(false)

  useEffect(() => {
    const onFocus = () => {
      if (!pendingClear.current) return
      pendingClear.current = false
      void writeClipboard('')
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const clearClipboard = useCallback(async () => {
    if (clipTimer.current) clearTimeout(clipTimer.current)
    clipTimer.current = null
    const ok = await writeClipboard('')
    pendingClear.current = !ok
    setClip(null)
  }, [])

  const copySecret = useCallback<SecretsCtx['copySecret']>(
    async (value, target, label) => {
      const ok = await writeClipboard(value)
      if (!ok) {
        v.flash('Браузер не дал доступ к буферу обмена.')
        return
      }
      pendingClear.current = false
      const sec = settings.clipboard[target] ?? 10
      if (clipTimer.current) clearTimeout(clipTimer.current)
      if (sec <= 0) {
        setClip({ label, until: 0, target })
        return
      }
      setClip({ label, until: Date.now() + sec * 1000, target })
      clipTimer.current = setTimeout(() => {
        void writeClipboard('').then((cleared) => {
          pendingClear.current = !cleared
        })
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
      void logJournal(
        'plaintext-export',
        'Экспорт секретов без шифрования',
        `Формат ${format.toUpperCase()}. Файл содержит пароли в открытом виде: ОС не гарантирует безопасное стирание.`,
      ).then((jid) =>
        v.notify({
          kind: 'danger',
          cat: 'privacy',
          icon: 'shield',
          title: 'Экспорт без шифрования',
          body: `Секреты выгружены в ${format.toUpperCase()} в открытом виде. Удалите файл вручную — ОС не гарантирует безопасное стирание.`,
          link: { kind: 'journal', id: jid },
        }),
      )
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
      void logJournal(
        'backup-restore',
        'Сейф секретов восстановлен из бэкапа',
        `Состав заменён снимком от ${new Date(at).toLocaleString('ru-RU')}: ${res.added} записей. Корзина не тронута.`,
      ).then((jid) =>
        v.notify({
          kind: 'warn',
          cat: 'privacy',
          icon: 'refresh',
          title: 'Сейф секретов восстановлен из бэкапа',
          body: `Состав заменён снимком от ${new Date(at).toLocaleString('ru-RU')}: ${res.added} записей. Корзина не тронута.`,
          link: { kind: 'journal', id: jid },
        }),
      )
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

  /* ---------- напоминания об истечении: за 30, 7 и 1 день + просрочено ---------- */

  const [expiryNotified, setExpiryNotified] = usePersistedState<Record<string, string>>(
    'wf.secrets.expiry.v1',
    {},
  )
  useEffect(() => {
    if (!boxHydrated) return
    const nowTs = Date.now()
    const next: Record<string, string> = {}
    let fired = false
    for (const e of box.entries) {
      if (!isLive(e) || !e.expiredAfter) continue
      const days = Math.ceil((e.expiredAfter - nowTs) / 86_400_000)
      const stage = days <= 0 ? 0 : days <= 1 ? 1 : days <= 7 ? 7 : days <= 30 ? 30 : null
      if (stage === null) continue
      /* Ключ включает дату: перенос срока в редакторе сбрасывает напоминания. */
      const key = `${e.expiredAfter}:${stage}`
      next[e.id] = key
      if (expiryNotified[e.id] === key) continue
      fired = true
      v.notify({
        kind: stage === 0 ? 'danger' : 'warn',
        cat: 'system',
        icon: 'clock',
        title:
          stage === 0
            ? `Срок записи «${e.title}» истёк`
            : `«${e.title}» истекает через ${Math.max(days, 1)} дн.`,
        body: `Срок: ${new Date(e.expiredAfter).toLocaleDateString('ru-RU')}. Обновите значение — напоминания приходят за 30, 7 и 1 день.`,
        link: { kind: 'secret', id: e.id },
      })
    }
    if (fired || Object.keys(next).length !== Object.keys(expiryNotified).length)
      setExpiryNotified(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxHydrated, box.entries])

  /* ---------- иконки сайтов ---------- */

  const loadIcon = useCallback(
    async (entryId: string) => {
      if (!settings.favicons) return
      const e = entriesRef.current.find((x) => x.id === entryId)
      if (!e || e.icon) return
      const domain = domainOf(e)
      if (!domain) return
      try {
        /* Наружу ходит только свой origin: /proxy/favicon сам сходит к Google
           и вернёт картинку. Прямого запроса из браузера нет — домен записи
           не попадает в чужой лог с реферером страницы, а адблок и CORS не
           мешают. Картинка сохраняется в сейф как b64, в DOM внешних src нет. */
        const res = await fetch(`/proxy/favicon?domain=${encodeURIComponent(domain)}`).catch(
          () => null,
        )
        if (!res || !res.ok) return
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

  /* ---------- вложения: AES-GCM ключом записи ---------- */

  const addAttachment = useCallback<SecretsCtx['addAttachment']>(
    async (entryId, file) => {
      if (!ready) return 'Сейф закрыт — разблокируйте замок'
      const e = entriesRef.current.find((x) => x.id === entryId)
      if (!e) return 'Запись не найдена'
      if (file.size > ATTACH_MAX_BYTES)
        return `«${file.name}» больше ${Math.round(ATTACH_MAX_BYTES / 1024)} КБ — вложение не добавлено`
      const used = e.attachments.reduce((n, a) => n + a.size, 0)
      if (used + file.size > ATTACH_MAX_TOTAL)
        return `Лимит вложений записи — ${Math.round(ATTACH_MAX_TOTAL / 1024)} КБ. Удалите лишнее и повторите`

      const bytes = new Uint8Array(await file.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 8192)
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const packed = await sealField(entryId, `${file.type || 'application/octet-stream'}|${btoa(bin)}`)
      if (!packed) return 'Нет сеанса мастера — файл не зашифрован'
      const cut = packed.indexOf(':')
      const att = {
        id: sid('att'),
        name: file.name.slice(0, 80),
        size: file.size,
        ct: packed.slice(0, cut),
        iv: packed.slice(cut + 1),
      }
      write((all) =>
        all.map((x) =>
          x.id === entryId
            ? { ...x, attachments: [...x.attachments, att], updatedAt: Date.now() }
            : x,
        ),
      )
      v.notify({
        kind: 'ok',
        cat: 'privacy',
        icon: 'lockRound',
        title: 'Вложение зашифровано',
        body: `«${att.name}» приложено к записи «${e.title}» и зашифровано AES-GCM ключом записи.`,
        link: { kind: 'secret', id: entryId },
      })
      return null
    },
    [ready, v, write],
  )

  const removeAttachment = useCallback(
    (entryId: string, attId: string) => {
      write((all) =>
        all.map((x) =>
          x.id === entryId
            ? {
                ...x,
                attachments: x.attachments.filter((a) => a.id !== attId),
                updatedAt: Date.now(),
              }
            : x,
        ),
      )
      v.flash('Вложение удалено вместе с шифртекстом.')
    },
    [v, write],
  )

  const downloadAttachment = useCallback<SecretsCtx['downloadAttachment']>(
    async (entryId, attId) => {
      if (!ready) return false
      const e = entriesRef.current.find((x) => x.id === entryId)
      const a = e?.attachments.find((x) => x.id === attId)
      if (!a) return false
      const plain = await openField(entryId, `${a.ct}:${a.iv}`)
      if (plain === null) return false
      const cut = plain.indexOf('|')
      const mime = cut > 0 ? plain.slice(0, cut) : 'application/octet-stream'
      const b64 = cut > 0 ? plain.slice(cut + 1) : plain
      let bytes: Uint8Array
      try {
        const bin = atob(b64)
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      } catch {
        return false
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
      const link = document.createElement('a')
      link.href = url
      link.download = a.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      return true
    },
    [ready],
  )

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
    bulkPatch,
    bulkPurge,
    bulkRestore,
    addFolder,
    renameFolder,
    removeFolder,
    openValue,
    openCipher,
    restoreHistory,
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
    addAttachment,
    removeAttachment,
    downloadAttachment,
    hideEpoch,
    hideAll,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export type { ImportDraft }
