'use client'

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react'
import { Dropdown } from './dropdown'
import { NotificationsBell } from './notifications'
import { CommandPalette } from './command-palette'
import { NumTicker } from './ui/num-ticker'
import { ScreenLock } from './screen-lock'
import { useVault } from '@/lib/vault-store'
import { fmtBytes } from '@/lib/data'
import { SCOPES } from '@/lib/search'
import type { ScreenId } from '@/lib/vault-store'
import {
  IconChat,
  IconChevronDown,
  IconChevronLeft,
  IconChipAi,
  IconGear,
  IconGraph,
  IconKey,
  IconLibrary,
  IconLockRound,
  IconLogoMark,
  IconPlus,
  IconSearch,
  IconUser,
} from './icons'

type Ico = ComponentType<SVGProps<SVGSVGElement>>

const WORKSPACE: { id: ScreenId; label: string; Icon: Ico }[] = [
  { id: 'library', label: 'Библиотека', Icon: IconLibrary },
  { id: 'map', label: 'Карта памяти', Icon: IconGraph },
  { id: 'chat', label: 'Чат с ИИ', Icon: IconChat },
]

const SECRETS_NAV: { id: ScreenId; label: string; Icon: Ico }[] = [
  { id: 'vault', label: 'Менеджер секретов', Icon: IconKey },
]

const SYSTEM: { id: ScreenId; label: string; Icon: Ico }[] = [
  { id: 'settings', label: 'Настройки', Icon: IconGear },
]

