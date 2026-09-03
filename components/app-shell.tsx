'use client'

import dynamic from 'next/dynamic'

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react'
import { Dropdown } from './dropdown'
import { NotificationsBell } from './notifications'

import { NumTicker } from './ui/num-ticker'
import { StatusClock } from './ui/status-clock'
import { ScreenLock } from './screen-lock'
import { prefetchScreen } from './screens'
import { AppSplash } from './app-splash'
import { initScale, resetScale, stepScale } from '@/lib/ui-scale'
import { JournalAlert } from './journal-alert'
import { useEngineStore } from '@/lib/store/engine'
import { useVault } from '@/lib/vault-store'
import { useIndexActions } from '@/lib/indexer/context'
import { fmtBytes } from '@/lib/data'
import { SCOPES } from '@/lib/search'
import { flushClientErrors } from '@/lib/telemetry-client'
import { useFlags } from '@/lib/flags'
import { blockedCount, installNetGuard, subscribeNet } from '@/lib/net'
import { DB_VERSION } from '@/lib/db/schema'
import { APP_BUILD } from '@/lib/backup/registry'
import type { ScreenId } from '@/lib/vault-store'

/* AR-2: командная палитра (Ctrl+K) — отдельный чанк, ssr не нужен. */
const CommandPalette = dynamic(
  () => import('./command-palette').then((m) => ({ default: m.CommandPalette })),
  { ssr: false },
)

/** «1 запрет», «2 запрета», «5 запретов» — счётчик обязан звучать по-русски. */
function blockedWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'ЗАПРЕТ'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'ЗАПРЕТА'
  return 'ЗАПРЕТОВ'
}
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
  IconPipeline,
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
  { id: 'activity', label: 'Центр активности', Icon: IconPipeline },
  { id: 'settings', label: 'Настройки', Icon: IconGear },
]

