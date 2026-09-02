'use client'

/* AR-2: слой стилей библиотеки приезжает вместе с чанком экрана. */
import '@/app/styles/screen-library.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconCheck,
  IconClock,
  IconClose,
  IconDoc,
  IconDocPreview,
  IconExternal,
  IconGraph,
  IconGridBoard,
  IconKey,
  IconLayers,
  IconLock,
  IconLockRound,
  IconPencil,
  IconPin,
  IconPlus,
  IconRefresh,
  IconSparkText,
  IconSticker,
  IconTag,
  IconTrash,
} from './icons'
import { CLUSTERS, clusterOf, fmtBytes, type ClusterId, type FileView } from '@/lib/data'
import { DAY, HOUR, TTL_OPTIONS, fmtLeft, fmtWhen, type Note } from '@/lib/notes'
import type { EdgeReason } from '@/lib/graph'
import {
  useDataStore,
  useLockStore,
  useNavStore,
  useNotifsStore,
  useNow,
  useSettingsStore,
  useToast,
} from '@/lib/vault-store'
import { useIndexActions, useIndexSummary } from '@/lib/indexer/context'
import {
  DENSITY_LABEL,
  isCustom,
  layoutOf,
  parseTileKey,
  putBoard,
  resetBoard,
  tileKey,
  type BoardId,
  type BoardLayouts,
  type Density,
  type TileKey,
} from '@/lib/board-layout'
import { LibraryBoard, type BoardItem } from '@/components/library-board'
import { IndexStrip } from '@/components/index-strip'
import {
  checkStickerSecret,
  looksEncrypted,
  useFileKeys,
} from '@/hooks/use-file-keys'
import { Beam } from '@/components/ui/beam'
import { NumTicker } from '@/components/ui/num-ticker'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { useBulkRunner } from '@/lib/bulk'
import { useIntent } from '@/lib/commands'
import { BulkBar, type BulkAction } from '@/components/bulk-bar'

/** Локальный алиас: короче в объявлении состояния доски. */
const usePersisted = usePersistedState

/** Сколько карточек файлов рисуется за раз (NF-1: тысяча — не сразу). */
const FILE_PAGE = 150

/* ============================================================
   КОНЦЕПЦИЯ «ДВА СЛОЯ ПАМЯТИ»
   Файл — это то, что вам прислали. Стикер — то, что вы подумали.
   Оба слоя лежат в одном сейфе: тот же корпус видят
   карта, чат и настройки. Поэтому «14 файлов» здесь и «14 файлов»
   в сайдбаре — это одно и то же число, а не две картинки.

   AR-1: экран подписан точечно — `useDataStore` (корпус и стикеры),
   `useNavStore` (фокусы и поиск), `useLockStore` (замок), `useToast`.
   Чужой тост или уведомление его больше не перерисовывают.
   ============================================================ */

type Sel = { kind: 'file' | 'note'; id: string }
/** NF-5: отметка мультивыделения — «слой:id», файлы и стикеры в одном списке. */
type MarkKey = string
type Layer = 'all' | 'files' | 'notes'
type CatId = ClusterId | 'all'

/** Подпись, почему два объекта связаны: связь считает graph.ts, а не дизайн. */
const REASON_LABEL: Record<EdgeReason, string> = {
  pin: 'стикер',
  tag: 'метка',
  cluster: 'кластер',
}