/** Плейсхолдер поиска зависит от экрана — но поле всегда одно и то же. */
const PLACEHOLDER: Record<ScreenId, string> = {
  library: 'Поиск по смыслу: «договор аренды»',
  map: 'Найти узел или кластер на карте',
  chat: 'Поиск по истории разговоров',
  vault: 'Поиск по секретам: type: tag: favorite:',
  settings: 'Поиск по настройкам',
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/**
 * Канонический каркас: сайдбар 248px → топбар 56px → контент → статус-бар 28px.
 * Всё состояние живёт в едином сейфе (useVault), поэтому числа в навигации,
 * составе кластеров и хранилище — те же, что показывают экраны, а поиск в
 * шапке и палитра Ctrl+K делят одну строку запроса.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const v = useVault()
  const { stats, clusters } = v

  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /* Часы статус-бара: пустая строка до монтирования, чтобы сервер и клиент
     не спорили о текущей секунде при гидрации. */
  const [clock, setClock] = useState('')
  const searchWrap = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('ru-RU', { hour12: false }))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    try {
      if (localStorage.getItem('wf-nav') === 'c') setCollapsed(true)
    } catch {
      /* приватный режим — состояние просто не восстанавливаем */
    }
  }, [])

  // Клик мимо панели результатов закрывает её, не трогая сам запрос.
  useEffect(() => {
    if (!searchOpen) return
    function onDown(e: PointerEvent) {
      if (!searchWrap.current?.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [searchOpen])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('wf-nav', next ? 'c' : 'e')
      } catch {
        /* игнорируем */
      }
      return next
    })
  }

  /* --- замок: экран блокировки поверх всего. Хоткей Ctrl+Shift+L
         зарегистрирован в vault-store (дубль убран, п.10.10). --- */

  /* --- честные числа навигации --- */
  const workspaceCount: Record<ScreenId, number> = {
    library: stats.files,
    map: stats.links,
    chat: stats.sessions,
    vault: v.secretIndex.length,
    settings: 0,
  }

  const liveClusters = clusters.filter((c) => c.count > 0)
  /* Кластеры — часть Библиотеки: выпадающий список у пункта меню.
     Свёрнут по умолчанию, состояние живёт в сессии (не в localStorage). */
  const [libOpen, setLibOpen] = useState(false)

  /* --- честная строка статуса --- */
  const statusText =
    v.screen === 'library'
      ? stats.processing > 0
        ? `ИИ индексирует ${stats.processing} ${plural(stats.processing, 'файл', 'файла', 'файлов')}…`
        : `${stats.files} ${plural(stats.files, 'файл', 'файла', 'файлов')} · ${stats.links} связей`
      : v.screen === 'map'
        ? `${stats.nodes} ${plural(stats.nodes, 'узел', 'узла', 'узлов')} · ${stats.links} связей`
        : v.screen === 'chat'
          ? `${stats.model} · ${stats.offline ? 'офлайн' : 'облако'}`
          : v.screen === 'vault'
            ? v.lock.status === 'unlocked'
              ? `${v.secretIndex.length} ${plural(v.secretIndex.length, 'запись', 'записи', 'записей')} · AES-GCM`
              : 'Сейф секретов закрыт — нужен мастер-ключ'
            : v.dirty
              ? 'Есть несохранённые изменения'
              : `${stats.engine} · AES-256`

  const inlineHits = v.hits.slice(0, 7)

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setSearchOpen(false)
      return
    }
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && inlineHits[0]) {
      e.preventDefault()
      setSearchOpen(false)
      v.runHit(inlineHits[0])
    } else if (e.key === 'ArrowDown') {
      // с клавиатуры разворачиваем полноценную палитру
      e.preventDefault()
      setSearchOpen(false)
      v.setPalette(true)
    }
  }

  return (
    <>
      {v.lock.status === 'locked' && <ScreenLock />}
      <div className={`app${collapsed ? ' nav-collapsed' : ''}${v.lock.status === 'locked' ? ' lock-behind' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="logo-mark" aria-hidden="true">
              <IconLogoMark />
            </span>
            <span className="brand-words">
              <span className="logo-word">
                WORKFLO<b>W</b>
              </span>
              <span className="logo-sub">local ai vault</span>
            </span>
            <button
              className="sidebar-toggle"
              onClick={toggle}
              title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              aria-expanded={!collapsed}
            >
              <IconChevronLeft />
            </button>
          </div>

          {/* Приём файлов из любого экрана: файлы попадают в тот же сейф,
              поэтому счётчики, карта и хранилище обновляются сразу. */}
          <input
            ref={picker}
            type="file"
            multiple
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? [])
              if (list.length > 0) v.addFiles(list.map((f) => ({ name: f.name, size: f.size })))
              e.target.value = ''
            }}
          />
          <button
            className="btn btn-primary nav-add"
            title="Добавить файл"
            onClick={() => picker.current?.click()}
          >
            <IconPlus />
            <span>Добавить файл</span>
          </button>

          <nav className="nav" aria-label="Основная навигация">
            <div className="nav-section">Рабочее место</div>
            {WORKSPACE.map(({ id, label, Icon }) =>
              id === 'library' ? (
                <div className="nav-lib-row" key={id}>
                  <button
                    className={`nav-item${v.screen === id ? ' active' : ''}`}
                    onClick={() => v.go(id)}
                    aria-current={v.screen === id ? 'page' : undefined}
                    title={label}
                    data-testid="nav-library"
                  >
                    <Icon />
                    <span>{label}</span>
                    <b className="nav-count num">{workspaceCount[id]}</b>
                  </button>
                  <button
                    className={`nav-lib-chev${libOpen ? ' open' : ''}`}
                    onClick={() => setLibOpen((o) => !o)}
                    aria-expanded={libOpen}
                    title={libOpen ? 'Свернуть кластеры' : 'Показать кластеры библиотеки'}
                    aria-label="Кластеры библиотеки"
                    data-testid="nav-library-toggle"
                  >
                    <IconChevronDown />
                  </button>
                </div>
              ) : (
                <button
                  key={id}
                  className={`nav-item${v.screen === id ? ' active' : ''}`}
                  onClick={() => v.go(id)}
                  aria-current={v.screen === id ? 'page' : undefined}
                  title={label}
                >
                  <Icon />
                  <span>{label}</span>
                  <b className="nav-count num">{workspaceCount[id]}</b>
                </button>
              ),
            )}
            {libOpen &&
              liveClusters.map((c) => (
                <button
                  key={c.id}
                  className="nav-item nav-sub"
                  onClick={() => v.openCluster(c.id)}
                  title={`${c.label} · ${c.count} ${plural(c.count, 'файл', 'файла', 'файлов')}`}
                  data-testid={`nav-cluster-${c.id}`}
                >
                  <i className="cluster-dot" style={{ background: `rgba(${c.rgb},.9)` }} />
                  <span>{c.label}</span>
                  <b className="nav-count num">{c.count}</b>
                </button>
              ))}

            <div className="nav-section">Секреты</div>
            {SECRETS_NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`nav-item${v.screen === id ? ' active' : ''}`}
                onClick={() => v.go(id)}
                aria-current={v.screen === id ? 'page' : undefined}
                title={label}
                data-testid="nav-vault"
              >
                <Icon />
                <span>{label}</span>
                <b className="nav-count num">{workspaceCount[id]}</b>
              </button>
            ))}

            <div className="nav-section">Система</div>
            {SYSTEM.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`nav-item${v.screen === id ? ' active' : ''}`}
                onClick={() => v.go(id)}
                aria-current={v.screen === id ? 'page' : undefined}
                title={label}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <button
              className="engine-pill"
              onClick={() => v.openSetting('engine')}
              title={`Движок ИИ: ${stats.engine}`}
            >
              <IconChipAi />
              <span className="ep-text">
                <span className="ep-name">{stats.engine}</span>
                <span className="ep-sub num">
                  {stats.model} · {stats.tokensPerSec} ток/с
                </span>
              </span>
              <i className={`net-dot${stats.offline ? '' : ' warn'}`} />
            </button>

            <div className="sidebar-storage">
              <div className="storage-head">
                <span className="label-mono">Хранилище</span>
                <span className="num label-mono">
                  <NumTicker value={stats.usedPct} />%
                </span>
              </div>
              <div className={`storage-bar${stats.processing > 0 ? ' busy' : ''}`}>
                <i style={{ width: `${stats.usedPct}%` }} />
              </div>
              <div className="storage-meta num">
                {fmtBytes(stats.bytes)} из {fmtBytes(stats.quota)} · {stats.files}{' '}
                {plural(stats.files, 'файл', 'файла', 'файлов')}
              </div>
            </div>

            <button className="profile-row" title="Локальный профиль">
              <span className="avatar">
                <IconUser />
              </span>
              <span className="pr-text">
                <span className="pr-name">Локальный профиль</span>
                <span className="pr-sub mono">сейф · AES-256</span>
              </span>
            </button>
          </div>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <div className="search-wrap" ref={searchWrap}>
              <div className={`search-pill${searchOpen && v.query.trim() ? ' open' : ''}`}>
                <IconSearch width={15} height={15} stroke="currentColor" strokeWidth={1.5} />
                <input
                  type="text"
                  placeholder={PLACEHOLDER[v.screen]}
                  aria-label="Поиск по сейфу"
                  value={v.query}
                  onChange={(e) => v.setQuery(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={onSearchKey}
                />
                <button
                  className="kbd-btn"
                  onClick={() => v.setPalette(true)}
                  title="Открыть палитру поиска"
                  aria-label="Открыть палитру поиска"
                >
                  <kbd>Ctrl K</kbd>
                </button>
              </div>

              {searchOpen && v.query.trim() !== '' && (
                <div className="search-panel" role="listbox" aria-label="Быстрые результаты">
                  {inlineHits.length === 0 ? (
                    <p className="search-empty">Ничего не найдено</p>
                  ) : (
                    <>
                      {inlineHits.map((h) => (
                        <button
                          key={h.key}
                          role="option"
                          aria-selected={false}
                          className={`search-row${h.kind === 'file' && h.locked ? ' is-locked' : ''}`}
                          onClick={() => {
                            setSearchOpen(false)
                            v.runHit(h)
                          }}
                        >
                          <span className="search-row-title ellipsis">{h.title}</span>
                          <span className="search-row-sub ellipsis">
                            {h.kind === 'file' && h.locked ? 'Под ключом' : h.sub}
                          </span>
                          {h.fuzzy && <span className="search-row-badge">по смыслу</span>}
                        </button>
                      ))}
                      {v.hits.length > inlineHits.length && (
                        <button
                          className="search-more label-mono"
                          onClick={() => {
                            setSearchOpen(false)
                            v.setPalette(true)
                          }}
                        >
                          Ещё {v.hits.length - inlineHits.length} — открыть палитру
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <Dropdown
              label="Область поиска"
              variant="chip"
              value={v.scope}
              options={SCOPES.map((s) => ({
                value: s.value,
                label: s.label,
                note: s.note,
                meta: s.value === 'all' ? String(stats.files) : undefined,
              }))}
              onChange={(val) => v.setScope(val as typeof v.scope)}
              menuWidth={288}
            />
            <span className="grow" />
            <span className="status-chip">
              <i className={`net-dot${stats.offline ? '' : ' warn'}`} />
              <span>{statusText}</span>
            </span>
            <NotificationsBell />
            {v.lock.status !== 'off' && (
              <button
                className="icon-btn"
                title="Заблокировать сейф (Ctrl+Shift+L)"
                aria-label="Заблокировать сейф"
                onClick={v.lockNow}
              >
                <IconLockRound />
              </button>
            )}
            <button
              className="icon-btn"
              title="Настройки"
              aria-label="Настройки"
              onClick={() => v.go('settings')}
            >
              <IconGear />
            </button>
          </header>
          {children}
        </div>
      </div>

      <footer className="statusbar">
        <span>SESSION 7F3A</span>
        <span className="sb-sep">·</span>
        <span className="sb-clock num">{clock}</span>
        <span className="sb-sep">·</span>
        <span>AES-256</span>
        <span className="sb-sep">·</span>
        <span className="sb-ok">{stats.offline ? 'ЛОКАЛЬНЫЙ РЕЖИМ' : 'ГИБРИДНЫЙ РЕЖИМ'}</span>
        <span className="grow" />
        <span className="sb-net">
          <i className={`net-dot${stats.offline ? '' : ' warn'}`} />
          {stats.offline ? 'ONLINE · 0 УТЕЧЕК' : 'ВНИМАНИЕ · ЕСТЬ ИСХОДЯЩИЕ'}
        </span>
      </footer>

      <CommandPalette />

      {v.toast && (
        <div className="flash-toast" role="status" aria-live="polite">
          {v.toast}
        </div>
      )}
    </>
  )
}
