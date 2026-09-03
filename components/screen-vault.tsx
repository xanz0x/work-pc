'use client'

/* ============================================================
   ЭКРАН «МЕНЕДЖЕР СЕКРЕТОВ» · три колонки в стилистике «Графит»
   Навигация ← список ← деталь. Вся глубина внутри экрана: в сайдбаре
   у модуля ровно один пункт (правило роста из ТЗ §2.1).
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
/* AR-2: слой стилей менеджера секретов приезжает вместе с чанком экрана. */
import '@/app/styles/screen-vault.css'
import {
  IconCheck,
  IconDatabase,
  IconFolder,
  IconPlus,
  IconShield,
  IconSparkText,
  IconTag,
  IconTrash,
} from './icons'
import { useVault, useCoarseTick } from '@/lib/vault-store'
import { useSecrets } from '@/lib/secrets-store'
import { filterEntries, isLive, parseQuery, type SecretType } from '@/lib/secrets'
import { useBulkRunner } from '@/lib/bulk'
import { useIntent } from '@/lib/commands'
import { BulkBar, type BulkAction } from './bulk-bar'
import { VaultNav, type VaultView } from './vault/vault-nav'
import { VaultList } from './vault/vault-list'
import { VaultDetail } from './vault/vault-detail'
import { VaultEditor } from './vault/vault-editor'
import { VaultGenerator } from './vault/vault-generator'
import { VaultHealth } from './vault/vault-health'
import { VaultExpiring } from './vault/vault-expiring'
import { VaultIo } from './vault/vault-io'

