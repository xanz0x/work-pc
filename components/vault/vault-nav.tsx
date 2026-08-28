'use client'

/* ============================================================
   ЛЕВАЯ КОЛОНКА · поиск, избранное, типы записей, папки, корзина
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { IconPlus, IconSearch, IconShield, IconTrash } from '@/components/icons'
import { iconOf } from '@/components/icons'
import { useSecrets } from '@/lib/secrets-store'
import { TYPE_META, TYPE_ORDER, type SecretRecord, type SecretType } from '@/lib/secrets'

export type VaultView =
  | { kind: 'all' }
  | { kind: 'fav' }
  | { kind: 'health' }
  | { kind: 'trash' }
  | { kind: 'type'; type: SecretType }
  | { kind: 'folder'; id: string }

export function VaultNav({
  view,
  setView,
  query,
  setQuery,
  live,
  trashCount,
}: {
  view: VaultView
  setView: (v: VaultView) => void
  query: string
  setQuery: (q: string) => void
  live: SecretRecord[]
  trashCount: number
}) {
  const s = useSecrets()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  /* Удаление папки — в два клика: корзина → явная красная «Удалить?» (5 с). */
  const [delAsk, setDelAsk] = useState<string | null>(null)
  const askTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (askTimer.current) clearTimeout(askTimer.current)
    },
    [],
  )
  function askDelete(id: string) {
    if (delAsk === id) {
      s.removeFolder(id)
      setDelAsk(null)
      if (view.kind === 'folder' && view.id === id) setView({ kind: 'all' })
      return
    }
    setDelAsk(id)
    if (askTimer.current) clearTimeout(askTimer.current)
    askTimer.current = setTimeout(() => setDelAsk(null), 5000)
  }

  const countType = (t: SecretType) => live.filter((e) => e.type === t).length
  const favCount = live.filter((e) => e.favorite).length

  const isOn = (v: VaultView) =>
    v.kind === view.kind &&
    (v.kind !== 'type' || (view.kind === 'type' && v.type === view.type)) &&
    (v.kind !== 'folder' || (view.kind === 'folder' && v.id === view.id))

  return (
    <aside className="vt-nav" aria-label="Разделы сейфа секретов">
      <div className="vt-search">
        <IconSearch width={14} height={14} stroke="currentColor" strokeWidth={1.5} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск · type: tag: favorite:"
          aria-label="Поиск по секретам"
          autoComplete="off"
          data-testid="vault-search"
        />
      </div>

      <button
        className={`vt-nav-item${isOn({ kind: 'fav' }) ? ' active' : ''}`}
        onClick={() => setView({ kind: 'fav' })}
        data-testid="vault-view-fav"
      >
        <span className="vt-star">★</span>
        <span>Избранное</span>
        <b className="nav-count num">{favCount}</b>
      </button>
      <button
        className={`vt-nav-item${isOn({ kind: 'all' }) ? ' active' : ''}`}
        onClick={() => setView({ kind: 'all' })}
        data-testid="vault-view-all"
      >
        <span className="vt-dot" />
        <span>Все записи</span>
        <b className="nav-count num">{live.length}</b>
      </button>
      <button
        className={`vt-nav-item${isOn({ kind: 'health' }) ? ' active' : ''}`}
        onClick={() => setView({ kind: 'health' })}
        title="Аудит слабых, повторных и старых паролей — локально"
        data-testid="vault-view-health"
      >
        <IconShield />
        <span>Здоровье паролей</span>
      </button>

      <div className="vt-nav-head label-mono">Типы</div>
      {TYPE_ORDER.filter((t) => countType(t) > 0 || t === 'login' || t === 'seed' || t === 'api').map(
        (t) => {
          const Icon = iconOf(TYPE_META[t].icon)
          return (
            <button
              key={t}
              className={`vt-nav-item${isOn({ kind: 'type', type: t }) ? ' active' : ''}`}
              onClick={() => setView({ kind: 'type', type: t })}
              title={TYPE_META[t].note}
              data-testid={`vault-view-type-${t}`}
            >
              <Icon />
              <span>{TYPE_META[t].label}</span>
              <b className="nav-count num">{countType(t)}</b>
            </button>
          )
        },
      )}

      <div className="vt-nav-head label-mono">
        Папки
        <button
          className="vt-icon-btn tiny"
          onClick={() => setAdding((x) => !x)}
          title="Новая папка"
          aria-label="Новая папка"
          data-testid="vault-folder-add"
        >
          <IconPlus />
        </button>
      </div>
      {adding && (
        <form
          className="vt-folder-form"
          onSubmit={(e) => {
            e.preventDefault()
            s.addFolder(name)
            setName('')
            setAdding(false)
          }}
        >
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Crypto"
            aria-label="Название папки"
            data-testid="vault-folder-name"
          />
        </form>
      )}
      {s.folders.map((f) => (
        <div className="vt-folder-row" key={f.id}>
          <button
            className={`vt-nav-item${isOn({ kind: 'folder', id: f.id }) ? ' active' : ''}`}
            onClick={() => setView({ kind: 'folder', id: f.id })}
            data-testid={`vault-view-folder-${f.id}`}
          >
            <i className="cluster-dot" style={{ background: `rgba(${f.rgb},.9)` }} />
            <span>{f.name}</span>
            <b className="nav-count num">{live.filter((e) => e.folderId === f.id).length}</b>
          </button>
          {delAsk === f.id ? (
            <button
              className="vt-folder-del-ask"
              title="Подтвердить удаление папки (записи останутся без папки)"
              aria-label={`Подтвердить удаление папки ${f.name}`}
              onClick={() => askDelete(f.id)}
              data-testid={`vault-folder-del-${f.id}`}
            >
              Удалить?
            </button>
          ) : (
            <button
              className="vt-icon-btn tiny vt-folder-del"
              title={`Удалить папку «${f.name}»`}
              aria-label={`Удалить папку ${f.name}`}
              onClick={() => askDelete(f.id)}
              data-testid={`vault-folder-del-${f.id}`}
            >
              <IconTrash />
            </button>
          )}
        </div>
      ))}

      <span className="grow" />
      <button
        className={`vt-nav-item${isOn({ kind: 'trash' }) ? ' active' : ''}`}
        onClick={() => setView({ kind: 'trash' })}
        data-testid="vault-view-trash"
      >
        <IconTrash />
        <span>Корзина</span>
        <b className="nav-count num">{trashCount}</b>
      </button>
    </aside>
  )
}
