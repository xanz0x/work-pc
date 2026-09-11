'use client'

/* AR-2: слой стилей библиотеки приезжает вместе с чанком экрана. */
import '@/app/styles/screen-library.css'
import './cloud-viewer.css'
import './library-dirs.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconCheck,
  IconClock,
  IconClose,
  IconDoc,
  IconDocPreview,
  IconDatabase,
  IconExternal,
  IconFolder,
  IconGraph,
  IconKey,
  IconLayers,
  IconLock,
  IconLockRound,
  IconPencil,
  IconPin,
  IconPlus,
  IconRefresh,
  IconSticker,
  IconTag,
  IconTrash,
} from './icons'
import { CLUSTERS, clusterOf, fmtBytes, type ClusterId, type FileView } from '@/lib/data'
import { DAY, TTL_OPTIONS, fmtLeft, fmtWhen, type Note } from '@/lib/notes'
import {
  useDataStore,
  useMutations,
  useLockStore,
  useNavStore,
  useNow,
  useToast,
} from '@/lib/vault-store'
import { useIndexActions, useIndexSummary } from '@/lib/indexer/context'
import {
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
import { looksEncrypted, useFileKeys } from '@/hooks/use-file-keys'
import { NumTicker } from '@/components/ui/num-ticker'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { useBulkRunner } from '@/lib/bulk'
import { useIntent } from '@/lib/commands'
import { BulkBar, type BulkAction } from '@/components/bulk-bar'
import { PasswordInput } from './password-input'
import { trackAction, trackDrop } from '@/lib/telemetry'
import { useAccount } from '@/lib/account'
import { LibraryContextMenu, type LibraryMenuAction, type LibraryMenuTarget } from './library-context-menu'
import { LibraryShareDialog, type LibraryShareRequest } from './library-share-dialog'
import { LibraryDeleteDialog, type LibraryDeleteRequest } from './library-delete-dialog'
import { IntakeDirDialog } from './intake-dir-dialog'
import { SharedNoteInspector } from './shared-note-inspector'
import { LibraryViewer, type LibraryViewerTarget } from './library-viewer'
import { IntakeStrip } from './intake-strip'
import { LibraryNoteInspector } from './library-note-inspector'
import { LibraryFileInspector } from './library-file-inspector'
import { FileCardContent, NoteCardContent } from './library-cards'
import { LibraryDirStrip } from './library-dir-strip'
import { LibraryToolbar } from './library-toolbar'
import { FileKeyAskDialog, FileKeySetDialog } from './library-fk-dialogs'
import { BRIDGE_HINT, absPathOf, desktopBridge } from './library-shared'
import { intakeFiles, type IntakeTrack } from '@/lib/intake'
import { QUEUE_EVENT, takeIntake } from '@/lib/intake-queue'

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

export function ScreenLibrary() {
  const D = useDataStore()
  const NAV = useNavStore()
  const LK = useLockStore()
  const { flash } = useToast()
  const account = useAccount()
  const [cloudPreview, setCloudPreview] = useState<FileView | null>(null)
  /** Живой приём файлов: перенос в папку хранения и разбор ИИ. */
  const [intake, setIntake] = useState<IntakeTrack[]>([])
  /** Открытая подпапка папки хранения ('' — её корень). */
  const [dir, setDir] = useState('')
  /** Файлы ждут ответа «куда положить». */
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null)
  /* Кнопка «Добавить файл» в меню отдаёт файлы сюда — спрашиваем подпапку. */
  useEffect(() => {
    const pick = () => {
      const list = takeIntake()
      if (list.length > 0) setPendingFiles(list)
    }
    pick()
    window.addEventListener(QUEUE_EVENT, pick)
    return () => window.removeEventListener(QUEUE_EVENT, pick)
  }, [])
  const [contextMenu, setContextMenu] = useState<LibraryMenuTarget | null>(null)
  const [shareRequest, setShareRequest] = useState<LibraryShareRequest | null>(null)
  /** Окно удаления: с галочкой «удалить также с ПК» для файлов в папке хранения. */
  const [deleteRequest, setDeleteRequest] = useState<LibraryDeleteRequest | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const menuReturn = useRef<HTMLElement | null>(null)
  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    menuReturn.current?.focus({ preventScroll: true })
  }, [])
  /* LG-5: приём файлов, подключение папки и переиндексация — мутации:
     двойной клик по кнопке обязан дать один результат. */
  const M = useMutations()
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
    /* Подпапка выбранной папки на ПК: в ней видны только её файлы. Локальные
       файлы без папки живут в корне. При поиске папка не мешает искать. */
    if (!searching) list = list.filter((f) => (f.dir ?? '') === dir)
    if (searching) list = list.filter((f) => NAV.matchedFiles.has(f.id))
    return list
  }, [views, cat, dir, searching, NAV.matchedFiles])

  /** Подпапки текущей папки — полоса над списком. */
  const subDirs = useMemo(
    () => D.cloudFolders.filter((f) => f.split('/').slice(0, -1).join('/') === dir).sort((a, b) => a.localeCompare(b, 'ru')),
    [D.cloudFolders, dir],
  )

  /**
   * NF-1: на папке из тысячи файлов рисовать всё сразу нельзя — каждая
   * порция индексации перерисовывала бы тысячу карточек и роняла кадры.
   * Показываем страницами, «Показать ещё» добавляет следующую.
   */
  const [fileLimit, setFileLimit] = useState(FILE_PAGE)
  useEffect(() => setFileLimit(FILE_PAGE), [cat, dir, searching, NAV.query, view])
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
      if (!(CLUSTERS.some((c) => c.id === clusterRaw)) || D.fileById(fileId)?.shared) return
      D.retagFile(fileId, clusterRaw as ClusterId)
    },
    [D],
  )

  /** Стикер бросили на карточку файла — с тостом и отменой. */
  const handlePinNote = useCallback(
    (noteId: string, fileId: string) => {
      const note = liveNotes.find((n) => n.id === noteId)
      const file = D.fileById(fileId)
      if (!note || note.shared || !file || note.pinnedTo === fileId) return
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

  const selNote = sel?.kind === 'note' ? liveNotes.find((n) => n.id === sel.id) : undefined
  const selFile = sel?.kind === 'file' ? views.find((f) => f.id === sel.id) : undefined
  /** Действия моста в инспекторе: путь из метаданных + живой мост Electron. */
  const selFileAbsPath = selFile ? absPathOf(selFile) : null
  const selFileBridgeReady = Boolean(desktopBridge()?.openPath)
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

  /** Закрыть модалку постановки ключа: одна дверь для Escape, «Отмены» и успеха. */
  function closeFkSet() {
    setFkSetFor(null)
    setFkSetErr(null)
    setFkNew1('')
    setFkNew2('')
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
      ...(view !== 'notes' ? pagedFiles.filter((f) => !f.shared).map((f) => `file:${f.id}`) : []),
      ...(view !== 'files' ? shownNotes.filter((n) => !n.shared).map((n) => `note:${n.id}`) : []),
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
      ...(view !== 'notes' ? shownFiles.filter((f) => !f.shared).map((f) => `file:${f.id}`) : []),
      ...(view !== 'files' ? shownNotes.filter((n) => !n.shared).map((n) => `note:${n.id}`) : []),
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
    setContextMenu(null)
    setShareRequest(null)
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
      const shared = kind === 'file' ? D.fileById(id)?.shared : D.liveNotes.find((n) => n.id === id)?.shared
      if (shared) {
        if (kind === 'file') openFileTile(id)
        else NAV.openNote(id)
        return
      }
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
    [markKey, selectMode, openFileTile, NAV, D],
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
        <PasswordInput
          className="input input-sm mono"
          autoFocus
          value={bulkKey1}
          onChange={(e) => {
            setBulkKey1(e.target.value)
            if (bulkKeyErr) setBulkKeyErr(null)
          }}
          placeholder="ключ файлов (минимум 8)"
          aria-label="Ключ для выбранных файлов"
          testId="lib-bulk-key1"
        />
        <PasswordInput
          className="input input-sm mono"
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
          testId="lib-bulk-key2"
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
          pickable={selectMode && !n.shared}
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
          pickable={selectMode && !f.shared}
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

  /** Перевести серверный файл между «моей папкой» и общим диском. */
  async function setCloudShared(cloudId: string, shared: boolean) {
    try {
      const r = await fetch(`/ai-api/cloud/file/${encodeURIComponent(cloudId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error ?? `Ошибка ${r.status}`)
      window.dispatchEvent(new Event('wsx:cloud-changed'))
      flash(shared ? 'Файл добавлен в общую папку' : 'Файл убран из общей папки — он остался в вашей')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Не удалось изменить доступ к файлу')
    }
  }

  function validateShare(request: LibraryShareRequest): string | null {    if (!account.isAdmin || !account.has('cloud')) return 'Изменять общий диск может только администратор.'
    if (LK.lock.status === 'locked' || LK.lock.busy) return 'Сначала разблокируйте сейф.'
    if (request.mode === 'remove') return null
    if (request.kind === 'note') {
      const n = D.liveNotes.find((n) => n.id === request.id)
      if (!n || n.shared) return 'Личная заметка недоступна.'
      if (!isOpen(n)) return 'Сначала введите ключ заметки в инспекторе.'
    } else {
      const f = D.fileById(request.id)
      if (!f || f.shared) return 'Личный файл недоступен.'
      if (f.demo) return 'У демо-файла нет оригинала для публикации.'
      if (f.processing) return 'Дождитесь окончания обработки файла.'
      if (fk.isProtected(f.id) && !fk.isOpen(f.id)) return 'Сначала введите ключ файла.'
    }
    return null
  }

  function openContext(target: EventTarget | null, x?: number, y?: number) {
    if (!(target instanceof Element) || target.closest('input,textarea,[contenteditable="true"]')) return false
    const card = target.closest<HTMLElement>('[data-library-id]')
    if (!card) return false
    const id = card.dataset.libraryId!
    const kind = card.dataset.libraryKind as 'file' | 'note'
    const r = card.getBoundingClientRect()
    menuReturn.current = card
    setSel({ kind, id })
    setContextMenu({ kind, id, x: x ?? r.left + 24, y: y ?? r.top + 24, trigger: card })
    return true
  }

  const contextFile = contextMenu?.kind === 'file' ? D.viewById(contextMenu.id) : undefined
  const contextNote = contextMenu?.kind === 'note' ? D.liveNotes.find((n) => n.id === contextMenu.id) : undefined
  const contextObject = contextFile ?? contextNote
  const contextTitle = contextFile?.name ?? contextNote?.title ?? ''
  const menuActions: LibraryMenuAction[] = []
  if (contextMenu && contextObject) {
    const { kind, id } = contextMenu
    menuActions.push({ id: 'open', label: 'Открыть в библиотеке', icon: <IconDocPreview />, run: () => kind === 'file' ? openFileTile(id) : NAV.openNote(id) })
    if (contextNote && !contextNote.shared) menuActions.push({ id: 'edit', label: isOpen(contextNote) ? 'Редактировать заметку' : 'Ввести ключ заметки', icon: isOpen(contextNote) ? <IconPencil /> : <IconKey />, run: () => isOpen(contextNote) ? startEdit(contextNote) : openKeyPrompt(id) })
    if (contextFile) {
      /* Просмотр работает для любого файла: общий диск отдаёт байты роутом,
         локальный — оригиналом из индексатора; что не показывается в браузере,
         просмотрщик скажет честно и предложит «Открыть на ПК». */
      menuActions.push({ id: 'preview', label: 'Просмотр', icon: <IconDocPreview />, run: () => (fk.isProtected(id) && !fk.isOpen(id) ? openFileTile(id) : setCloudPreview(contextFile)) })
      if (contextFile.shared) menuActions.push({ id: 'download', label: 'Скачать файл', icon: <IconExternal />, href: `/ai-api/cloud/file/${contextFile.cloudId}` })
      const abs = absPathOf(contextFile)
      const bridgeReady = Boolean(desktopBridge()?.openPath)
      menuActions.push({ id: 'open-pc', label: 'Открыть на ПК', icon: <IconExternal />, disabled: !bridgeReady || !abs, note: bridgeReady ? (abs ? undefined : BRIDGE_HINT) : BRIDGE_HINT, run: () => desktopBridge()?.openPath?.(abs!) })
      menuActions.push({ id: 'reveal', label: 'Показать в папке', icon: <IconFolder />, disabled: !bridgeReady || !abs, note: bridgeReady ? (abs ? undefined : BRIDGE_HINT) : BRIDGE_HINT, run: () => desktopBridge()?.revealInExplorer?.(abs!) })
    }
    menuActions.push({ id: 'map', label: 'Показать на карте', icon: <IconGraph />, run: () => NAV.openOnMap(id) })
    if (contextFile && !contextFile.shared) menuActions.push({ id: 'pin-note', label: 'Приколоть заметку', icon: <IconSticker />, run: () => startNew(id) })
    if (account.isAdmin && account.has('cloud') && contextFile?.shared && contextFile.cloudId) {
      /* Файл уже лежит в локальной папке на ПК: в общую папку он попадает
         одним действием — байты при этом остаются на месте. */
      const toShared = contextFile.cloudShared === false
      menuActions.push({
        id: toShared ? 'to-shared' : 'to-local',
        label: toShared ? 'Добавить в общую папку' : 'Убрать из общей папки',
        icon: <IconDatabase />,
        run: () => void setCloudShared(contextFile.cloudId!, toShared),
      })
    } else if (account.isAdmin && account.has('cloud')) {
      const cloudId = contextObject.shared ? contextObject.cloudId : D.cloudCopies[`${kind}:${id}`]
      const request: LibraryShareRequest = { mode: cloudId ? 'remove' : 'share', kind, id, title: contextTitle, cloudId }
      const reason = validateShare(request)
      menuActions.push({ id: cloudId ? 'unshare' : 'share', label: cloudId ? 'Удалить с общего диска' : 'Добавить в общий диск', icon: <IconDatabase />, disabled: !!reason, note: reason ?? undefined, run: () => setShareRequest(request) })
    }
    if (!contextObject.shared) menuActions.push({ id: 'delete', label: kind === 'file' ? 'Убрать из библиотеки' : 'Стереть заметку', icon: <IconTrash />, danger: true, run: () => {
      if (kind === 'file') {
        setDeleteErr(null)
        setDeleteRequest({ kind: 'file', id, title: contextTitle, absPath: contextFile ? absPathOf(contextFile) : null, cloudId: contextFile?.cloudId ?? null })
      } else {
        if (!window.confirm(`Стереть «${contextTitle}» без восстановления? Общая копия, если она есть, останется на диске.`)) return
        burnNow(id)
      }
    } })
  }

  /** Аргумент просмотрщика: общий диск отдаёт байты, absPath — опционально. */
  const viewerTarget: LibraryViewerTarget | null = cloudPreview
    ? {
        id: cloudPreview.id,
        name: cloudPreview.name,
        bytes: cloudPreview.bytes,
        cloudId: cloudPreview.cloudId ?? D.cloudCopies[`file:${cloudPreview.id}`] ?? null,
        absPath: absPathOf(cloudPreview),
        /* Паспорт файла в просмотрщике — разбор ИИ-архивариуса. */
        description: cloudPreview.desc,
        tags: cloudPreview.tags,
        ...(cloudPreview.analysisStatus ? { analysisStatus: cloudPreview.analysisStatus } : {}),
        ...(cloudPreview.fileName ? { fileName: cloudPreview.fileName } : {}),
      }
    : null

  /**
   * Подтверждённое удаление из окна: при включённой галочке сервер сначала
   * стирает байты из папки хранения (с проверкой «файла больше нет на диске»),
   * и только потом запись покидает библиотеку. Без галочки байты остаются.
   */
  async function confirmDelete(removeBytes: boolean) {
    const req = deleteRequest
    if (!req) return
    setDeleteBusy(true)
    setDeleteErr(null)
    try {
      if (req.kind === 'file' && req.cloudId) {
        const r = await fetch(`/ai-api/cloud/file/${encodeURIComponent(req.cloudId)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeBytes }),
        })
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) throw new Error(body.error ?? `Ошибка ${r.status}`)
        window.dispatchEvent(new Event('wsx:cloud-changed'))
      }
      if (req.kind === 'file') {
        fk.forgetKey(req.id)
        D.removeFile(req.id)
        flash(removeBytes ? `«${req.title}» удалён из библиотеки и с ПК.` : `«${req.title}» убран из библиотеки; файл остался в папке на ПК.`)
      }
      setDeleteRequest(null)
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Не удалось удалить файл.')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="scroll-col" data-testid="screen-library"
      onContextMenu={(e) => { if (openContext(e.target, e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation() } }}
      onKeyDownCapture={(e) => { if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && openContext(e.target)) { e.preventDefault(); e.stopPropagation() } }}>
      {contextMenu && contextObject && <LibraryContextMenu target={contextMenu} title={contextTitle} actions={menuActions} onClose={closeContextMenu} />}
      {shareRequest && <LibraryShareDialog key={`${shareRequest.mode}:${shareRequest.kind}:${shareRequest.id}`} request={shareRequest} validate={validateShare} onClose={() => setShareRequest(null)} />}
      {deleteRequest && <LibraryDeleteDialog request={deleteRequest} busy={deleteBusy} error={deleteErr} onConfirm={(removeBytes) => void confirmDelete(removeBytes)} onClose={() => { if (!deleteBusy) setDeleteRequest(null) }} />}
      {pendingFiles && (
        <IntakeDirDialog
          root={D.cloudRoot}
          folders={D.cloudFolders}
          initialDir={dir}
          count={pendingFiles.length}
          onCancel={() => setPendingFiles(null)}
          onPick={(target) => {
            const list = pendingFiles
            setPendingFiles(null)
            setDir(target)
            void intakeFiles(list, setIntake, target)
            trackAction('files.intake')
          }}
        />
      )}
      {/* Единственная live-область на все доски: скринридер слышит
         каждое действие один раз, без дублей из двух смонтированных
         досок режима «Всё». */}
      <div id="board-live" className="sr-only" role="status" aria-live="polite" />
      {viewerTarget && (
        <LibraryViewer target={viewerTarget} onClose={() => setCloudPreview(null)} />
      )}
      <IntakeStrip tracks={intake} onClose={() => setIntake([])} />
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
                  disabled={idxs.busy || M.isPending('index:folder')}
                  onClick={() =>
                    void M.runExclusive('index:folder', () => idxa.connectFolder(), {
                      errorMessage: 'Не удалось подключить папку. Индекс не изменился.',
                    })
                  }
                  title="Выбрать папку на диске и построить индекс по содержимому"
                >
                  <IconGraph />
                  {M.isPending('index:folder')
                    ? 'Подключаю…'
                    : idxs.folder
                      ? 'Сменить папку'
                      : 'Подключить папку'}
                </button>
              ) : null}
              {idxs.folder && idxs.folderMode === 'fsa' ? (
                <button
                  className="btn btn-ghost"
                  data-testid="idx-reindex"
                  disabled={idxs.busy || M.isPending('index:reindex')}
                  onClick={() =>
                    void M.runExclusive('index:reindex', () => idxa.reindex(false), {
                      errorMessage: 'Переиндексация не прошла. Прежний индекс на месте.',
                    }).then((r) => {
                      if (r.ok) trackAction('files.reindex')
                    })
                  }
                  title="Перечитать папку: изменённые файлы будут прочитаны заново"
                >
                  <IconRefresh />
                  {M.isPending('index:reindex') ? 'Читаю…' : 'Переиндексировать'}
                </button>
              ) : null}
              <button
                className="btn btn-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={M.isPending('index:files')}
                data-testid="lib-add-file"
              >
                <IconPlus />
                {M.isPending('index:files') ? 'Принимаю…' : 'Добавить файл'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                aria-label="Выбрать файлы для индексации"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? [])
                  if (list.length > 0) {
                    setCat('all')
                    if (view === 'notes') setView('all')
                    /* Один файл — одна запись. Есть локальная папка хранения:
                       спрашиваем подпапку, файл физически уезжает туда, и его
                       разбирает ИИ. Папки нет — работает прежний локальный
                       индексатор. Раньше шли оба пути сразу, и в библиотеке
                       появлялись две карточки. */
                    if (account.has('cloud') && D.cloudRoot) {
                      setPendingFiles(list)
                    } else {
                      void M.runExclusive('index:files', () => idxa.indexFiles(list), {
                        errorMessage: 'Файлы не приняты. Сейф остался прежним.',
                      }).then((r) => {
                        /* NF-9: счётчик исхода приёма — без имён и размеров. */
                        if (r.ok) trackAction('files.intake')
                        else if (r.reason === 'error') trackDrop('files.intake.failed')
                      })
                    }
                  }
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* UX-5: демо-данные названы своим именем и убираются одним действием. */}
          {D.demo.active && (
            <div
              className="demo-banner panel"
              role="region"
              aria-label="Демо-данные"
              data-testid="demo-banner"
            >
              <span className="demo-tag" aria-hidden="true">
                демо
              </span>
              <div className="demo-banner-text">
                <b>В сейфе показательные данные</b>
                <span>
                  {D.demo.files} файлов и {D.demo.notes} стикеров из демо-корпуса: они помечены
                  плашкой «демо» и не смешиваются с тем, что вы добавите или импортируете.
                </span>
              </div>
              <button
                className="btn btn-ghost demo-clear-btn"
                onClick={D.clearDemo}
                title="Убрать демо-объекты; ваши файлы и стикеры останутся"
                data-testid="demo-clear"
              >
                <IconTrash />
                Начать с чистого сейфа
              </button>
            </div>
          )}

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

          {/* Полоса подпапок: те же настоящие папки внутри выбранной папки на ПК. */}
          {account.has('cloud') && D.cloudRoot && (
            <LibraryDirStrip root={D.cloudRoot} dir={dir} subDirs={subDirs} onDir={setDir} />
          )}

          <LibraryToolbar
            view={view}
            onLayer={switchLayer}
            tags={tags}
            tag={tag}
            onTag={setTag}
            cats={cats}
            cat={cat}
            onCat={setCat}
            boardDragActive={boardDragActive}
            selectMode={selectMode}
            onSelectMode={() => {
              setSelectMode((m) => !m)
              if (selectMode) clearMarks()
            }}
            density={density}
            onDensity={() => setDensity((d) => (d === 'cozy' ? 'compact' : 'cozy'))}
            canResetBoard={isCustom(curLayout)}
            onResetBoard={() => {
              setLayouts((prev) => putBoard(prev, boardId, resetBoard()))
              flash('Раскладка сброшена к сортировке по умолчанию')
            }}
          />

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
                    <PasswordInput
                      className="input input-sm mono"
                      testId="note-draft-password"
                      aria-label="Пароль стикера"
                      value={draftKey}
                      onChange={(e) => setDraftKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveDraft()
                      }}
                      placeholder={
                        editing ? 'Пусто — сохранить прежний пароль' : 'Пароль стикера'
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
                <h2 className="label-mono">Стикеры</h2>
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
                <h2 className="label-mono">Файлы</h2>
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

        {selNote?.shared ? (
          <SharedNoteInspector note={selNote} canWrite={account.isAdmin && account.has('cloud')} onRemove={() => setShareRequest({ mode: 'remove', kind: 'note', id: selNote.id, title: selNote.title, cloudId: selNote.cloudId })} />
        ) : selNote ? (
          <LibraryNoteInspector
            note={selNote}
            now={now}
            noteOpen={noteOpen}
            askKey={askKey}
            keyValue={keyValue}
            keyError={keyError}
            setAskKey={setAskKey}
            setKeyValue={setKeyValue}
            setKeyError={setKeyError}
            openKeyPrompt={openKeyPrompt}
            submitKey={submitKey}
            settingKeyFor={settingKeyFor}
            setSettingKeyFor={setSettingKeyFor}
            newKey={newKey}
            setNewKey={setNewKey}
            applyLock={applyLock}
            removeLock={removeLock}
            makePermanent={makePermanent}
            burnNow={burnNow}
            startEdit={startEdit}
            view={view}
            setView={setView}
            setSel={setSel}
          />
        ) : (
          <LibraryFileInspector
            selFile={selFile}
            tab={tab}
            setTab={setTab}
            isAdmin={account.isAdmin}
            fk={fk}
            now={now}
            view={view}
            setView={setView}
            setSel={setSel}
            related={related}
            pinnedToSel={pinnedToSel}
            fkGatedSelFile={fkGatedSelFile}
            selFileAbsPath={selFileAbsPath}
            selFileBridgeReady={selFileBridgeReady}
            setCloudPreview={setCloudPreview}
            setCloudShared={setCloudShared}
            setShareRequest={setShareRequest}
            onDeleteRequest={(r) => {
              setDeleteErr(null)
              setDeleteRequest({ kind: 'file', id: r.id, title: r.title, absPath: r.absPath, cloudId: r.cloudId })
            }}
            openFileTile={openFileTile}
            startNew={startNew}
            setFkAsk={setFkAsk}
            setFkVal={setFkVal}
            setFkErr={setFkErr}
            setFkCooldownUntil={setFkCooldownUntil}
            setFkSetFor={setFkSetFor}
            setFkNew1={setFkNew1}
            setFkNew2={setFkNew2}
            setFkSetErr={setFkSetErr}
          />
        )}
      </div>

      {/* ===== FILE-KEYS v3.2b · модалки файловых ключей ===== */}
      {fkAsk !== null && (
        <FileKeyAskDialog
          fileName={views.find((x) => x.id === fkAsk)?.name ?? '—'}
          value={fkVal}
          error={fkErr}
          cooling={Date.now() < fkCooldownUntil}
          onValue={setFkVal}
          onError={setFkErr}
          onSubmit={() => void submitFileKey()}
          onClose={() => {
            setFkAsk(null)
            setFkErr(null)
            setFkVal('')
            setFkCooldownUntil(0)
          }}
        />
      )}

      {fkSetFor !== null && (
        <FileKeySetDialog
          fileName={views.find((x) => x.id === fkSetFor)?.name ?? '—'}
          pass1={fkNew1}
          pass2={fkNew2}
          error={fkSetErr}
          onPass1={setFkNew1}
          onPass2={setFkNew2}
          onError={setFkSetErr}
          onSave={() => void saveFileKeySetup()}
          onClose={closeFkSet}
        />
      )}
    </div>
  )
}