export function ScreenVault() {
  const v = useVault()
  const s = useSecrets()
  const [view, setView] = useState<VaultView>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null)
  const [newType, setNewType] = useState<SecretType>('login')
  const [gen, setGen] = useState(false)
  const [io, setIo] = useState(false)
  /* Сейф показывает даты и «5 минут назад», а не секунды: секундный тик
     раз в секунду пересобирал фильтр по всем записям и перерисовывал список
     с деталью. Грубых пяти секунд глазу достаточно. */
  const coarse = useCoarseTick(5000)
  const now = coarse || Date.now()

  /* ---------- NF-5: мультивыделение и массовые действия ---------- */
  const bulk = useBulkRunner()
  const [selectMode, setSelectMode] = useState(false)
  const [markedRaw, setMarked] = useState<string[]>([])
  const [form, setForm] = useState<null | 'tag' | 'folder'>(null)
  const [tagDraft, setTagDraft] = useState('')
  const anchor = useRef<string | null>(null)

  /* Команды палитры (NF-6) открывают модалки этого экрана. */
  useIntent('vault.new', () => {
    setNewType('login')
    setEditing('new')
  })
  useIntent('vault.generator', () => setGen(true))
  useIntent('vault.io', () => setIo(true))
  useIntent('vault.select', () => setSelectMode(true))

  /* Замок закрылся — выбор и модалки сбрасываются (п.10.4 + Panic Lock+).
     Именно «закрылся»: первый прогон при монтировании ничего не сбрасывает,
     иначе он гасил бы модалку, только что открытую командой палитры. */
  const lockEpochRef = useRef(v.lockEpoch)
  useEffect(() => {
    if (lockEpochRef.current === v.lockEpoch) return
    lockEpochRef.current = v.lockEpoch
    setSel(null)
    setEditing(null)
    setGen(false)
    setIo(false)
    setMarked([])
    setSelectMode(false)
  }, [v.lockEpoch])

  /* Переход из глобального поиска / палитры Ctrl+K. */
  useEffect(() => {
    if (!v.secretFocus) return
    setView({ kind: 'all' })
    setQuery('')
    setSel(v.secretFocus.id)
  }, [v.secretFocus])

  const trashMode = view.kind === 'trash'
  const pool = useMemo(() => {
    if (trashMode) return s.trash
    const live = s.live
    if (view.kind === 'fav') return live.filter((e) => e.favorite)
    if (view.kind === 'type') return live.filter((e) => e.type === view.type)
    if (view.kind === 'folder') return live.filter((e) => e.folderId === view.id)
    return live
  }, [s.live, s.trash, trashMode, view])

  const shown = useMemo(() => filterEntries(pool, parseQuery(query), now), [pool, query, now])
  const selected = useMemo(
    () => s.entries.find((e) => e.id === sel && (trashMode ? !isLive(e) : isLive(e))) ?? null,
    [s.entries, sel, trashMode],
  )

  /* Смена раздела или фильтра не должна оставлять «призрачное» выделение:
     отметки фильтруются по видимому списку прямо в рендере. */
  const shownIds = useMemo(() => shown.map((e) => e.id), [shown])
  const marked = useMemo(() => {
    const live = new Set(shownIds)
    return markedRaw.filter((id) => live.has(id))
  }, [markedRaw, shownIds])
  const markedSet = useMemo(() => new Set(marked), [marked])

  const onMark = useCallback(
    (id: string, mods: { range: boolean; toggle: boolean }) => {
      if (mods.range && anchor.current) {
        const from = shownIds.indexOf(anchor.current)
        const to = shownIds.indexOf(id)
        if (from >= 0 && to >= 0) {
          const slice = shownIds.slice(Math.min(from, to), Math.max(from, to) + 1)
          setMarked((prev) => [...new Set([...prev, ...slice])])
          return
        }
      }
      anchor.current = id
      setMarked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    },
    [shownIds],
  )

  const clearMarks = useCallback(() => {
    setMarked([])
    setForm(null)
    anchor.current = null
  }, [])

  /** Снимок прежних значений: по нему работает окно отмены. */
  const snapshotOf = useCallback(
    (ids: string[]) => {
      const set = new Set(ids)
      return s.entries
        .filter((e) => set.has(e.id))
        .map((e) => ({
          id: e.id,
          tags: e.tags,
          folderId: e.folderId,
          favorite: e.favorite,
          deletedAt: e.deletedAt,
        }))
    },
    [s.entries],
  )

  const runBulk = useCallback(
    (
      label: string,
      patch: Parameters<typeof s.bulkPatch>[1],
      undoLabel: string,
      done: string,
    ) => {
      const ids = [...marked]
      const snap = snapshotOf(ids)
      void bulk.start({
        label: `${label} · ${ids.length}`,
        ids,
        step: (batch) => s.bulkPatch(batch, patch),
        undo: { label: undoLabel, run: () => s.bulkRestore(snap) },
        onDone: (applied, cancelled) => {
          setForm(null)
          if (!cancelled) clearMarks()
          v.flash(cancelled ? `Прервано: применено ${applied} из ${ids.length}` : `${done}: ${applied}`)
        },
      })
    },
    [bulk, clearMarks, marked, s, snapshotOf, v],
  )

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (trashMode) {
      return [
        {
          id: 'restore',
          label: 'Восстановить',
          icon: <IconCheck />,
          hint: 'Вернуть записи из корзины в сейф',
          onRun: () => runBulk('Возврат из корзины', { trashed: false }, 'Можно вернуть: записи в корзину', 'Восстановлено'),
        },
        {
          id: 'purge',
          label: 'Удалить навсегда',
          icon: <IconTrash />,
          danger: true,
          hint: 'Стереть шифртекст без возможности восстановления',
          onRun: () => {
            const ids = [...marked]
            void bulk.start({
              label: `Безвозвратное удаление · ${ids.length}`,
              ids,
              step: (batch) => s.bulkPurge(batch),
              onDone: (applied) => {
                clearMarks()
                v.flash(`Удалено безвозвратно: ${applied}`)
              },
            })
          },
        },
      ]
    }
    return [
      {
        id: 'tag',
        label: 'Метка',
        icon: <IconTag />,
        hint: 'Добавить одну метку всем выбранным записям',
        onRun: () => setForm((f) => (f === 'tag' ? null : 'tag')),
      },
      {
        id: 'folder',
        label: 'Папка',
        icon: <IconFolder />,
        hint: 'Перенести выбранные записи в папку',
        onRun: () => setForm((f) => (f === 'folder' ? null : 'folder')),
      },
      {
        id: 'fav',
        label: 'В избранное',
        icon: <span aria-hidden="true">★</span>,
        hint: 'Отметить выбранные записи звездой',
        onRun: () => runBulk('Избранное', { favorite: true }, 'Можно вернуть: прежнее избранное', 'В избранном'),
      },
      {
        id: 'trash',
        label: 'В корзину',
        icon: <IconTrash />,
        danger: true,
        hint: 'Мягкое удаление: записи ждут в корзине и возвращаются одним нажатием',
        onRun: () => runBulk('Удаление в корзину', { trashed: true }, 'Можно вернуть: записи из корзины', 'В корзине'),
      },
    ]
  }, [bulk, clearMarks, marked, runBulk, s, trashMode, v])

  const bulkForm =
    form === 'tag' ? (
      <>
        <input
          className="input input-sm"
          value={tagDraft}
          autoFocus
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && tagDraft.trim()) {
              runBulk(`Метка «${tagDraft.trim()}»`, { addTag: tagDraft.trim() }, 'Можно вернуть: прежние метки', 'Метка добавлена')
            }
          }}
          placeholder="новая метка для выбранных записей"
          aria-label="Метка для выбранных записей"
          data-testid="vault-bulk-tag-input"
        />
        <button
          className="btn btn-primary btn-sm"
          disabled={!tagDraft.trim()}
          onClick={() =>
            runBulk(`Метка «${tagDraft.trim()}»`, { addTag: tagDraft.trim() }, 'Можно вернуть: прежние метки', 'Метка добавлена')
          }
          data-testid="vault-bulk-tag-apply"
        >
          <IconCheck />
          Применить
        </button>
      </>
    ) : form === 'folder' ? (
      <>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => runBulk('Папка снята', { folderId: null }, 'Можно вернуть: прежние папки', 'Без папки')}
          data-testid="vault-bulk-folder-none"
        >
          Без папки
        </button>
        {s.folders.map((f) => (
          <button
            key={f.id}
            className="btn btn-ghost btn-sm"
            onClick={() => runBulk(`Папка «${f.name}»`, { folderId: f.id }, 'Можно вернуть: прежние папки', 'Перенесено')}
            data-testid={`vault-bulk-folder-${f.id}`}
          >
            <IconFolder />
            {f.name}
          </button>
        ))}
        {s.folders.length === 0 && (
          <span className="vt-note">Папок пока нет — создайте её в левой колонке.</span>
        )}
      </>
    ) : null

  if (s.needsLock) {
    return (
      <div className="vt vt-gate" data-testid="vault-gate-lock">
        <div className="panel vt-gate-card">
          <span className="vt-gate-icon">
            <IconShield />
          </span>
          <h1 className="vt-gate-title">Менеджер секретов требует замок</h1>
          <p className="vt-note">
            Модуль не хранит ничего в открытом виде: ключ записей выводится из мастер-ключа сейфа
            (PBKDF2 600 000 → AES-GCM-256). Включите замок — и сейф секретов появится здесь.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => v.openSetting('security')}
            data-testid="vault-gate-setup"
          >
            Настроить мастер-ключ
          </button>
        </div>
      </div>
    )
  }

  if (!s.ready) {
    return (
      <div className="vt vt-gate" data-testid="vault-gate-wait">
        <div className="panel vt-gate-card">
          <span className="vt-gate-icon">
            <IconShield />
          </span>
          <h1 className="vt-gate-title">Сейф секретов закрыт</h1>
          <p className="vt-note">
            Разблокируйте сейф мастер-ключом (кнопка-замок в топбаре или Ctrl+Shift+L → ввод) —
            ключ записей появится только в памяти этой вкладки.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="vt" data-testid="screen-vault">
      <VaultNav
        view={view}
        setView={(next) => {
          setView(next)
          setSel(null)
          clearMarks()
        }}
        query={query}
        setQuery={setQuery}
        live={s.live}
        trashCount={s.trash.length}
      />

      <section className="vt-center" aria-label="Записи">
        <header className="vt-toolbar">
          <div className="vt-toolbar-text">
            <h1 className="vt-h1">
              {trashMode
                ? 'Корзина'
                : view.kind === 'fav'
                  ? 'Избранное'
                  : view.kind === 'health'
                    ? 'Здоровье паролей'
                    : view.kind === 'expiring'
                      ? 'Истекающие'
                      : 'Записи'}
            </h1>
            <p className="vt-sub label-mono">
              {view.kind === 'health' ? (
                <>аудит считается локально · наружу не уходит ничего</>
              ) : view.kind === 'expiring' ? (
                <>сроки записей · напоминания за 30, 7 и 1 день</>
              ) : (
                <>
                  показано <b className="num">{shown.length}</b> из{' '}
                  <b className="num">{pool.length}</b> · шифрование AES-GCM-256
                </>
              )}
            </p>
          </div>
          <span className="grow" />
          {trashMode ? (
            <button
              className="btn btn-danger btn-sm"
              disabled={s.trash.length === 0}
              onClick={s.purgeAll}
              data-testid="vault-purge-all"
            >
              Очистить корзину
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setGen(true)} data-testid="vault-open-gen">
                <IconSparkText />
                Генератор
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setIo(true)} data-testid="vault-open-io">
                <IconDatabase />
                Данные
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setNewType(view.kind === 'type' ? view.type : 'login')
                  setEditing('new')
                }}
                data-testid="vault-new"
              >
                <IconPlus />
                Новая запись
              </button>
            </>
          )}
          {view.kind !== 'health' && view.kind !== 'expiring' && (
            <button
              className={`btn btn-ghost btn-sm${selectMode ? ' on' : ''}`}
              aria-pressed={selectMode}
              onClick={() => {
                setSelectMode((m) => !m)
                if (selectMode) clearMarks()
              }}
              title="Мультивыделение: Ctrl/Cmd+клик добавляет запись, Shift+клик берёт диапазон"
              data-testid="vault-select-mode"
            >
              <IconCheck />
              {selectMode ? 'Выбор включён' : 'Выделение'}
            </button>
          )}
        </header>

        {view.kind !== 'health' && view.kind !== 'expiring' && (
          <BulkBar
            count={marked.length}
            totalInFilter={shown.length}
            noun={trashMode ? 'в корзине' : 'записей'}
            actions={bulkActions}
            form={bulkForm}
            runner={bulk}
            onSelectAll={() => setMarked(shownIds)}
            onClear={clearMarks}
            testid="vault-bulk"
          />
        )}

        <div className="vt-scroll">
          {view.kind === 'health' ? (
            <VaultHealth
              onOpen={(id) => {
                setView({ kind: 'all' })
                setSel(id)
              }}
            />
          ) : view.kind === 'expiring' ? (
            <VaultExpiring
              entries={s.live}
              now={now}
              onOpen={(id) => {
                setView({ kind: 'all' })
                setSel(id)
              }}
            />
          ) : (
            <VaultList
              entries={shown}
              selId={sel}
              onSelect={setSel}
              now={now}
              trashMode={trashMode}
              marked={markedSet}
              selectMode={selectMode}
              onMark={onMark}
            />
          )}
        </div>
      </section>

      <VaultDetail entry={selected} now={now} onEdit={() => setEditing('edit')} />

      {editing && (
        <VaultEditor
          entry={editing === 'edit' ? selected : null}
          initialType={newType}
          folderId={view.kind === 'folder' ? view.id : null}
          onClose={(savedId) => {
            setEditing(null)
            if (savedId) setSel(savedId)
          }}
        />
      )}
      {gen && <VaultGenerator onClose={() => setGen(false)} />}
      {io && <VaultIo onClose={() => setIo(false)} />}

      <ClipToast />
    </div>
  )
}

/** Тост буфера обмена с обратным отсчётом и кнопкой «Очистить сейчас». */
function ClipToast() {
  const s = useSecrets()
  const [left, setLeft] = useState(0)

  useEffect(() => {
    if (!s.clip) return
    const tick = () =>
      setLeft(s.clip?.until ? Math.max(0, Math.ceil((s.clip.until - Date.now()) / 1000)) : 0)
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [s.clip])

  if (!s.clip) return null

  return (
    <div className="vt-clip" role="status" aria-live="polite" data-testid="clip-toast">
      <span className="vt-clip-text">
        «{s.clip.label}» в буфере ·{' '}
        {s.clip.until === 0 ? (
          'автоочистка выключена'
        ) : (
          <>
            очистится через <b className="num">{left}</b> с
          </>
        )}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={s.clearClipboard} data-testid="clip-clear">
        Очистить сейчас
      </button>
    </div>
  )
}
