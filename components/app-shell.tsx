'use client'

import dynamic from 'next/dynamic'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Dropdown } from './dropdown'
import { NotificationsBell } from './notifications'

import { NumTicker } from './ui/num-ticker'
import { StatusClock } from './ui/status-clock'
import { ScreenLock } from './screen-lock'
import { prefetchScreen } from './screens'
import { AppSplash } from './app-splash'
import { SidebarNav } from './sidebar-nav'
import { initScale, resetScale, stepScale } from '@/lib/ui-scale'
import { JournalAlert } from './journal-alert'
import { useEngineStore } from '@/lib/store/engine'
import { useVault } from '@/lib/vault-store'
import { useAccount } from '@/lib/account'
import { useIndexActions } from '@/lib/indexer/context'
import { fmtBytes } from '@/lib/data'
import { SCOPES } from '@/lib/search'
import { flushClientErrors } from '@/lib/telemetry-client'
import { trackAction, trackDrop, trackScreen } from '@/lib/telemetry'
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
  IconChevronLeft,
  IconChipAi,
  IconGear,
  IconLockRound,
  IconLogoMark,
  IconPlus,
  IconSearch,
  IconUser,
} from './icons'

/** Плейсхолдер поиска зависит от экрана — но поле всегда одно и то же. */
const PLACEHOLDER: Record<ScreenId, string> = {
  library: 'Поиск по смыслу: «договор аренды»',
  map: 'Найти узел или кластер на карте',
  chat: 'Поиск по истории разговоров',
  vault: 'Поиск по секретам: type: tag: favorite:',
  mail: 'Поиск по ящикам и адресам',
  settings: 'Поиск по настройкам',
  activity: 'Поиск по событиям сейфа',
  admin: 'Поиск по пользователям',
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
  const account = useAccount()
  /* NF-2: скорость движка — из его же ответа, а не из выдуманной метрики. */
  const engine = useEngineStore()
  const idxa = useIndexActions()
  const { stats, clusters } = v

  const [collapsed, setCollapsed] = useState(false)
  const [navAnimating, setNavAnimating] = useState(false)
  const navTimer = useRef<number>(0)
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

  /* Автоприём кода: переход по ссылке-приглашению «/?cloud=КОД» сразу
     подключает к общему облаку — код берём из URL или из sessionStorage
     (страница входа кладёт его туда перед редиректом на «/»). */
  useEffect(() => {
    let code: string | null = null
    try {
      code = new URL(window.location.href).searchParams.get('cloud')
      if (!code) code = sessionStorage.getItem('wsx-cloud-code')
    } catch {
      /* приватный режим — пропускаем */
    }
    if (!code) return
    const clean = code
    void (async () => {
      try {
        const r = await fetch('/ai-api/cloud/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: clean }),
        })
        const b = (await r.json().catch(() => ({}))) as { error?: string }
        if (r.ok) {
          v.flash('Вы подключены к общему облаку по ссылке')
          v.openSetting('cloud')
        } else {
          v.flash(b.error || 'Ссылка-приглашение недействительна')
        }
      } catch {
        v.flash('Не удалось подключиться по ссылке')
      } finally {
        try {
          sessionStorage.removeItem('wsx-cloud-code')
        } catch {
          /* игнорируем */
        }
        try {
          const u = new URL(window.location.href)
          u.searchParams.delete('cloud')
          window.history.replaceState({}, '', u.pathname + u.search)
        } catch {
          /* игнорируем */
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* NF-9: локальный счётчик экранов. Ни одного байта наружу без согласия —
     это просто число «сколько раз открыт экран» в localStorage. */
  useEffect(() => {
    trackScreen(v.screen)
  }, [v.screen])

  /* Чанки остальных экранов догружаются на простое браузера: наведение уже
     звало prefetchScreen, но клик по клавиатуре или из палитры прилетал
     «холодным» и на слабой машине ждал сеть. Первый кадр не задет — работа
     стоит в очереди idle. */
  useEffect(() => {
    const ids: ScreenId[] = ['library', 'map', 'chat', 'vault', 'mail', 'activity', 'settings']
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
    /* Пока анимируется ширина сайдбара (180 мс), гасим дорогие эффекты фона
       карты — размытый «космос» и backdrop-filter панелей перерисовывались
       на каждый кадр раскладки и давали рывки. Карте отдельно сообщаем
       событием: она полностью останавливает свой rAF-цикл на это время. */
    setNavAnimating(true)
    window.dispatchEvent(new CustomEvent('wf:nav-animating', { detail: true }))
    window.clearTimeout(navTimer.current)
    navTimer.current = window.setTimeout(() => {
      setNavAnimating(false)
      window.dispatchEvent(new CustomEvent('wf:nav-animating', { detail: false }))
    }, 260)
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
    mail: 0,
    settings: 0,
    activity: 0,
    admin: 0,
  }

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
            : v.screen === 'mail'
              ? 'Почта · SMTP/IMAP · пароли зашифрованы на сервере'
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
      trackAction('search.run')
      v.runHit(inlineHits[0])
    } else if (e.key === 'Enter' && v.query.trim().length > 1) {
      /* NF-9: «искал и не нашёл» — это обрыв сценария, его и считаем. */
      trackDrop('search.empty')
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
        className={`app${collapsed ? ' nav-collapsed' : ''}${navAnimating ? ' nav-animating' : ''}${v.lock.status === 'locked' ? ' lock-behind' : ''}`}
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

          <SidebarNav counts={workspaceCount} clusters={clusters} collapsed={collapsed} />

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

            <button
              className="profile-row"
              title="Выйти из учётной записи"
              onClick={() => void account.logout()}
              data-testid="profile-logout"
            >
              <span className="avatar">
                <IconUser />
              </span>
              <span className="pr-text">
                <span className="pr-name" data-testid="profile-name">
                  {account.user?.name ?? 'Профиль'}
                </span>
                <span className="pr-sub mono" data-testid="profile-login">
                  @{account.user?.login} · {account.isAdmin ? 'админ' : account.user?.plan?.name ?? 'выйти'}
                </span>
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
            {v.demo.active && (
              <button
                className="demo-pill"
                onClick={() => v.go('library')}
                title={`Демо-данные: ${v.demo.count} объектов. Убрать их можно баннером в библиотеке.`}
                data-testid="demo-pill"
              >
                ДЕМО<b className="num">{v.demo.count}</b>
              </button>
            )}
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
        <div className="flash-toast" role="status" aria-live="polite" data-testid="flash-toast">
          {v.toast}
        </div>
      )}
    </>
  )
}