/** Плейсхолдер поиска зависит от экрана — но поле всегда одно и то же. */
const PLACEHOLDER: Record<ScreenId, string> = {
  library: 'Поиск по смыслу: «договор аренды»',
  map: 'Найти узел или кластер на карте',
  chat: 'Поиск по истории разговоров',
  vault: 'Поиск по секретам: type: tag: favorite:',
  settings: 'Поиск по настройкам',
  activity: 'Поиск по событиям сейфа',
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
  /* NF-2: скорость движка — из его же ответа, а не из выдуманной метрики. */
  const engine = useEngineStore()
  const idxa = useIndexActions()
  const { stats, clusters } = v

  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /* NF-8: обёртка над сетью ставится до первого эффекта — иначе запрет
     опоздает на промис и запрос успеет уйти. */
  useState(() => {
    installNetGuard()
    return true
  })
  const flags = useFlags()
  const blocked = useSyncExternalStore(subscribeNet, blockedCount, () => 0)
  /* AR-1: часы статус-бара живут в своём компоненте (StatusClock) и тикают
     из ClockContext — каркас больше не перерисовывается раз в секунду. */
  const searchWrap = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  /**
   * Отметка «каркас ожил». До гидратации кнопки навигации уже нарисованы
   * сервером, но обработчиков на них нет — клик в эту щель пропадает молча.
   * Атрибут даёт честный признак готовности: его ждут e2e-сценарии, а живой
   * человек видит по нему же курсор-ожидание.
   */
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  /* Масштаб интерфейса: значение уже применено bootstrap-скриптом, здесь
     поднимаем его в модуль и вешаем горячие клавиши Ctrl +/− и Ctrl 0. */
  useEffect(() => {
    initScale()
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === '+' || e.key === '=' || e.code === 'Equal') {
        e.preventDefault()
        stepScale(1)
      } else if (e.key === '-' || e.key === '_' || e.code === 'Minus') {
        e.preventDefault()
        stepScale(-1)
      } else if (e.key === '0') {
        e.preventDefault()
        resetScale()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    try {
      if (localStorage.getItem('wf-nav') === 'c') setCollapsed(true)
    } catch {
      /* приватный режим — состояние просто не восстанавливаем */
    }
  }, [])

  /* Клиентские ошибки, не ушедшие в прошлый раз, догоняют трекер (§3.6). */
  useEffect(() => {
    void flushClientErrors()
  }, [])

  /* Чанки остальных экранов догружаются на простое браузера: наведение уже
     звало prefetchScreen, но клик по клавиатуре или из палитры прилетал
     «холодным» и на слабой машине ждал сеть. Первый кадр не задет — работа
     стоит в очереди idle. */
  useEffect(() => {
    const ids: ScreenId[] = ['library', 'map', 'chat', 'vault', 'activity', 'settings']
    const warm = () => ids.forEach(prefetchScreen)
    const ric = window.requestIdleCallback
    if (typeof ric === 'function') {
      const id = ric(warm, { timeout: 4000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(warm, 2500)
    return () => window.clearTimeout(t)
  }, [])

  /* NF-7: расписание бэкапа. Планировщика в браузере нет, поэтому
     просрочку проверяем при открытии приложения — один раз за сессию и
     только при открытом сейфе: пароль снимка лежит под мастер-ключом. */
  const dueChecked = useRef(false)
  useEffect(() => {
    if (v.lock.status === 'locked' || !v.hydrated || dueChecked.current) return
    dueChecked.current = true
    void import('@/lib/backup').then(({ runDueBackup, liveOf }) =>
      runDueBackup(Date.now(), liveOf(v)).then((r) => {
        if (r.ran) {
          v.flash(
            `Снимок сейфа по расписанию создан: ${r.meta.modules.length} модулей, ротация держит последние копии.`,
          )
        }
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.lock.status, v.hydrated])

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
    activity: 0,
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
          ? `${v.engineView.model} · ${
              v.engineView.isCloud
                ? v.engineView.label
                : v.engineView.ready
                  ? 'на устройстве'
                  : 'движок не подключён'
            }`
          : v.screen === 'vault'
            ? v.lock.status === 'unlocked'
              ? `${v.secretIndex.length} ${plural(v.secretIndex.length, 'запись', 'записи', 'записей')} · AES-GCM`
              : 'Сейф секретов закрыт — нужен мастер-ключ'
            : v.screen === 'activity'
              ? `Лента событий · ${v.unread} ${plural(v.unread, 'новое', 'новых', 'новых')}`
            : v.dirty
              ? 'Есть несохранённые изменения'
              : `${v.engineView.label} · AES-256`

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
      <AppSplash done={ready && v.hydrated} />
      {v.lock.status === 'locked' && <ScreenLock />}
      <div
        className={`app${collapsed ? ' nav-collapsed' : ''}${v.lock.status === 'locked' ? ' lock-behind' : ''}`}
        data-testid="app-shell"
        data-app-ready={ready ? '1' : '0'}
      >
        <aside className="sidebar">
          <div className="brand">
            <span className="logo-mark" aria-hidden="true">
              <IconLogoMark />
            </span>
            <span className="brand-words">
              <span className="logo-word">
                WORKSPACE<b>X</b>
              </span>
              <span className="logo-sub">local ai workspace</span>
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
            data-testid="file-picker"
            multiple
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? [])
              /* NF-1: файлы читаются по-настоящему — метаданными не отделаться. */
              if (list.length > 0) void idxa.indexFiles(list)
              e.target.value = ''
            }}
          />
          <button
            className="btn btn-primary nav-add"
            title="Добавить файл"
            data-testid="file-add-btn"
            onClick={() => picker.current?.click()}
          >
            <IconPlus />
            <span>Добавить файл</span>
          </button>

          <nav className="nav" aria-label="Основная навигация">
            <div className="nav-section">Рабочее место</div>
            {WORKSPACE.map(({ id, label, Icon }) =>
              id === 'library' ? (
                <Fragment key={id}>
                  <div className="nav-lib-row">
                    <button
                      className={`nav-item${v.screen === id ? ' active' : ''}`}
                      onClick={() => v.go(id)}
                      onPointerEnter={() => prefetchScreen(id)}
                      onFocus={() => prefetchScreen(id)}
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
                  {libOpen &&
                    liveClusters.map((c) => (
                      <button
                        key={c.id}
                        className="nav-item nav-sub"
                        onClick={() => v.openCluster(c.id)}
                        onPointerEnter={() => prefetchScreen('library')}
                        title={`${c.label} · ${c.count} ${plural(c.count, 'файл', 'файла', 'файлов')}`}
                        data-testid={`nav-cluster-${c.id}`}
                      >
                        <i className="cluster-dot" style={{ background: `rgba(${c.rgb},.9)` }} />
                        <span>{c.label}</span>
                        <b className="nav-count num">{c.count}</b>
                      </button>
                    ))}
                </Fragment>
              ) : (
                <button
                  key={id}
                  className={`nav-item${v.screen === id ? ' active' : ''}`}
                  onClick={() => v.go(id)}
                  onPointerEnter={() => prefetchScreen(id)}
                  onFocus={() => prefetchScreen(id)}
                  aria-current={v.screen === id ? 'page' : undefined}
                  title={label}
                  data-testid={`nav-${id}`}
                >
                  <Icon />
                  <span>{label}</span>
                  <b className="nav-count num">{workspaceCount[id]}</b>
                </button>
              ),
            )}

            <div className="nav-section">Секреты</div>
            {SECRETS_NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`nav-item${v.screen === id ? ' active' : ''}`}
                onClick={() => v.go(id)}
                onPointerEnter={() => prefetchScreen(id)}
                onFocus={() => prefetchScreen(id)}
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
                onPointerEnter={() => prefetchScreen(id)}
                onFocus={() => prefetchScreen(id)}
                aria-current={v.screen === id ? 'page' : undefined}
                title={label}
                data-testid={`nav-${id}`}
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
              title={`Движок ИИ: ${v.engineView.label} · ${v.engineView.model}`}
              data-testid="engine-pill"
            >
              <IconChipAi />
              <span className="ep-text">
                <span className="ep-name">{v.engineView.label}</span>
                <span className="ep-sub num">
                  {v.engineView.model} ·{' '}
                  {/* NF-2: скорость — только настоящая, из последнего ответа движка. */}
                  {engine.metrics.tokensPerSec !== null
                    ? `${engine.metrics.tokensPerSec} ток/с`
                    : v.engineView.isCloud
                      ? 'внешняя модель'
                      : v.engineView.ready
                        ? 'на устройстве'
                        : 'не подключён'}
                </span>
              </span>
              <i className={`net-dot${v.engineView.isCloud ? ' warn' : ''}`} />
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
        <StatusClock />
        <span className="sb-sep">·</span>
        <span>AES-256</span>
        <span className="sb-sep">·</span>
        <span className="sb-ok" data-testid="status-mode">
          {v.engineView.statusLabel}
        </span>
        <span className="grow" />
        <JournalAlert />
        {flags.flags.dev && (
          <span className="sb-dev mono" data-testid="status-dev">
            сборка {APP_BUILD} · схема v{DB_VERSION} · запретов {blocked}
          </span>
        )}
        {flags.offline ? (
          <span className="sb-net sb-offline" data-testid="status-offline">
            <i className="net-dot" />
            АВТОНОМНЫЙ РЕЖИМ · {blocked} {blockedWord(blocked)}
          </span>
        ) : (
          <span className="sb-net" data-testid="status-net">
            <i className={`net-dot${v.engineView.isCloud ? ' warn' : ''}`} />
            {v.engineView.netLabel}
          </span>
        )}
      </footer>

      {/* Палитра приезжает своим чанком и только когда её открыли:
          в первом бандле каркаса её реестр команд больше не лежит. */}
      {v.palette && <CommandPalette />}

      {v.toast && (
        <div className="flash-toast" role="status" aria-live="polite">
          {v.toast}
        </div>
      )}
    </>
  )
}
