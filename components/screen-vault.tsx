'use client'

/* ============================================================
   ЭКРАН «МЕНЕДЖЕР СЕКРЕТОВ» · три колонки в стилистике «Графит»
   Навигация ← список ← деталь. Вся глубина внутри экрана: в сайдбаре
   у модуля ровно один пункт (правило роста из ТЗ §2.1).
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
/* AR-2: слой стилей менеджера секретов приезжает вместе с чанком экрана. */
import '@/app/styles/screen-vault.css'
import { IconDatabase, IconPlus, IconShield, IconSparkText } from './icons'
import { useVault, useNow } from '@/lib/vault-store'
import { useSecrets } from '@/lib/secrets-store'
import { filterEntries, isLive, parseQuery, type SecretType } from '@/lib/secrets'
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
  const now = useNow() || Date.now()

  /* Замок закрылся — выбор и модалки сбрасываются (п.10.4 + Panic Lock+). */
  useEffect(() => {
    setSel(null)
    setEditing(null)
    setGen(false)
    setIo(false)
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
        </header>

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