export function ScreenLibrary() {
  const D = useDataStore()
  const NAV = useNavStore()
  const LK = useLockStore()
  const { flash } = useToast()
  const idxs = useIndexSummary()
  const idxa = useIndexActions()
  const now = useNow()
  const { views, liveNotes, notes, stats } = D

  const [view, setView] = useState<Layer>('all')
  const [cat, setCat] = useState<CatId>('all')
  const [tag, setTag] = useState('Все')
  const [sel, setSel] = useState<Sel | null>(null)
  const [tab, setTab] = useState<'details' | 'ai'>('details')
  const [dismissed, setDismissed] = useState<string[]>([])

  /* ---------- NF-5: мультивыделение и массовые действия ---------- */
  const bulk = useBulkRunner()
  const [selectMode, setSelectMode] = useState(false)
  const [markedRaw, setMarked] = useState<MarkKey[]>([])
  const [bulkForm, setBulkForm] = useState<null | 'tag' | 'cluster' | 'key'>(null)
  const [bulkTag, setBulkTag] = useState('')
  const [bulkKey1, setBulkKey1] = useState('')
  const [bulkKey2, setBulkKey2] = useState('')
  const [bulkKeyErr, setBulkKeyErr] = useState<string | null>(null)
  const markAnchor = useRef<MarkKey | null>(null)

  /* Разблокировка — только на этот сеанс, ключ никуда не сохраняется. */
  const [unlocked, setUnlocked] = useState<string[]>([])
  const [askKey, setAskKey] = useState<string | null>(null)
  const [keyValue, setKeyValue] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)

  /* Установка пароля из инспектора */
  const [settingKeyFor, setSettingKeyFor] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')

  /* Композер стикера */
  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftTtl, setDraftTtl] = useState<number | null>(DAY)
  const [draftLock, setDraftLock] = useState(false)
  const [draftKey, setDraftKey] = useState('')
  const [pinTarget, setPinTarget] = useState<string | null>(null)
  const composerRef = useRef<HTMLElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /* ---------- Доска: раскладка и плотность переживают перезагрузку ---------- */

  const [layouts, setLayouts] = usePersisted<BoardLayouts>('vault.library.layouts', {})
  const [density, setDensity] = usePersisted<Density>('vault.library.density', 'cozy')
  /** Отмена переноса стикера на файл — держим прежнее значение привязки. */
  const lastPinRef = useRef<{ noteId: string; pinnedTo?: string } | null>(null)

  const updateLayouts = useCallback(
    (next: BoardLayouts) => setLayouts(next),
    [setLayouts],
  )

  /** Идёт ли перенос плитки: чипы кластеров подсвечиваются как цель. */
  const [boardDragActive, setBoardDragActive] = useState(false)
  useEffect(() => {
    const mo = new MutationObserver(() => {
      setBoardDragActive(document.body.classList.contains('board-dragging'))
    })
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  /* ---------- Файловые ключи (этап 5) ---------- */

  const fk = useFileKeys({
    status: LK.lock.status,
    fileKeysCount: LK.fileKeysCount,
    notes,
    patchNote: D.patchNote,
  })

  const [fkAsk, setFkAsk] = useState<string | null>(null) // ввод ключа к файлу
  const [fkVal, setFkVal] = useState('')
  const [fkErr, setFkErr] = useState<string | null>(null)
  const [fkCooldownUntil, setFkCooldownUntil] = useState(0)
  const [fkSetFor, setFkSetFor] = useState<string | null>(null) // установка ключа
  const [fkNew1, setFkNew1] = useState('')
  const [fkNew2, setFkNew2] = useState('')
  const [fkSetErr, setFkSetErr] = useState<string | null>(null)
  /** Счётчик неудач по ключу стикера — только память сеанса. */
  const keyFailRef = useRef(0)

  /* ---------- поиск из шапки ---------- */

  const searching = NAV.query.trim() !== ''
  /** Стикеры, попавшие в тот же поиск: «найдено» в шапке и здесь совпадает. */
  const matchedNotes = useMemo(() => {
    const ids = new Set<string>()
    for (const h of NAV.hits) if (h.kind === 'note') ids.add(h.id)
    return ids
  }, [NAV.hits])

  /* ---------- слои ---------- */

  const burned = useMemo(
    () =>
      notes.filter(
        (n) => n.expiresAt !== null && n.expiresAt <= now && !dismissed.includes(n.id),
      ),
    [notes, now, dismissed],
  )
  const tempCount = liveNotes.filter((n) => n.expiresAt !== null).length
  const lockedCount = liveNotes.filter((n) => n.locked).length

  /* Категории — кластеры сейфа: те же, что в сайдбаре и на карте. */
  const cats = useMemo(() => {
    const rows = CLUSTERS.map((c) => ({
      id: c.id as CatId,
      label: c.label,
      count: views.filter((f) => f.cluster === c.id).length,
    })).filter((c) => c.count > 0)
    return [{ id: 'all' as CatId, label: 'Все', count: views.length }, ...rows]
  }, [views])

  const tags = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of liveNotes) for (const t of n.tags) map.set(t, (map.get(t) ?? 0) + 1)
    return [
      { label: 'Все', count: liveNotes.length },
      ...[...map.entries()].map(([label, count]) => ({ label, count })),
    ]
  }, [liveNotes])

  const shownFiles = useMemo(() => {
    let list = cat === 'all' ? views : views.filter((f) => f.cluster === cat)
    if (searching) list = list.filter((f) => NAV.matchedFiles.has(f.id))
    return list
  }, [views, cat, searching, NAV.matchedFiles])

  /**
   * NF-1: на папке из тысячи файлов рисовать всё сразу нельзя — каждая
   * порция индексации перерисовывала бы тысячу карточек и роняла кадры.
   * Показываем страницами, «Показать ещё» добавляет следующую.
   */
  const [fileLimit, setFileLimit] = useState(FILE_PAGE)
  useEffect(() => setFileLimit(FILE_PAGE), [cat, searching, NAV.query, view])
  const pagedFiles = useMemo(
    () => (shownFiles.length > fileLimit ? shownFiles.slice(0, fileLimit) : shownFiles),
    [shownFiles, fileLimit],
  )

  const shownNotes = useMemo(() => {
    let list = tag === 'Все' ? liveNotes : liveNotes.filter((n) => n.tags.includes(tag))
    if (searching) list = list.filter((n) => matchedNotes.has(n.id))
    return list
  }, [liveNotes, tag, searching, matchedNotes])

  /* ---------- Доска: полные и видимые списки ---------- */

  /** Полные ключи ДО фильтров: по ним живёт порядок раскладки. */
  const allFileKeys = useMemo(() => views.map((f) => tileKey.file(f.id)), [views])
  const allNoteKeys = useMemo(() => liveNotes.map((n) => tileKey.note(n.id)), [liveNotes])

  const boardId: BoardId = view === 'files' ? 'files' : view === 'notes' ? 'notes' : 'all'
  const curLayout = useMemo(() => layoutOf(layouts, boardId), [layouts, boardId])
  const allKeys: TileKey[] =
    boardId === 'files' ? allFileKeys : boardId === 'notes' ? allNoteKeys : [...allFileKeys, ...allNoteKeys]

  /** Файл уронили на чип кластера. */
  const handleDropCluster = useCallback(
    (fileId: string, clusterRaw: string) => {
      if (!(CLUSTERS.some((c) => c.id === clusterRaw))) return
      D.retagFile(fileId, clusterRaw as ClusterId)
    },
    [D],
  )

  /** Стикер бросили на карточку файла — с тостом и отменой. */
  const handlePinNote = useCallback(
    (noteId: string, fileId: string) => {
      const note = liveNotes.find((n) => n.id === noteId)
      const file = D.fileById(fileId)
      if (!note || !file || note.pinnedTo === fileId) return
      lastPinRef.current = { noteId, pinnedTo: note.pinnedTo }
      D.patchNote(noteId, (n) => ({ ...n, pinnedTo: fileId }))
      flash(`Стикер приколот к «${file.name}»`)
      /* Отмена живёт прямо в тосте: пока сообщение не сменилось,
         повторное нажатие возвращает прежнее состояние. */
      window.setTimeout(() => {
        const toastEl = document.querySelector('.flash-toast')
        if (!toastEl) return
        if (!toastEl.querySelector('.toast-undo')) {
          const btn = document.createElement('button')
          btn.className = 'btn btn-ghost btn-sm toast-undo'
          btn.textContent = 'Отменить'
          btn.addEventListener('click', () => {
            const prev = lastPinRef.current
            if (prev && prev.noteId === noteId) {
              D.patchNote(noteId, (n) => ({ ...n, pinnedTo: prev.pinnedTo }))
            }
            btn.remove()
          })
          toastEl.appendChild(btn)
        }
      }, 0)
    },
    [liveNotes, D, NAV, flash],
  )

  /* Фильтр мог отрезать сам себя: сбрасываем, если выбранного больше нет. */
  useEffect(() => {
    if (cat !== 'all' && !cats.some((c) => c.id === cat)) setCat('all')
  }, [cats, cat])
  useEffect(() => {
    if (tag !== 'Все' && !tags.some((t) => t.label === tag)) setTag('Все')
  }, [tags, tag])

  const selNote = sel?.kind === 'note' ? notes.find((n) => n.id === sel.id) : undefined
  const selFile = sel?.kind === 'file' ? views.find((f) => f.id === sel.id) : undefined
  /** Выбранный файл заперт файловым ключом и ещё не открыт в этом сеансе. */
  const fkGatedSelFile =
    !!selFile && !selFile.processing && fk.isProtected(selFile.id) && !fk.isOpen(selFile.id)

  /* Инспектор всегда на живом объекте: сгоревший стикер или удалённый файл
     не должны оставлять призрак. */
  useEffect(() => {
    const fallback = views[0] ? ({ kind: 'file', id: views[0].id } as Sel) : null
    if (!sel) {
      if (fallback) setSel(fallback)
      return
    }
    if (sel.kind === 'note') {
      const alive = liveNotes.some((n) => n.id === sel.id)
      if (!alive) setSel(fallback)
      return
    }
    if (!views.some((f) => f.id === sel.id)) setSel(fallback)
  }, [sel, views, liveNotes])

  /* «Открыть файл» из чата, карты или палитры Ctrl+K. */
  useEffect(() => {
    if (!NAV.fileFocus) return
    if (!views.some((f) => f.id === NAV.fileFocus!.id)) return
    setView('all')
    setCat('all')
    setSel({ kind: 'file', id: NAV.fileFocus.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [NAV.fileFocus])

  /* Стикер открыли с другого места — инспектор показывает его. */
  useEffect(() => {
    if (!NAV.noteFocus) return
    if (liveNotes.some((n) => n.id === NAV.noteFocus!.id)) setSel({ kind: 'note', id: NAV.noteFocus.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [NAV.noteFocus])

  /* Клик по кластеру в сайдбаре или в палитре — фильтр библиотеки. */
  useEffect(() => {
    if (!NAV.clusterFocus) return
    const id = NAV.clusterFocus.id as CatId
    setView(id === 'all' ? 'all' : 'files')
    setCat(id)
  }, [NAV.clusterFocus])

  const isOpen = useCallback((n: Note) => !n.locked || unlocked.includes(n.id), [unlocked])

  /* ---------- Пароль ---------- */

  function openKeyPrompt(id: string) {
    setAskKey(id)
    setKeyValue('')
    setKeyError(null)
  }

  async function submitKey(id: string) {
    const note = notes.find((n) => n.id === id)
    const val = keyValue.trim()
    if (!val) {
      setKeyError('Введите ключ')
      return
    }
    /* П.10.6: после миграции locked=true ⇒ secret вида ct:iv,
       проверка только криптографическая — расшифровалось = верно. */
    if (note?.secret && looksEncrypted(note.secret)) {
      const verdict = await fk.checkSticker(note.secret, val)
      if (verdict === '') {
        setKeyError('Сейф нужно разблокировать заново и повторить')
        return
      }
      if (verdict === false) {
        keyFailRef.current += 1
        setKeyError(
          keyFailRef.current > 1
            ? `Ключ не подходит · неудачных попыток: ${keyFailRef.current}`
            : 'Ключ не подходит',
        )
        setKeyValue('')
        return
      }
    } else if (note?.secret && note.secret !== val) {
      /* Демо-стикеры до миграции: старый strncmp-стиль остаётся честным fallback'ом. */
      setKeyError('Ключ не подходит')
      setKeyValue('')
      return
    }
    keyFailRef.current = 0
    setUnlocked((u) => (u.includes(id) ? u : [...u, id]))
    setAskKey(null)
    setKeyValue('')
    setKeyError(null)
    flash('Стикер расшифрован на этом устройстве')
  }

  function removeLock(id: string) {
    D.patchNote(id, (n) => ({ ...n, locked: false, secret: null }))
    setUnlocked((u) => u.filter((x) => x !== id))
    setSettingKeyFor(null)
    setNewKey('')
    flash('Пароль снят — стикер открыт')
  }

  async function applyLock(id: string) {
    const val = newKey.trim()
    if (!val) return
    /* Инвариант 10.6: при действующем замке secret обязан быть ct:iv. */
    const packed = await fk.packSecret(val)
    if (packed.kind === 'no-session') {
      flash('Разблокируйте сейф заново, чтобы задать ключ')
      return
    }
    D.patchNote(id, (n) => ({ ...n, locked: true, secret: packed.kind === 'ct' ? packed.value : val }))
    setUnlocked((u) => u.filter((x) => x !== id))
    setSettingKeyFor(null)
    setNewKey('')
    flash('Стикер закрыт локальным ключом')
  }

  /* ---------- Ключи файлов (этап 5) ---------- */

  /** Открытие файла из сетки/доски: защищённый просит ключ. */
  const openFileTile = useCallback(
    (id: string) => {
      if (fk.isProtected(id) && !fk.isOpen(id)) {
        setFkAsk(id)
        setFkVal('')
        setFkErr(null)
        setFkCooldownUntil(0)
        return
      }
      NAV.openFile(id)
    },
    [fk, NAV],
  )

  async function submitFileKey() {
    const id = fkAsk
    const val = fkVal.trim()
    if (!id || !val || Date.now() < fkCooldownUntil || LK.lock.busy) return
    const r = await fk.openWithFileKey(id, val)
    if (r.ok) {
      setFkErr(null)
      setFkVal('')
      setFkCooldownUntil(0)
      setFkAsk(null)
      flash('Файл открыт — до блокировки сейфа или конца сеанса')
      NAV.openFile(id)
      return
    }
    if (r.reason === 'needUnlock') {
      setFkErr('Сейф нужно разблокировать заново и повторить')
    } else if (r.reason === 'missing') {
      setFkErr(null)
      setFkVal('')
      setFkAsk(null)
      NAV.openFile(id)
    } else {
      if (r.delayMs > 0) setFkCooldownUntil(Date.now() + r.delayMs)
      setFkErr(
        r.delayMs > 0
          ? `Ключ не подходит · повтор через ${Math.ceil(r.delayMs / 1000)} с`
          : 'Ключ не подходит',
      )
    }
    setFkVal('')
  }

  async function saveFileKeySetup() {
    const id = fkSetFor
    const p1 = fkNew1.trim()
    const p2 = fkNew2.trim()
    const file = views.find((x) => x.id === id)
    if (!id || !file || Date.now() < fkCooldownUntil) return
    if (!p1) return setFkSetErr('Введите пароль файла')
    if (p1.length < 8) return setFkSetErr('Пароль файла: минимум 8 символов')
    if (p1 !== p2) return setFkSetErr('Пароли не совпадают')
    if (!fk.canPack()) return setFkSetErr('Нет сеанса мастера: разблокируйте сейф заново')
    const desc = fk.openDescOf(id) ?? file.desc
    const r = await fk.setFileKey(id, p1, desc)
    if (!r.ok) {
      setFkSetErr(r.reason === 'needUnlock' ? 'Нет сеанса мастера: разблокируйте сейф заново' : 'Не удалось создать ключ')
      return
    }
    setFkSetErr(null)
    setFkNew1('')
    setFkNew2('')
    setFkSetFor(null)
    flash('Файл под ключом: описание зашифровано локально')
  }

  /* ---------- NF-5: массовые операции ----------
     Порядок отметок берём из того, что человек видит: диапазон
     Shift+клика считается по этому же списку. */

  const markOrder = useMemo<MarkKey[]>(
    () => [
      ...(view !== 'notes' ? pagedFiles.map((f) => `file:${f.id}`) : []),
      ...(view !== 'files' ? shownNotes.map((n) => `note:${n.id}`) : []),
    ],
    [pagedFiles, shownNotes, view],
  )

  /**
   * «Выбрать всё в фильтре» — это весь фильтр, а не только нарисованная
   * страница: на папке из тысячи файлов доска рисует первые 150, но выбор
   * обязан покрывать все 1000, иначе обещание в кнопке ложное.
   */
  const filterOrder = useMemo<MarkKey[]>(
    () => [
      ...(view !== 'notes' ? shownFiles.map((f) => `file:${f.id}`) : []),
      ...(view !== 'files' ? shownNotes.map((n) => `note:${n.id}`) : []),
    ],
    [shownFiles, shownNotes, view],
  )

  /* Фильтр сузился — отметки на выпавших объектах не остаются: видимый
     фильтр отсеивает их прямо в рендере, без эффекта-догонялки. */
  const marked = useMemo(() => {
    const live = new Set(filterOrder)
    return markedRaw.filter((k) => live.has(k))
  }, [markedRaw, filterOrder])
  const markedSet = useMemo(() => new Set(marked), [marked])

  const clearMarks = useCallback(() => {
    setMarked([])
    setBulkForm(null)
    markAnchor.current = null
  }, [])

  /* п.10.4: замок закрылся — выделение и режим выбора не достаются
     следующему человеку вместе с открытой вкладкой. Первый прогон при
     монтировании пропускаем: сбрасывать там нечего. */
  const lockEpochRef = useRef(LK.lockEpoch)
  useEffect(() => {
    if (lockEpochRef.current === LK.lockEpoch) return
    lockEpochRef.current = LK.lockEpoch
    clearMarks()
    setSelectMode(false)
  }, [LK.lockEpoch, clearMarks])

  const markKey = useCallback(
    (key: MarkKey, mods: { range: boolean }) => {
      if (mods.range && markAnchor.current) {
        const from = markOrder.indexOf(markAnchor.current)
        const to = markOrder.indexOf(key)
        if (from >= 0 && to >= 0) {
          const slice = markOrder.slice(Math.min(from, to), Math.max(from, to) + 1)
          setMarked((prev) => [...new Set([...prev, ...slice])])
          return
        }
      }
      markAnchor.current = key
      setMarked((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]))
    },
    [markOrder],
  )

  /** Клик по карточке: с модификатором или в режиме выбора — отметка, иначе открытие. */
  const onCardClick = useCallback(
    (kind: 'file' | 'note', id: string, e: React.MouseEvent) => {
      const key = `${kind}:${id}`
      if (e.shiftKey) {
        markKey(key, { range: true })
        return
      }
      if (e.metaKey || e.ctrlKey || selectMode) {
        markKey(key, { range: false })
        return
      }
      if (kind === 'file') openFileTile(id)
      else NAV.openNote(id)
    },
    [markKey, selectMode, openFileTile, NAV],
  )

  const markedFileIds = useMemo(
    () => marked.filter((k) => k.startsWith('file:')).map((k) => k.slice(5)),
    [marked],
  )
  const markedNoteIds = useMemo(
    () => marked.filter((k) => k.startsWith('note:')).map((k) => k.slice(5)),
    [marked],
  )

  const finishBulk = useCallback(
    (total: number, done: string) => (applied: number, cancelled: boolean) => {
      setBulkForm(null)
      if (!cancelled) clearMarks()
      flash(cancelled ? `Прервано: применено ${applied} из ${total}` : `${done}: ${applied}`)
    },
    [clearMarks, flash],
  )

  /** Метка: одна на все выбранные объекты, отмена возвращает прежние списки. */
  const applyBulkTag = useCallback(() => {
    const tag = bulkTag.trim()
    if (!tag || marked.length === 0) return
    const prevFiles = new Map(
      D.files.filter((f) => markedFileIds.includes(f.id)).map((f) => [f.id, f.tags]),
    )
    const prevNotes = new Map(
      D.notes.filter((n) => markedNoteIds.includes(n.id)).map((n) => [n.id, n.tags]),
    )
    void bulk.start({
      label: `Метка «${tag}» · ${marked.length}`,
      ids: [...marked],
      step: (batch) => {
        const files = batch.filter((k) => k.startsWith('file:')).map((k) => k.slice(5))
        const notes = batch.filter((k) => k.startsWith('note:')).map((k) => k.slice(5))
        D.bulkPatchFiles(files, (f) => {
          const tags = f.tags ?? []
          return tags.includes(tag) ? f : { ...f, tags: [...tags, tag] }
        })
        D.bulkPatchNotes(notes, (n) =>
          n.tags.includes(tag) ? n : { ...n, tags: [...n.tags, tag] },
        )
      },
      undo: {
        label: `Можно вернуть: метка «${tag}» у ${marked.length} объектов`,
        run: () => {
          D.bulkPatchFiles([...prevFiles.keys()], (f) => ({ ...f, tags: prevFiles.get(f.id) ?? f.tags }))
          D.bulkPatchNotes([...prevNotes.keys()], (n) => ({ ...n, tags: prevNotes.get(n.id) ?? n.tags }))
        },
      },
      onDone: finishBulk(marked.length, 'Метка добавлена'),
    })
  }, [bulk, bulkTag, D, finishBulk, marked, markedFileIds, markedNoteIds])

  /** Кластер — только файлы: у стикера кластера нет, и врать об этом нельзя. */
  const applyBulkCluster = useCallback(
    (cluster: ClusterId) => {
      if (markedFileIds.length === 0) return
      const prev = new Map(
        D.files.filter((f) => markedFileIds.includes(f.id)).map((f) => [f.id, f.cluster]),
      )
      void bulk.start({
        label: `Кластер «${clusterOf(cluster).label}» · ${markedFileIds.length}`,
        ids: [...markedFileIds],
        step: (batch) => D.bulkPatchFiles(batch, (f) => ({ ...f, cluster })),
        undo: {
          label: `Можно вернуть: прежний кластер у ${markedFileIds.length} файлов`,
          run: () =>
            D.bulkPatchFiles([...prev.keys()], (f) => ({ ...f, cluster: prev.get(f.id) ?? f.cluster })),
        },
        onDone: finishBulk(markedFileIds.length, 'Перенесено в кластер'),
      })
    },
    [bulk, D, finishBulk, markedFileIds],
  )

  /** Файловый ключ на группу: каждый файл получает свой ключ, обёрнутый мастером. */
  const applyBulkKey = useCallback(() => {
    const p1 = bulkKey1.trim()
    const p2 = bulkKey2.trim()
    const targets = markedFileIds.filter((id) => !fk.isProtected(id))
    if (!p1) return setBulkKeyErr('Введите пароль файла')
    if (p1.length < 8) return setBulkKeyErr('Пароль файла: минимум 8 символов')
    if (p1 !== p2) return setBulkKeyErr('Пароли не совпадают')
    if (!fk.canPack()) return setBulkKeyErr('Нет сеанса мастера: разблокируйте сейф заново')
    if (targets.length === 0) return setBulkKeyErr('Все выбранные файлы уже под ключом')
    setBulkKeyErr(null)
    let failed = 0
    void bulk.start({
      /* Крипто дороже правки состояния — порция меньше, кадры остаются живыми. */
      chunk: 5,
      label: `Файловый ключ · ${targets.length}`,
      ids: targets,
      step: async (batch) => {
        for (const id of batch) {
          const file = views.find((x) => x.id === id)
          if (!file) continue
          const r = await fk.setFileKey(id, p1, fk.openDescOf(id) ?? file.desc)
          if (!r.ok) failed += 1
        }
      },
      onDone: (applied, cancelled) => {
        setBulkForm(null)
        setBulkKey1('')
        setBulkKey2('')
        if (!cancelled) clearMarks()
        flash(
          failed > 0
            ? `Под ключом: ${applied - failed} из ${targets.length}, не удалось ${failed}`
            : cancelled
              ? `Прервано: под ключом ${applied} из ${targets.length}`
              : `Файлов под ключом: ${applied}`,
        )
      },
    })
  }, [bulk, bulkKey1, bulkKey2, clearMarks, fk, flash, markedFileIds, views])

  /** Удаление: файлы уходят из сейфа, стикеры сгорают — оба под окном отмены. */
  const applyBulkTrash = useCallback(() => {
    if (marked.length === 0) return
    const fileSet = new Set(markedFileIds)
    const noteSet = new Set(markedNoteIds)
    const filesSnap = D.files.filter((f) => fileSet.has(f.id))
    const pinsSnap = new Map(
      D.liveNotes
        .filter((n) => n.pinnedTo && fileSet.has(n.pinnedTo))
        .map((n) => [n.id, n.pinnedTo as string]),
    )
    const notesSnap = new Map(
      D.notes.filter((n) => noteSet.has(n.id)).map((n) => [n.id, n.expiresAt]),
    )
    void bulk.start({
      label: `Удаление · ${marked.length}`,
      ids: [...marked],
      step: (batch) => {
        const files = batch.filter((k) => k.startsWith('file:')).map((k) => k.slice(5))
        const notes = batch.filter((k) => k.startsWith('note:')).map((k) => k.slice(5))
        files.forEach((id) => fk.forgetKey(id))
        D.bulkRemoveFiles(files)
        D.bulkPatchNotes(notes, (n) => ({ ...n, expiresAt: Date.now() - 1 }))
      },
      undo: {
        label: `Можно вернуть: ${marked.length} удалённых объектов`,
        run: () => {
          D.restoreFiles(filesSnap)
          D.bulkPatchNotes([...pinsSnap.keys()], (n) => ({ ...n, pinnedTo: pinsSnap.get(n.id) }))
          D.bulkPatchNotes([...notesSnap.keys()], (n) => ({
            ...n,
            expiresAt: notesSnap.get(n.id) ?? null,
          }))
        },
      },
      onDone: finishBulk(marked.length, 'Удалено'),
    })
  }, [bulk, D, finishBulk, fk, marked, markedFileIds, markedNoteIds])

  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        id: 'tag',
        label: 'Метка',
        icon: <IconTag />,
        hint: 'Добавить одну метку всем выбранным файлам и стикерам',
        onRun: () => setBulkForm((f) => (f === 'tag' ? null : 'tag')),
      },
      {
        id: 'cluster',
        label: 'Кластер',
        icon: <IconLayers />,
        hint: 'Перенести выбранные файлы в кластер (стикеры не тронутся)',
        disabled: markedFileIds.length === 0,
        onRun: () => setBulkForm((f) => (f === 'cluster' ? null : 'cluster')),
      },
      {
        id: 'key',
        label: 'Под ключ',
        icon: <IconLockRound width={13} height={13} stroke="currentColor" strokeWidth={1.6} />,
        hint: 'Запереть выбранные файлы файловым ключом: описание шифруется локально',
        disabled: markedFileIds.length === 0,
        onRun: () => {
          setBulkKeyErr(null)
          setBulkForm((f) => (f === 'key' ? null : 'key'))
        },
      },
      {
        id: 'trash',
        label: 'Удалить',
        icon: <IconTrash />,
        danger: true,
        hint: 'Файлы уходят из сейфа, стикеры сгорают — вернуть можно 10 секунд',
        onRun: applyBulkTrash,
      },
    ],
    [applyBulkTrash, markedFileIds.length],
  )

  const bulkFormNode =
    bulkForm === 'tag' ? (
      <>
        <input
          className="input input-sm"
          autoFocus
          value={bulkTag}
          onChange={(e) => setBulkTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyBulkTag()
          }}
          placeholder="новая метка для выбранных объектов"
          aria-label="Метка для выбранных объектов"
          data-testid="lib-bulk-tag-input"
        />
        <button
          className="btn btn-primary btn-sm"
          disabled={!bulkTag.trim()}
          onClick={applyBulkTag}
          data-testid="lib-bulk-tag-apply"
        >
          <IconCheck />
          Применить
        </button>
      </>
    ) : bulkForm === 'cluster' ? (
      <>
        {CLUSTERS.map((c) => (
          <button
            key={c.id}
            className="btn btn-ghost btn-sm"
            onClick={() => applyBulkCluster(c.id)}
            data-testid={`lib-bulk-cluster-${c.id}`}
          >
            <IconLayers />
            {c.label}
          </button>
        ))}
      </>
    ) : bulkForm === 'key' ? (
      <>
        <input
          className="input input-sm mono"
          type="password"
          autoFocus
          value={bulkKey1}
          onChange={(e) => {
            setBulkKey1(e.target.value)
            if (bulkKeyErr) setBulkKeyErr(null)
          }}
          placeholder="ключ файлов (минимум 8)"
          aria-label="Ключ для выбранных файлов"
          data-testid="lib-bulk-key1"
        />
        <input
          className="input input-sm mono"
          type="password"
          value={bulkKey2}
          onChange={(e) => {
            setBulkKey2(e.target.value)
            if (bulkKeyErr) setBulkKeyErr(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyBulkKey()
          }}
          placeholder="повторите ключ"
          aria-label="Повторите ключ"
          data-testid="lib-bulk-key2"
        />
        <button className="btn btn-primary btn-sm" onClick={applyBulkKey} data-testid="lib-bulk-key-apply">
          <IconLockRound width={13} height={13} stroke="currentColor" strokeWidth={1.6} />
          Запереть
        </button>
        <span className={`key-hint mono${bulkKeyErr ? ' err' : ''}`} role="status" data-testid="lib-bulk-key-hint">
          {bulkKeyErr ?? 'один ключ на все выбранные файлы · описание шифруется локально'}
        </span>
      </>
    ) : null

  /* Команды палитры (NF-6): действия экрана работают из любого места. */
  useIntent('library.newNote', () => startNew())
  useIntent('library.addFile', () => fileInputRef.current?.click())
  useIntent('library.select', () => setSelectMode(true))
  useIntent('library.density', () => setDensity((d) => (d === 'cozy' ? 'compact' : 'cozy')))
  useIntent('library.resetBoard', () => {
    setLayouts((prev) => putBoard(prev, boardId, resetBoard()))
    flash('Раскладка сброшена к сортировке по умолчанию')
  })

  /* ---------- Жизнь стикера ---------- */

  function makePermanent(id: string) {
    D.patchNote(id, (n) => ({ ...n, expiresAt: null, lifeSpan: null }))
    flash('Стикер закреплён навсегда')
  }

  function burnNow(id: string) {
    D.burnNote(id)
    setUnlocked((u) => u.filter((x) => x !== id))
  }

  /* ---------- Композер ---------- */

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      composerRef.current?.querySelector('textarea')?.focus()
    })
  }, [])

  function resetComposer() {
    setComposing(false)
    setEditing(null)
    setDraft('')
    setDraftKey('')
    setDraftLock(false)
    setDraftTtl(DAY)
    setPinTarget(null)
  }

  function startNew(pinToFileId?: string) {
    setEditing(null)
    setDraft('')
    setDraftKey('')
    setDraftLock(false)
    setDraftTtl(DAY)
    setPinTarget(pinToFileId ?? null)
    setComposing(true)
    if (view === 'files') setView('all')
    focusComposer()
  }

  function startEdit(n: Note) {
    setEditing(n.id)
    setDraft(n.body)
    setDraftKey('')
    setDraftLock(n.locked)
    setDraftTtl(
      n.expiresAt === null ? null : (TTL_OPTIONS.find((o) => o.value === n.lifeSpan)?.value ?? DAY),
    )
    setPinTarget(n.pinnedTo ?? null)
    setComposing(true)
    focusComposer()
  }

  /* Пароль нельзя включить без ключа — иначе стикер «закрыт» ничем. */
  const draftBlocked = !draft.trim() || (draftLock && !draftKey.trim() && !editing)

  function saveDraft() {
    const text = draft.trim()
    if (!text || draftBlocked) return
    void saveDraftAsync()
  }

  async function saveDraftAsync() {
    const text = draft.trim()
    if (!text || draftBlocked) return
    const firstLine = text.split('\n')[0]
    const title = firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine

    /* Инвариант 10.6: новый locked-секрет при активном замке сразу ct:iv. */
    let newSecret: string | null = null
    if (draftLock && draftKey.trim()) {
      const packed = await fk.packSecret(draftKey.trim())
      if (packed.kind === 'no-session') {
        flash('Разблокируйте сейф заново, чтобы задать ключ')
        return
      }
      newSecret = packed.kind === 'ct' ? packed.value : draftKey.trim()
    }

    if (editing) {
      const id = editing
      D.patchNote(id, (n) => ({
        ...n,
        title,
        body: text,
        expiresAt: draftTtl === null ? null : Date.now() + draftTtl,
        lifeSpan: draftTtl,
        locked: draftLock,
        secret: draftLock ? newSecret ?? n.secret : null,
        pinnedTo: pinTarget ?? undefined,
      }))
      if (draftLock && draftKey.trim()) setUnlocked((u) => u.filter((x) => x !== id))
      resetComposer()
      setSel({ kind: 'note', id })
      flash('Стикер обновлён')
      return
    }

    /* Стикер уходит в общий сейф: карта памяти получает новый узел сразу. */
    const id = D.addNote({
      title,
      body: text,
      tags: ['новое'],
      expiresAt: draftTtl === null ? null : Date.now() + draftTtl,
      lifeSpan: draftTtl,
      locked: draftLock && draftKey.trim().length > 0,
      secret: draftLock && draftKey.trim() ? newSecret : null,
      pinnedTo: pinTarget ?? undefined,
    })
    resetComposer()
    setTag('Все')
    setSel({ kind: 'note', id })
  }

  /* ---------- Слой ---------- */

  function switchLayer(next: Layer) {
    setView(next)
    /* Инспектор не должен показывать то, чего в списке уже нет. */
    if (next === 'files' && sel?.kind === 'note' && views[0]) setSel({ kind: 'file', id: views[0].id })
    if (next === 'notes' && sel?.kind === 'file' && liveNotes[0])
      setSel({ kind: 'note', id: liveNotes[0].id })
  }

  /* Escape закрывает то, что открыто последним. */
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (askKey) {
        setAskKey(null)
        setKeyError(null)
        return
      }
      if (settingKeyFor) {
        setSettingKeyFor(null)
        setNewKey('')
        return
      }
      if (composing) resetComposer()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [askKey, settingKeyFor, composing])

  const showNotes = view !== 'files'
  const showFiles = view !== 'notes'
  const noteOpen = selNote ? isOpen(selNote) : false
  const catLabel = cat === 'all' ? 'Все' : clusterOf(cat).label

  /* ---------- Доска: сборка плиток из живых карточек ---------- */

  /**
   * Плитки — те же карточки, что рисовала сетка: вёрстка ncard/fcard
   * не тронута, изменилась только обёртка. Функции объявлены после
   * всех состояний и читают их напрямую.
   */
  const noteItems = useMemo<BoardItem[]>(
    () => shownNotes.map(renderNoteTile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownNotes, markedSet, selectMode, sel],
  )
  const fileItems = useMemo<BoardItem[]>(
    () => pagedFiles.map(renderFileTile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagedFiles, fk.isProtected, fk.isOpen, markedSet, selectMode],
  )
  /** Единая доска «Всё»: файлы и стикеры в одном списке. */
  const allBoardItems = useMemo(() => [...fileItems, ...noteItems], [fileItems, noteItems])

  /** Человеческое имя плитки для объявлений скринридера. */
  const labelOfTile = useCallback(
    (key: TileKey) => {
      const { kind, id } = parseTileKey(key)
      if (kind === 'note') {
        const n = notes.find((x) => x.id === id)
        return `стикер «${n?.title ?? id}»`
      }
      const f = D.fileById(id)
      return `файл «${f?.name ?? id}»`
    },
    [notes, D],
  )

  /**
   * Плитка стикера и плитка файла: содержимое собирается здесь,
   * вёрстка карточек живёт в NoteCardContent / FileCardContent ниже.
   */
  function renderNoteTile(n: Note): BoardItem {
    return {
      key: tileKey.note(n.id),
      content: (
        <NoteCardContent
          note={n}
          isSelected={sel?.kind === 'note' && sel.id === n.id}
          marked={markedSet.has(`note:${n.id}`)}
          pickable={selectMode}
          onSelect={(id, e) => onCardClick('note', id, e)}
          onTag={(t) => {
            setView('notes')
            setTag(t)
          }}
        />
      ),
    }
  }

  function renderFileTile(f: FileView): BoardItem {
    return {
      key: tileKey.file(f.id),
      content: (
        <FileCardContent
          file={f}
          onSelect={(id, e) => onCardClick('file', id, e)}
          marked={markedSet.has(`file:${f.id}`)}
          pickable={selectMode}
          fkHidden={fk.isProtected(f.id) && !fk.isOpen(f.id)}
        />
      ),
    }
  }

  /** Надгробие сгоревшего стикера — тоже плитка, но вне раскладки смысла не имеет. */
  const burnedItems: BoardItem[] = burned.map((n: Note) => ({
    key: tileKey.note(`gone-${n.id}`),
    content: (
      <article className="ncard panel burned" aria-live="polite">
        <div className="ncard-top">
          <span className="chip chip-gone">стёрт</span>
          <span className="ttl mono">таймер вышел</span>
        </div>
        <h3 className="ntitle">{n.title}</h3>
        <p className="nbody">
          Стикер самоуничтожился локально: тело, теги и связи удалены без корзины.
          Восстановить нельзя — так и было задумано.
        </p>
        <footer className="mono num">{fmtWhen(n.createdAt, now)}</footer>
        <button
          className="burn-x"
          onClick={() => setDismissed((d) => [...d, n.id])}
          aria-label="Убрать след стикера"
        >
          <IconClose width={12} height={12} stroke="currentColor" strokeWidth={1.8} />
        </button>
      </article>
    ),
  }))
  const allBurnedKeys: TileKey[] = burned.map((n: Note) => tileKey.note(`gone-${n.id}`))

  /* Соседи выбранного файла считаются по настоящему графу связей. */
  const related = useMemo(
    () => (selFile ? D.neighbors(selFile.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selFile?.id, D.graph],
  )
  const pinnedToSel = useMemo(
    () => (selFile ? liveNotes.filter((n) => n.pinnedTo === selFile.id) : []),
    [liveNotes, selFile],
  )

  return (
    <div className="scroll-col">
      {/* Единственная live-область на все доски: скринридер слышит
         каждое действие один раз, без дублей из двух смонтированных
         досок режима «Всё». */}
      <div id="board-live" className="sr-only" role="status" aria-live="polite" />
      <div className="lib-layout">
        <main>
          <div className="page-head">
            <div>
              <h1>Библиотека</h1>
              <p>Два слоя памяти: файлы, которые пришли — и стикеры, которые вы подумали</p>
            </div>
            <div className="head-actions">
              <button
                className="btn btn-ghost"
                onClick={() => (composing ? resetComposer() : startNew())}
              >
                <IconSticker />
                {composing ? 'Свернуть' : 'Новый стикер'}
              </button>
              {idxs.fsaSupported ? (
                <button
                  className="btn btn-ghost"
                  data-testid="idx-connect-folder"
                  disabled={idxs.busy}
                  onClick={() => void idxa.connectFolder()}
                  title="Выбрать папку на диске и построить индекс по содержимому"
                >
                  <IconGraph />
                  {idxs.folder ? 'Сменить папку' : 'Подключить папку'}
                </button>
              ) : null}
              {idxs.folder && idxs.folderMode === 'fsa' ? (
                <button
                  className="btn btn-ghost"
                  data-testid="idx-reindex"
                  disabled={idxs.busy}
                  onClick={() => void idxa.reindex(false)}
                  title="Перечитать папку: изменённые файлы будут прочитаны заново"
                >
                  <IconRefresh />
                  Переиндексировать
                </button>
              ) : null}
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                <IconPlus />
                Добавить файл
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? [])
                  if (list.length > 0) {
                    setCat('all')
                    if (view === 'notes') setView('all')
                    void idxa.indexFiles(list)
                  }
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* NF-1: настоящий прогресс индексации. Числа берутся из конвейера,
              а не из таймера, поэтому «отмена» действительно отменяет. */}
          <IndexStrip />

          {/* Числа читаются из сейфа: те же, что в сайдбаре и статус-баре.
              NumTicker докручивает значение, когда сейф меняется. */}
          <div className="stat-strip panel">
            <div className="st">
              <span className="label-mono">Файлов</span>
              <b className="mono num">
                <NumTicker value={stats.files} />
              </b>
            </div>
            <div className="st">
              <span className="label-mono">Стикеров</span>
              <b className="mono num">
                <NumTicker value={stats.notes} />
              </b>
            </div>
            <div className="st">
              <span className="label-mono">Временных</span>
              <b className="mono num st-warn">
                <NumTicker value={tempCount} />
              </b>
            </div>
            <div className="st">
              <span className="label-mono">Под паролем</span>
              <b className="mono num">
                <NumTicker value={lockedCount} />
              </b>
            </div>
            <div className="st st-wide">
              <span className="label-mono">Индекс</span>
              <b className="mono num">
                {stats.links} связей · {fmtBytes(stats.bytes)} ·{' '}
                {stats.processing > 0 ? `${stats.processing} в обработке` : 'всё локально'}
              </b>
            </div>
          </div>

          <div className="lib-toolbar">
            <div className="seg" role="group" aria-label="Слой библиотеки">
              {(
                [
                  { v: 'all', l: 'Всё' },
                  { v: 'files', l: 'Файлы' },
                  { v: 'notes', l: 'Стикеры' },
                ] as const
              ).map((s) => (
                <button
                  key={s.v}
                  className={`seg-btn${view === s.v ? ' on' : ''}`}
                  onClick={() => switchLayer(s.v)}
                  aria-pressed={view === s.v}
                >
                  {s.l}
                </button>
              ))}
            </div>
            {view === 'notes' ? (
              <div className="filters" role="group" aria-label="Теги стикеров">
                {tags.map((f) => (
                  <button
                    key={f.label}
                    className={`f-chip${tag === f.label ? ' on' : ''}`}
                    onClick={() => setTag(f.label)}
                    aria-pressed={tag === f.label}
                  >
                    {f.label} <b className="num">{f.count}</b>
                  </button>
                ))}
              </div>
            ) : (
              <div className="filters" role="group" aria-label="Кластеры файлов">
                {cats.map((f) => (
                  <button
                    key={f.id}
                    className={`f-chip${cat === f.id ? ' on' : ''}${
                      boardDragActive && f.id !== 'all' ? ' drop-target' : ''
                    }`}
                    onClick={() => setCat(f.id)}
                    aria-pressed={cat === f.id}
                    /* Цель для файла, брошенного на кластер. */
                    data-drop-cluster={f.id === 'all' ? undefined : f.id}
                  >
                    {f.label} <b className="num">{f.count}</b>
                  </button>
                ))}
              </div>
            )}
            <span className="grow" />
            <button
              className={`btn btn-ghost btn-sm${selectMode ? ' on' : ''}`}
              onClick={() => {
                setSelectMode((m) => !m)
                if (selectMode) clearMarks()
              }}
              aria-pressed={selectMode}
              title="Мультивыделение: Ctrl/Cmd+клик добавляет карточку, Shift+клик берёт диапазон"
              data-testid="lib-select-mode"
            >
              <IconCheck />
              {selectMode ? 'Выбор включён' : 'Выделение'}
            </button>
            <button
              className={`btn btn-ghost btn-sm${density === 'compact' ? ' on' : ''}`}
              onClick={() => setDensity((d) => (d === 'cozy' ? 'compact' : 'cozy'))}
              aria-pressed={density === 'compact'}
              aria-label={`Плотность доски: ${DENSITY_LABEL[density]}`}
              title={`Плотность: ${DENSITY_LABEL[density]}`}
            >
              <IconGridBoard />
              {density === 'compact' ? 'Плотно' : 'Свободно'}
            </button>
            {isCustom(curLayout) && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setLayouts((prev) => putBoard(prev, boardId, resetBoard()))
                  flash('Раскладка сброшена к сортировке по умолчанию')
                }}
                aria-label="Сбросить раскладку этой доски"
                title="Сбросить раскладку"
              >
                <IconRefresh />
                Сбросить раскладку
              </button>
            )}
          </div>

          {/* NF-5: панель массовых действий. Появляется, когда что-то выбрано,
              и живёт до конца операции — прогресс и отмена внутри неё. */}
          <BulkBar
            count={marked.length}
            totalInFilter={filterOrder.length}
            noun={
              markedFileIds.length > 0 && markedNoteIds.length > 0
                ? `${markedFileIds.length} файлов, ${markedNoteIds.length} стикеров`
                : markedNoteIds.length > 0
                  ? 'стикеров'
                  : 'файлов'
            }
            actions={bulkActions}
            form={bulkFormNode}
            runner={bulk}
            onSelectAll={() => setMarked(filterOrder)}
            onClear={clearMarks}
            testid="lib-bulk"
          />

          {/* Запрос из шапки сузил сетку — говорим об этом прямо, с выходом. */}
          {searching && (
            <div className="lib-filter-note panel">
              <span className="label-mono">Поиск</span>
              <span className="mono num">
                «{NAV.query}» · {shownFiles.length} файлов, {shownNotes.length} стикеров
              </span>
              <span className="grow" />
              <button className="btn btn-ghost btn-sm" onClick={() => NAV.setQuery('')}>
                <IconClose />
                Сбросить
              </button>
            </div>
          )}

          {composing && (
            <section
              className="composer panel fade-in"
              aria-label={editing ? 'Правка стикера' : 'Новый стикер'}
              ref={composerRef}
            >
              <div className="blk-head">
                <span className="label-mono">{editing ? 'Правка стикера' : 'Новый стикер'}</span>
                <span className="chip">
                  <IconLock width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
                  пишется прямо в сейф
                </span>
              </div>
              {pinTarget && (
                <div className="comp-pin mono">
                  <IconPin width={12} height={12} stroke="currentColor" strokeWidth={1.5} />
                  <span className="ellipsis">
                    приколоть к {D.fileById(pinTarget)?.name ?? 'файлу'}
                  </span>
                  <button
                    className="pin-off"
                    onClick={() => setPinTarget(null)}
                    aria-label="Не прикалывать к файлу"
                  >
                    <IconClose width={11} height={11} stroke="currentColor" strokeWidth={1.8} />
                  </button>
                </div>
              )}
              <textarea
                className="textarea"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    saveDraft()
                  }
                }}
                placeholder="Первая строка станет заголовком. Дальше — что угодно: код, мысль, пароль от домофона…"
              />
              <div className="comp-row">
                <span className="label-mono comp-lbl">
                  <IconClock width={12} height={12} stroke="currentColor" strokeWidth={1.6} />
                  Жизнь
                </span>
                <div className="filters comp-chips">
                  {TTL_OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      className={`f-chip${draftTtl === o.value ? ' on' : ''}`}
                      onClick={() => setDraftTtl(o.value)}
                      aria-pressed={draftTtl === o.value}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="comp-row">
                <span className="label-mono comp-lbl">
                  <IconKey width={12} height={12} stroke="currentColor" strokeWidth={1.6} />
                  Пароль
                </span>
                <div className="comp-lock">
                  <button
                    className={`toggle${draftLock ? ' on' : ''}`}
                    role="switch"
                    aria-checked={draftLock}
                    aria-label="Закрыть стикер паролем"
                    onClick={() => setDraftLock((x) => !x)}
                  >
                    <i />
                  </button>
                  {draftLock ? (
                    <input
                      className="input input-sm mono"
                      type="password"
                      value={draftKey}
                      onChange={(e) => setDraftKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveDraft()
                      }}
                      placeholder={
                        editing ? 'новый ключ · пусто = оставить прежний' : 'локальный ключ · AES-256'
                      }
                    />
                  ) : (
                    <span className="comp-hint">
                      Без пароля стикер видно всем, у кого открыт сейф
                    </span>
                  )}
                </div>
              </div>
              <div className="comp-foot">
                <span className="comp-hint mono">
                  {draftBlocked && draft.trim()
                    ? 'нужен ключ — иначе пароль не включится'
                    : draftTtl === null
                      ? 'останется навсегда'
                      : `сотрётся через ${fmtLeft(draftTtl)} · без корзины`}
                </span>
                <div className="comp-btns">
                  <button className="btn btn-tertiary btn-sm" onClick={resetComposer}>
                    Отмена
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={saveDraft}
                    disabled={draftBlocked}
                  >
                    <IconCheck />
                    {editing ? 'Обновить' : 'Сохранить'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {showNotes && (
            <>
              <div className="sec-head">
                <span className="label-mono">Стикеры</span>
                <span className="sec-rule" />
                <span className="sec-note mono num">
                  {shownNotes.length} {tag === 'Все' ? 'активных' : `по тегу «${tag}»`} · {tempCount} с
                  таймером
                </span>
              </div>

              <LibraryBoard
                boardId={view === 'notes' ? 'notes' : 'all'}
                items={[...noteItems, ...burnedItems]}
                allKeys={
                  view === 'notes'
                    ? allNoteKeys
                    : [...allFileKeys, ...allNoteKeys, ...allBurnedKeys]
                }
                layouts={layouts}
                density={density}
                onLayouts={updateLayouts}
                onPinNote={handlePinNote}
                onDropCluster={handleDropCluster}
                labelOf={labelOfTile}
              />

              {shownNotes.length === 0 && burned.length === 0 && (searching || tag !== 'Все') ? (
                <div className="empty-state panel">
                  <IconSticker width={20} height={20} stroke="currentColor" strokeWidth={1.4} />
                  <span className="label-mono">
                    {searching ? `Нет стикеров по «${NAV.query}»` : `Нет стикеров с тегом «${tag}»`}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => (searching ? NAV.setQuery('') : setTag('Все'))}
                  >
                    <IconRefresh />
                    Показать все
                  </button>
                </div>
              ) : (
                <div className="board-footnote">
                  <button className="ncard panel add-note" onClick={() => startNew()}>
                    <IconPlus width={18} height={18} stroke="currentColor" strokeWidth={1.5} />
                    <span className="label-mono">Быстрый стикер</span>
                    <span className="comp-hint">Мысль, ключ, напоминание — с таймером или без</span>
                  </button>
                </div>
              )}
            </>
          )}

          {showFiles && (
            <>
              <div className="sec-head">
                <span className="label-mono">Файлы</span>
                <span className="sec-rule" />
                <span className="sec-note mono num">
                  {shownFiles.length}{' '}
                  {cat === 'all' ? `файла · ${cats.length - 1} кластеров` : `в «${catLabel}»`}
                  {shownFiles.length > pagedFiles.length ? ` · показано ${pagedFiles.length}` : ''}
                </span>
              </div>

              <LibraryBoard
                boardId={view === 'files' ? 'files' : 'all'}
                items={fileItems}
                allKeys={view === 'files' ? allFileKeys : [...allFileKeys, ...allNoteKeys]}
                layouts={layouts}
                density={density}
                onLayouts={updateLayouts}
                onPinNote={handlePinNote}
                onDropCluster={handleDropCluster}
                labelOf={labelOfTile}
              />

              {shownFiles.length > pagedFiles.length && (
                <div className="lib-more">
                  <button
                    className="btn btn-ghost btn-sm"
                    data-testid="lib-show-more"
                    onClick={() => setFileLimit((n) => n + FILE_PAGE)}
                  >
                    <IconPlus />
                    Показать ещё {Math.min(FILE_PAGE, shownFiles.length - pagedFiles.length)} из{' '}
                    {shownFiles.length - pagedFiles.length}
                  </button>
                </div>
              )}

              {shownFiles.length === 0 && (
                <div className="empty-state panel">
                  <IconDoc width={20} height={20} stroke="currentColor" strokeWidth={1.4} />
                  <span className="label-mono">
                    {searching ? `Нет файлов по «${NAV.query}»` : `В кластере «${catLabel}» пусто`}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => (searching ? NAV.setQuery('') : setCat('all'))}
                  >
                    <IconRefresh />
                    Показать все файлы
                  </button>
                </div>
              )}
            </>
          )}
        </main>

        {selNote ? (
          <aside className="inspector panel fade-in" aria-label="Инспектор стикера">
            <div className="insp-tabs">
              <span className="chip chip-note">
                <IconSticker width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
                стикер
              </span>
              {selNote.expiresAt === null ? (
                <span className="chip">постоянный</span>
              ) : (
                <span className="chip chip-warn num">
                  {fmtLeft(selNote.expiresAt - now)} до стирания
                </span>
              )}
            </div>

            <div className={`preview note-preview${noteOpen ? '' : ' shut'}`}>
              <p aria-hidden={!noteOpen}>{selNote.body}</p>
              {!noteOpen && <span className="sr-only">Содержимое закрыто паролем</span>}
            </div>

            {!noteOpen && (
              <div className="unlock unlock-insp">
                <div className="unlock-row">
                  <input
                    className={`input input-sm mono${keyError && askKey === selNote.id ? ' err' : ''}`}
                    type="password"
                    value={askKey === selNote.id ? keyValue : ''}
                    onFocus={() => {
                      if (askKey !== selNote.id) openKeyPrompt(selNote.id)
                    }}
                    onChange={(e) => {
                      if (askKey !== selNote.id) setAskKey(selNote.id)
                      setKeyValue(e.target.value)
                      if (keyError) setKeyError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitKey(selNote.id)
                    }}
                    placeholder="локальный ключ"
                    aria-label="Локальный ключ"
                    aria-invalid={!!(keyError && askKey === selNote.id)}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => submitKey(selNote.id)}
                    aria-label="Открыть стикер"
                  >
                    <IconKey />
                  </button>
                </div>
                <span
                  className={`key-hint mono${keyError && askKey === selNote.id ? ' err' : ''}`}
                  role="status"
                >
                  {(keyError && askKey === selNote.id ? keyError : null) ??
                    (selNote.secret
                      ? 'ключ проверяется на устройстве, ничего не уходит в сеть'
                      : 'демо-сейф: подойдёт любой ключ')}
                </span>
              </div>
            )}

            <div className="file-name">{selNote.title}</div>

            <div className="meta-grid">
              <div>
                <span className="label-mono">Создан</span>
                <div className="v num">{fmtWhen(selNote.createdAt, now)}</div>
              </div>
              <div>
                <span className="label-mono">Символов</span>
                <div className="v num">{noteOpen ? selNote.body.length : '—'}</div>
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <span className="label-mono">Состояние</span>
                <div className="badges-row">
                  {selNote.expiresAt === null ? (
                    <span className="badge badge-ok">
                      <IconPin />
                      живёт постоянно
                    </span>
                  ) : (
                    <span className="badge badge-warn">
                      <IconClock />
                      временный
                    </span>
                  )}
                  <span className={selNote.locked ? 'badge badge-info' : 'badge'}>
                    <IconLock />
                    {selNote.locked ? (noteOpen ? 'ключ введён' : 'пароль включён') : 'без пароля'}
                  </span>
                </div>
              </div>
            </div>

            <div className="insp-block panel">
              <div className="blk-head">
                <span className="label-mono">Жизнь стикера</span>
                <IconClock width={13} height={13} stroke="currentColor" strokeWidth={1.5} />
              </div>
              <p>
                {selNote.expiresAt === null
                  ? 'Стикер закреплён: он остаётся в сейфе, пока вы сами его не удалите.'
                  : 'По истечении таймера стикер стирается локально, вместе с телом, тегами и связями на карте. Корзины нет.'}
              </p>
              <div className="life-btns">
                {selNote.expiresAt !== null && (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => D.extendNote(selNote.id, DAY)}
                    >
                      <IconRefresh />
                      +24 часа
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => makePermanent(selNote.id)}
                    >
                      <IconPin />
                      Оставить навсегда
                    </button>
                  </>
                )}
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => burnNow(selNote.id)}
                >
                  <IconTrash />
                  Стереть сейчас
                </button>
              </div>
            </div>

            <div className="insp-block panel">
              <div className="blk-head">
                <span className="label-mono">Защита</span>
                <button
                  className={`toggle${selNote.locked ? ' on' : ''}`}
                  role="switch"
                  aria-checked={selNote.locked}
                  aria-label="Пароль на стикер"
                  onClick={() => {
                    if (selNote.locked) removeLock(selNote.id)
                    else {
                      setSettingKeyFor(selNote.id)
                      setNewKey('')
                    }
                  }}
                >
                  <i />
                </button>
              </div>
              <p>
                {selNote.locked
                  ? 'Тело шифруется ключом AES-256, который не покидает устройство. До ввода ключа виден только размытый силуэт текста.'
                  : 'Стикер лежит открытым: его читает любой, кто уже вошёл в сейф. Включите пароль для отдельного ключа.'}
              </p>
              {settingKeyFor === selNote.id && !selNote.locked && (
                <div className="key-setup">
                  <input
                    className="input input-sm mono"
                    type="password"
                    autoFocus
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyLock(selNote.id)
                    }}
                    placeholder="придумайте локальный ключ"
                    aria-label="Новый локальный ключ"
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => applyLock(selNote.id)}
                    disabled={!newKey.trim()}
                  >
                    <IconCheck />
                    Закрыть
                  </button>
                </div>
              )}
            </div>

            <div className="insp-block panel">
              <div className="blk-head">
                <span className="label-mono">Привязка</span>
                <IconPin width={13} height={13} stroke="currentColor" strokeWidth={1.5} />
              </div>
              {selNote.pinnedTo ? (
                <button
                  className="rel-item pin-item"
                  onClick={() => {
                    const f = selNote.pinnedTo ? D.fileById(selNote.pinnedTo) : undefined
                    if (f) {
                      if (view === 'notes') setView('all')
                      setSel({ kind: 'file', id: f.id })
                    } else flash('Файл больше не в сейфе')
                  }}
                >
                  <IconDoc width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
                  <span className="rn mono ellipsis">
                    {D.fileById(selNote.pinnedTo)?.name ?? 'файл удалён'}
                  </span>
                  <span className="rp mono num">открыть</span>
                </button>
              ) : (
                <p>Стикер ни к чему не приколот. ИИ предложит файл, когда найдёт пересечение.</p>
              )}
            </div>

            <div className="insp-block panel">
              <div className="blk-head">
                <span className="label-mono">Что увидел ИИ</span>
                <span className="chip">
                  <IconSparkText width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
                  локально
                </span>
              </div>
              <p>
                {selNote.locked && !noteOpen
                  ? 'Закрытый стикер индексируется только по вашим тегам: модель не читает тело, пока не введён ключ.'
                  : `Текст разобран на смыслы и добавлен в карту памяти: ${
                      D.neighbors(selNote.id).length
                    } связей в сейфе.`}
              </p>
            </div>

            <div className="insp-actions">
              <button
                className="btn btn-primary btn-full"
                onClick={() => (noteOpen ? startEdit(selNote) : openKeyPrompt(selNote.id))}
              >
                {noteOpen ? <IconPencil /> : <IconKey />}
                {noteOpen ? 'Редактировать' : 'Ввести ключ'}
              </button>
              <button
                className="btn btn-ghost btn-full"
                onClick={() => NAV.openOnMap(selNote.pinnedTo ?? selNote.id)}
              >
                <IconGraph />
                Показать на карте
              </button>
            </div>
          </aside>
        ) : (
          <aside className="inspector panel fade-in" aria-label="Инспектор файла">
            <div className="insp-tabs">
              <button
                className={`insp-tab${tab === 'details' ? ' on' : ''}`}
                onClick={() => setTab('details')}
                aria-pressed={tab === 'details'}
              >
                Детали
              </button>
              <button
                className={`insp-tab${tab === 'ai' ? ' on' : ''}`}
                onClick={() => setTab('ai')}
                aria-pressed={tab === 'ai'}
              >
                ИИ-анализ
              </button>
            </div>

            <div className="preview panel">
              <IconDocPreview width={44} height={44} stroke="currentColor" strokeWidth={1.2} />
              {selFile?.pages ? (
                <span className="chip page-badge num">СТР 1/{selFile.pages}</span>
              ) : null}
            </div>

            <div className="file-name mono num">{selFile?.name ?? '—'}</div>

            {tab === 'details' ? (
              <div className="meta-grid">
                <div>
                  <span className="label-mono">Размер</span>
                  <div className="v num">{selFile ? fmtBytes(selFile.bytes) : '—'}</div>
                </div>
                <div>
                  <span className="label-mono">Добавлен</span>
                  <div className="v num">{selFile?.date ?? '—'}</div>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <span className="label-mono">Кластер</span>
                  <div className="badges-row">
                    <button
                      className="chip chip-cat chip-btn"
                      onClick={() => selFile && NAV.openCluster(selFile.cluster)}
                      disabled={!selFile}
                    >
                      {selFile?.cat ?? '—'}
                    </button>
                  </div>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <span className="label-mono">Безопасность</span>
                  <div className="badges-row">
                    <span className="badge badge-ok">
                      <IconLock />
                      {stats.offline ? 'локально' : 'есть исходящие'}
                    </span>
                    <span className="badge badge-info">
                      <IconLock />
                      зашифровано
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="insp-block panel">
                <div className="blk-head">
                  <span className="label-mono">Оценка ИИ</span>
                  <span className="chip">
                    модель <span className="num">{stats.model}</span>
                  </span>
                </div>
                <p>
                  {selFile?.processing
                    ? 'Файл ещё разбирается на устройстве: как только модель дочитает его, здесь появятся тип, ключевые сущности и связи.'
                    : `Файл отнесён к кластеру «${selFile?.cat ?? '—'}». Найдено ${related.length} смысловых связей: ${
                        related.filter((r) => r.reason === 'tag').length
                      } по общим меткам, ${
                        related.filter((r) => r.reason === 'pin').length
                      } через приколотые стикеры.`}
                </p>
              </div>
            )}

            <div className="insp-block panel">
              <div className="blk-head">
                <span className="label-mono">Описание ИИ</span>
                <IconPencil width={13} height={13} stroke="currentColor" strokeWidth={1.5} />
              </div>
              <p>
                {selFile && fkGatedSelFile
                  ? 'Содержимое под файловым ключом. Введите ключ, чтобы расшифровать описание.'
                  : selFile?.processing
                    ? 'Описание появится после локального разбора.'
                    : (selFile?.desc ?? 'Файл не выбран.')}
              </p>
              {fkGatedSelFile && (
                <div className="badges-row">
                  <span className="fk-badge">
                    <IconLockRound width={10} height={10} stroke="currentColor" strokeWidth={1.6} />
                    под ключом
                  </span>
                </div>
              )}
            </div>

            <div className="insp-block panel">
              <div className="blk-head">
                <span className="label-mono">Приколотые стикеры</span>
                <span className="chip num">{pinnedToSel.length}</span>
              </div>
              {pinnedToSel.length > 0 ? (
                pinnedToSel.map((n) => (
                  <button
                    key={n.id}
                    className="rel-item pin-item"
                    onClick={() => {
                      if (view === 'files') setView('all')
                      setSel({ kind: 'note', id: n.id })
                    }}
                  >
                    <IconSticker width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
                    <span className="rn ellipsis">{n.title}</span>
                    <span className="rp mono num">
                      {n.expiresAt === null ? '∞' : fmtLeft(n.expiresAt - now)}
                    </span>
                  </button>
                ))
              ) : (
                <p>К этому файлу пока нет стикеров. Напишите первый — он будет виден рядом.</p>
              )}
              <button
                className="btn btn-ghost btn-sm btn-full pin-add"
                onClick={() => startNew(selFile?.id)}
                disabled={!selFile}
              >
                <IconPlus />
                Приколоть стикер
              </button>

              {/* Этап 5: файловый ключ — пароль ×2, wrapped мастер-ключом (п.4). */}
              <button
                className="btn btn-ghost btn-sm btn-full pin-add"
                data-testid="fk-set-open"
                onClick={() => {
                  setFkSetFor(selFile?.id ?? null)
                  setFkNew1('')
                  setFkNew2('')
                  setFkSetErr(null)
                }}
                disabled={!selFile || fk.isProtected(selFile.id)}
              >
                <IconLockRound width={13} height={13} stroke="currentColor" strokeWidth={1.6} />
                Поставить на ключ
              </button>
            </div>

            {/* Соседи берутся из графа связей, а не из фиксированного списка. */}
            <div className="insp-block panel">
              <div className="blk-head">
                <span className="label-mono">Связаны</span>
                <span className="chip num">{related.length}</span>
              </div>
              {related.length > 0 ? (
                related.map((r) => (
                  <button
                    key={r.node.id}
                    className="rel-item pin-item"
                    onClick={() =>
                      setSel({ kind: r.node.kind === 'note' ? 'note' : 'file', id: r.node.id })
                    }
                  >
                    {r.node.kind === 'note' ? (
                      <IconSticker width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
                    ) : (
                      <IconDoc width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
                    )}
                    <span className="rn mono ellipsis">{r.node.label}</span>
                    <span className="rp mono num">
                      {Math.round(r.w * 100)}% · {REASON_LABEL[r.reason]}
                    </span>
                  </button>
                ))
              ) : (
                <p>Связей пока нет: у файла нет общих меток и стикеров с другими объектами.</p>
              )}
            </div>

            <div className="insp-actions">
              <button
                className="btn btn-primary btn-full"
                onClick={() =>
                  flash(
                    selFile?.processing
                      ? 'Файл ещё разбирается — откроется после индексации'
                      : `${selFile?.name} открывается в приложении на устройстве`,
                  )
                }
                disabled={!selFile}
              >
                <IconExternal />
                Открыть файл
              </button>
              <button
                className="btn btn-ghost btn-full"
                onClick={() => selFile && NAV.openOnMap(selFile.id)}
                disabled={!selFile}
              >
                <IconGraph />
                Показать на карте
              </button>
              <button
                className="btn btn-ghost btn-full btn-danger"
                onClick={() => {
                  if (!selFile) return
                  fk.forgetKey(selFile.id)
                  D.removeFile(selFile.id)
                }}
                disabled={!selFile}
              >
                <IconTrash />
                Удалить из сейфа
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* ===== FILE-KEYS v3.2b · модалки файловых ключей ===== */}
      {fkAsk !== null &&
        (() => {
          const f = views.find((x) => x.id === fkAsk)
          const cooling = Date.now() < fkCooldownUntil
          return (
            <div className="fk-modal" role="dialog" aria-modal="true" aria-label="Файловый ключ" data-testid="fk-ask-modal">
              <div className="lock-card">
                <div className="lk-head mono">
                  <IconKey width={12} height={12} aria-hidden="true" focusable="false" />
                  ФАЙЛ ПОД КЛЮЧОМ
                </div>
                <div className="file-name mono num">{f?.name ?? '—'}</div>
                <div className="lock-form">
                  <input
                    className={`lock-input mono${fkErr ? ' err' : ''}`}
                    type="password"
                    autoFocus
                    data-testid="fk-ask-input"
                    value={fkVal}
                    disabled={cooling}
                    onChange={(e) => {
                      setFkVal(e.target.value)
                      if (fkErr) setFkErr(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitFileKey()
                    }}
                    placeholder="ключ файла"
                    aria-label="Ключ файла"
                    aria-invalid={!!fkErr}
                  />
                  <span
                    className={`key-hint mono${fkErr ? ' err' : ''}`}
                    role="status"
                    data-testid="fk-ask-hint"
                  >
                    {fkErr ??
                      (cooling
                        ? 'анти-брутфорс: подождите перед следующей попыткой'
                        : 'ключ проверяется локально, ни один байт не уходит из устройства')}
                  </span>
                </div>
                <div className="fk-modal-row">
                  <button
                    className="btn btn-primary btn-sm"
                    data-testid="fk-ask-submit"
                    onClick={() => void submitFileKey()}
                    disabled={!fkVal.trim() || cooling}
                  >
                    <IconKey />
                    Открыть
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setFkAsk(null)
                      setFkErr(null)
                      setFkVal('')
                      setFkCooldownUntil(0)
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {fkSetFor !== null &&
        (() => {
          const f = views.find((x) => x.id === fkSetFor)
          return (
            <div className="fk-modal" role="dialog" aria-modal="true" aria-label="Новый файловый ключ" data-testid="fk-set-modal">
              <div className="lock-card">
                <div className="lk-head mono">
                  <IconLockRound width={12} height={12} aria-hidden="true" focusable="false" />
                  ПОСТАВИТЬ НА КЛЮЧ
                </div>
                <div className="file-name mono num">{f?.name ?? '—'}</div>
                <p className="fk-note">
                  Случайный ключ файла оборачивается мастер-ключом сейфа (AES-GCM) и хранится на
                  этом устройстве. Без пароля файла описание не расшифровать; сброс сейфа стирает
                  файловые ключи вместе с доступом.
                </p>
                <div className="lock-form">
                  <input
                    className={`lock-input mono${fkSetErr ? ' err' : ''}`}
                    type="password"
                    autoFocus
                    data-testid="fk-set-pass1"
                    value={fkNew1}
                    onChange={(e) => {
                      setFkNew1(e.target.value)
                      if (fkSetErr) setFkSetErr(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveFileKeySetup()
                    }}
                    placeholder="новый ключ файла (минимум 8)"
                    aria-label="Новый ключ файла"
                    aria-invalid={!!fkSetErr}
                  />
                  <input
                    className={`lock-input mono${fkSetErr ? ' err' : ''}`}
                    type="password"
                    data-testid="fk-set-pass2"
                    value={fkNew2}
                    onChange={(e) => {
                      setFkNew2(e.target.value)
                      if (fkSetErr) setFkSetErr(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveFileKeySetup()
                    }}
                    placeholder="повторите ключ файла"
                    aria-label="Повторите ключ файла"
                  />
                  <span
                    className={`key-hint mono${fkSetErr ? ' err' : ''}`}
                    role="status"
                    data-testid="fk-set-hint"
                  >
                    {fkSetErr ?? 'описание файла будет зашифровано этим ключом'}
                  </span>
                </div>
                <div className="fk-modal-row">
                  <button className="btn btn-primary btn-sm" data-testid="fk-set-save" onClick={() => void saveFileKeySetup()}>
                    <IconLockRound width={13} height={13} stroke="currentColor" strokeWidth={1.6} />
                    Запереть
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setFkSetFor(null)
                      setFkSetErr(null)
                      setFkNew1('')
                      setFkNew2('')
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}

/* ============================================================
   СОДЕРЖИМОЕ ПЛИТОК
   Те же карточки, что рисовала статичная сетка: разметка перенесена
   как была, меняется только владелец состояния — теперь их рендерит
   экран, а размещает доска. Клик по карточке по-прежнему открывает
   инспектор; перенос не превращается в выбор, потому что движок
   срывает плитку только после порога/долгого нажатия.
   ============================================================ */

function NoteCardContent({
  note,
  onSelect,
  onTag,
  isSelected = false,
  marked = false,
  pickable = false,
}: {
  note: Note
  onSelect: (id: string, e: React.MouseEvent) => void
  onTag: (tag: string) => void
  isSelected?: boolean
  /** NF-5: карточка попала в мультивыделение. */
  marked?: boolean
  /** NF-5: режим выбора включён — курсор и рамка говорят об этом. */
  pickable?: boolean
}) {
  const D = useDataStore()
  const NAV = useNavStore()
  const { flash } = useToast()
  const now = useNow()

  /* Разблокировка — локальное состояние карточки: ключ не покидает её. */
  const [unlocked, setUnlocked] = useState<string[]>([])
  const [askKey, setAskKey] = useState<string | null>(null)
  const [keyValue, setKeyValue] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const keyFailRef = useRef(0)

  const left = note.expiresAt === null ? null : note.expiresAt - now
  const pct =
    left === null || !note.lifeSpan ? 100 : Math.max(2, Math.min(100, (left / note.lifeSpan) * 100))
  const soon = left !== null && left < HOUR
  const open = !note.locked || unlocked.includes(note.id)
  const pinnedFile = note.pinnedTo ? D.fileById(note.pinnedTo) : undefined
  const keyApplies = askKey === note.id

  async function submitKey() {
    const val = keyValue.trim()
    if (!val) {
      setKeyError('Введите ключ')
      return
    }
    /* П.10.6: зашифрованный секрет проверяется криптографически (ct:iv). */
    if (note.secret && looksEncrypted(note.secret)) {
      const verdict = await checkStickerSecret(note.secret, val)
      if (verdict === '') {
        setKeyError('Сейф нужно разблокировать заново')
        return
      }
      if (!verdict) {
        keyFailRef.current += 1
        setKeyError(
          keyFailRef.current > 1
            ? `Ключ не подходит · неудачных попыток: ${keyFailRef.current}`
            : 'Ключ не подходит',
        )
        setKeyValue('')
        return
      }
    } else if (note.secret && note.secret !== val) {
      /* Демо-секрет до миграции: прежняя честная сверка строки. */
      keyFailRef.current += 1
      setKeyError(
        keyFailRef.current > 1
          ? `Ключ не подходит · неудачных попыток: ${keyFailRef.current}`
          : 'Ключ не подходит',
      )
      setKeyValue('')
      return
    }
    keyFailRef.current = 0
    setUnlocked((u) => (u.includes(note.id) ? u : [...u, note.id]))
    setAskKey(null)
    setKeyValue('')
    setKeyError(null)
    flash('Стикер расшифрован на этом устройстве')
  }

  return (
    <article
      className={`ncard panel card-hover${isSelected ? ' sel' : ''}${
        left !== null ? ' temp' : ''
      }${open ? ' fade-in' : ''}${marked ? ' marked' : ''}${pickable ? ' pickable' : ''}`}
      onClick={(e) => onSelect(note.id, e)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(note.id, e as unknown as React.MouseEvent)
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      data-testid={`lib-note-${note.id}`}
      data-marked={marked ? '1' : undefined}
    >
      {(marked || pickable) && (
        <span className={`card-mark${marked ? ' on' : ''}`} aria-hidden="true">
          {marked ? <IconCheck width={11} height={11} stroke="currentColor" strokeWidth={2} /> : null}
        </span>
      )}
      <div className="ncard-top">
        <span className="chip chip-note">
          <IconSticker width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
          стикер
        </span>
        {left === null ? (
          <span className="ttl mono">постоянный</span>
        ) : (
          <span className={`ttl mono num${soon ? ' soon' : ''}`}>
            <IconClock width={11} height={11} stroke="currentColor" strokeWidth={1.6} />
            {fmtLeft(left)}
          </span>
        )}
      </div>

      <h3 className="ntitle">{note.title}</h3>

      <div className={`nbody-shell${open ? '' : ' shut'}`}>
        <p className="nbody" aria-hidden={!open}>
          {note.body}
        </p>
        {!open && <span className="sr-only">Содержимое закрыто паролем</span>}
      </div>

      {!open &&
        (keyApplies ? (
          <div className="unlock" onClick={(e) => e.stopPropagation()}>
            <div className="unlock-row">
              <input
                className={`input input-sm mono${keyError ? ' err' : ''}`}
                type="password"
                autoFocus
                value={keyValue}
                onChange={(e) => {
                  setKeyValue(e.target.value)
                  if (keyError) setKeyError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitKey()
                }}
                placeholder="локальный ключ"
                aria-label="Локальный ключ"
                aria-invalid={!!keyError}
              />
              <button className="btn btn-primary btn-sm" onClick={submitKey} aria-label="Открыть стикер">
                <IconKey />
              </button>
            </div>
            <span className={`key-hint mono${keyError ? ' err' : ''}`} role="status">
              {keyError ??
                (note.secret ? 'ключ проверяется на устройстве' : 'демо-сейф: подойдёт любой ключ')}
            </span>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-sm nunlock"
            onClick={(e) => {
              e.stopPropagation()
              setAskKey(note.id)
              setKeyValue('')
              setKeyError(null)
            }}
          >
            <IconLock />
            Ввести ключ
          </button>
        ))}

      <div className="tags">
        {note.locked && (
          <span className="badge badge-info">
            <IconLock />
            пароль
          </span>
        )}
        {note.tags.map((t) => (
          <button
            key={t}
            className="chip chip-ai chip-btn"
            onClick={(e) => {
              e.stopPropagation()
              onTag(t)
            }}
            aria-label={`Показать стикеры с тегом ${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {note.pinnedTo && (
        <button
          className="pin-row mono pin-jump"
          onClick={(e) => {
            e.stopPropagation()
            if (pinnedFile) NAV.openFile(pinnedFile.id)
            else flash('Файл больше не в сейфе')
          }}
        >
          <IconPin width={12} height={12} stroke="currentColor" strokeWidth={1.5} />
          <span className="ellipsis">{pinnedFile?.name ?? 'файл удалён'}</span>
        </button>
      )}

      <footer className="mono num">{fmtWhen(note.createdAt, now)}</footer>

      {left !== null && (
        <span className={`decay${soon ? ' soon' : ''}`} aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </article>
  )
}

function FileCardContent({
  file,
  onSelect,
  fkHidden = false,
  marked = false,
  pickable = false,
}: {
  file: FileView
  onSelect: (id: string, e: React.MouseEvent) => void
  /** Файл под ключом: содержимое скрыто, видно имя и бейдж (этап 5). */
  fkHidden?: boolean
  /** NF-5: карточка попала в мультивыделение. */
  marked?: boolean
  pickable?: boolean
}) {
  const D = useDataStore()
  const NAV = useNavStore()
  const pinned = D.liveNotes.filter((n) => n.pinnedTo === file.id).length

  return (
    <article
      className={`fcard panel card-hover fade-in${file.processing ? ' proc-live beam-host' : ''}${
        marked ? ' marked' : ''
      }${pickable ? ' pickable' : ''}`}
      data-drop-pin={file.id}
      onClick={(e) => onSelect(file.id, e)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(file.id, e as unknown as React.MouseEvent)
        }
      }}
      role="button"
      tabIndex={0}
      data-testid={`lib-file-${file.id}`}
      data-marked={marked ? '1' : undefined}
    >
      {(marked || pickable) && (
        <span className={`card-mark${marked ? ' on' : ''}`} aria-hidden="true">
          {marked ? <IconCheck width={11} height={11} stroke="currentColor" strokeWidth={2} /> : null}
        </span>
      )}
      {/* Файл в обработке: луч по кромке показывает живую работу модели. */}
      {file.processing ? <Beam duration={3.2} size={34} /> : null}
      <div className="fcard-top">
        <span className="ficon panel">
          <file.Icon width={18} height={18} stroke="currentColor" strokeWidth={1.5} />
        </span>
        <button
          className="chip chip-cat chip-btn"
          onClick={(e) => {
            e.stopPropagation()
            NAV.openCluster(file.cluster)
          }}
          aria-label={`Показать кластер ${file.cat}`}
        >
          {file.cat}
        </button>
      </div>
      <div className="fname mono num">
        <b>{file.name}</b>
      </div>
      {file.processing ? (
        <div className="proc">
          <i className="net-dot" />
          <span className="label-mono">Обработка</span>
          <span className="ellipsis">ИИ изучает файл…</span>
        </div>
      ) : fkHidden ? (
        <p className="desc">
          <span className="fk-badge" title="Файл заперт файловым ключом">
            <IconLockRound width={10} height={10} stroke="currentColor" strokeWidth={1.6} />
            под ключом
          </span>
        </p>
      ) : (
        <p className="desc">{file.desc}</p>
      )}
      {!fkHidden && (
        <div className="tags">
          {file.tagList.map((t) => (
            <span key={t} className="chip chip-ai">
              {t}
            </span>
          ))}
        </div>
      )}
      <footer className="mono num">
        <span>{file.meta}</span>
        {pinned ? (
          <span className="fnotes">
            <IconSticker width={12} height={12} stroke="currentColor" strokeWidth={1.5} />
            {pinned}
          </span>
        ) : null}
      </footer>
    </article>
  )
}
