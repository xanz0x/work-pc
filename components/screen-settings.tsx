'use client'

/* AR-2: слой стилей настроек приезжает вместе с чанком экрана. */
import '@/app/styles/screen-settings.css'
import '@/app/styles/settings-refinement.css'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type SVGProps,
} from 'react'
import {
  IconArrowRight,
  IconBell,
  IconChipAi,
  IconDatabase,
  IconFolder,
  IconInbox,
  IconKey,
  IconLayers,
  IconMemory,
  IconPipeline,
  IconRefresh,
  IconScale,
  IconShield,
  IconSparkText,
  IconTag,
  IconTerminal,
  IconTrash,
  IconWifi,
} from './icons'
import {
  useDataStore,
  useMutations,
  useNavStore,
  useNotifsStore,
  useSettingsStore,
  useToast,
  type ToggleId,
} from '@/lib/vault-store'
import { useIndexActions, useIndexSummary } from '@/lib/indexer/context'
import { NO_DATA, fmtBytes } from '@/lib/data'
import { AiProviderSection } from './ai-provider-section'
import { useEngineStore } from '@/lib/store/engine'
import { SecuritySection } from './security-section'
import { SecretsSection } from './secrets-section'
import { BackupSection } from './backup-section'
import { FlagsSection } from './flags-section'
import { McpSection } from './mcp-section'
import { useAccount } from '@/lib/account'
import type { FeatureId } from '@/lib/users'
import { SyncSection } from './sync-section'
import { CloudSection } from './cloud-section'
import { JournalPanel } from './journal-panel'
import { UiScaleSection } from './ui-scale-section'
import { getScale, subscribeScale, SCALE_DEFAULT } from '@/lib/ui-scale'
import {
  buildPayload,
  clearTelemetry,
  sendTelemetry,
  subscribeTelemetry,
  telemetrySnapshot,
  totalEvents,
} from '@/lib/telemetry'

type Ico = ComponentType<SVGProps<SVGSVGElement>>

const PIPELINE_TOGGLES: { id: ToggleId; title: string; note: string }[] = [
  {
    id: 'ocr',
    title: 'Распознавать текст в изображениях и PDF',
    note: 'Распознавание сканов пока недоступно. Читаются файлы с текстовым слоем.',
  },
  {
    id: 'autotag',
    title: 'Автоматические теги и описания',
    note: 'Модель предлагает категорию, вы можете её переопределить',
  },
  {
    id: 'watch',
    title: 'Следить за папками в фоне',
    note: 'Новые файлы попадают в конвейер сразу после появления',
  },
]

const NOTIFY_TOGGLES: { id: ToggleId; title: string; note: string }[] = [
  {
    id: 'ntfPipeline',
    title: 'События конвейера',
    note: 'Индексация завершена, файлы ждут автотегов, папка пополнилась',
  },
  {
    id: 'ntfPrivacy',
    title: 'Риски приватности',
    note: 'Найдены паспортные данные, счета или ключи — приходит всегда с пометкой',
  },
  {
    id: 'ntfDigest',
    title: 'Ежедневная сводка',
    note: 'Одно уведомление вместо потока событий конвейера — они склеиваются в одну запись',
  },
]

const PRIVACY_TOGGLES: { id: ToggleId; title: string; note: string }[] = [
  {
    id: 'redact',
    title: 'Скрывать чувствительные фрагменты в превью',
    note: 'Паспортные данные, счета и ключи заменяются плашкой',
  },
  {
    id: 'sendIndex',
    title: 'Отправлять индекс сейфа во внешнюю модель',
    note: 'Имена, категории и теги файлов. Выключено — наружу уходят только закреплённые файлы',
  },
  {
    id: 'telemetry',
    title: 'Отправлять анонимную статистику',
    note: 'Отправка анонимной статистики выключена по умолчанию',
  },
]

/** Раздел привязан к функции: если админ её выключил — раздела нет ни в рельсе, ни на странице. */
const SECTION_FEATURE: Record<string, FeatureId> = {
  engine: 'ai',
  secrets: 'secrets',
  backup: 'offline',
  flags: 'offline',
  mcp: 'mcp',
  sync: 'sync',
  cloud: 'cloud',
}

const ALL_SECTIONS: { id: string; label: string; Icon: Ico }[] = [
  { id: 'engine', label: 'Движок ИИ', Icon: IconChipAi },
  { id: 'ui', label: 'Интерфейс', Icon: IconScale },
  { id: 'pipeline', label: 'Конвейер', Icon: IconPipeline },
  { id: 'notify', label: 'Уведомления', Icon: IconBell },
  { id: 'storage', label: 'Хранилище', Icon: IconDatabase },
  { id: 'privacy', label: 'Приватность', Icon: IconShield },
  { id: 'security', label: 'Безопасность', Icon: IconKey },
  { id: 'secrets', label: 'Менеджер секретов', Icon: IconKey },
  { id: 'backup', label: 'Бэкап сейфа', Icon: IconDatabase },
  { id: 'flags', label: 'Автономный режим', Icon: IconWifi },
  { id: 'mcp', label: 'MCP наружу', Icon: IconTerminal },
  { id: 'sync', label: 'Синхронизация', Icon: IconDatabase },
  { id: 'cloud', label: 'Общее облако', Icon: IconDatabase },
  { id: 'journal', label: 'Журнал безопасности', Icon: IconLayers },
  { id: 'danger', label: 'Опасная зона', Icon: IconTrash },
]

const SECTION_GROUPS = [
  { id: 'workspace', label: 'Рабочее пространство', ids: ['engine', 'ui', 'pipeline', 'notify', 'storage'] },
  { id: 'protection', label: 'Защита и доступ', ids: ['privacy', 'security', 'secrets'] },
  { id: 'connections', label: 'Данные и подключения', ids: ['backup', 'flags', 'mcp', 'sync', 'cloud', 'journal'] },
  { id: 'danger', label: '', ids: ['danger'] },
]

const ENGINE_NOTES = {
  local: 'Ответы через локальную модель. Требуется запущенный движок.',
  hybrid: 'Локальный индекс и ответы внешней модели.',
  cloud: 'Запрос и выбранный контекст передаются внешней модели.',
}

function scrollToSection(root: HTMLDivElement | null, id: string) {
  const el = document.getElementById(`set-${id}`)
  if (!root || !el) return
  // DOMRect измеряется после CSS zoom, scrollTop — до него.
  const bounds = root.getBoundingClientRect()
  const zoom = bounds.width / root.offsetWidth
  root.scrollTo({
    top: root.scrollTop + (el.getBoundingClientRect().top - bounds.top) / zoom - (root.clientHeight < 180 ? 8 : 16),
    behavior: 'instant',
  })
}

/** Записи поиска зовут разделы своими именами — переводим их в id секций. */
const FOCUS_ALIAS: Record<string, string> = {
  engine: 'engine',
  ui: 'ui',
  scale: 'ui',
  interface: 'ui',
  index: 'pipeline',
  pipeline: 'pipeline',
  notifs: 'notify',
  notify: 'notify',
  storage: 'storage',
  privacy: 'privacy',
  security: 'security',
  journal: 'journal',
  secrets: 'secrets',
  backup: 'backup',
  flags: 'flags',
  offline: 'flags',
  mcp: 'mcp',
  agents: 'mcp',
  sync: 'sync',
  devices: 'sync',
  cloud: 'cloud',
  danger: 'danger',
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/**
 * Экран настроек поверх единого сейфа.
 * Здесь нет собственных чисел: состав хранилища, шаги конвейера и подписи
 * движка читаются из store, а переключатели правят черновик конфигурации.
 * Пока черновик отличается от сохранённого, подвал держит кнопки активными,
 * и статус-бар каркаса говорит о несохранённых изменениях тем же словом.
 */

/* ============================================================
   NF-9 · «ЧТО БУДЕТ ОТПРАВЛЕНО»
   Согласие имеет смысл, только если человек видел ровно тот объект,
   который уйдёт. Поэтому на экране показан не пересказ, а сам payload —
   тот же, что уходит на сервер. Выключение согласия стирает накопленное
   сразу, а не «при следующем запуске».
   ============================================================ */
function TelemetryPanel() {
  const S = useSettingsStore()
  const { flash } = useToast()
  const consent = S.settings.toggles.telemetry
  const state = useSyncExternalStore(subscribeTelemetry, telemetrySnapshot, telemetrySnapshot)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const total = totalEvents(state)
  const payload = useMemo(() => buildPayload(state, Date.now()), [state])

  const was = useRef(consent)
  useEffect(() => {
    if (was.current && !consent) {
      clearTelemetry()
      setResult(null)
      flash('Согласие отозвано: накопленная статистика стёрта.')
    }
    was.current = consent
  }, [consent, flash])

  return (
    <div className="field-block" data-testid="telemetry-panel">
      <div className="mask-head">
        <span className="label-mono">Что будет отправлено</span>
        <span className="label-mono tm-total" data-testid="telemetry-total">
          {total} {plural(total, 'событие', 'события', 'событий')}
        </span>
      </div>
      <div className="setting-note tm-note">
        Счётчики экранов, действий и прерванных сценариев — без имён файлов, текста запросов
        и идентификатора устройства. Отправка вручную, после согласия.
      </div>

      <div className="tm-counts">
        <span>
          экраны <b className="num">{payload.totals.screens}</b>
        </span>
        <span>
          действия <b className="num">{payload.totals.actions}</b>
        </span>
        <span>
          обрывы <b className="num">{payload.totals.drops}</b>
        </span>
      </div>

      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setShown((v) => !v)}
        aria-expanded={shown}
        data-testid="telemetry-payload-toggle"
      >
        {shown ? 'Скрыть данные' : 'Показать данные отправки'}
      </button>

      {shown ? (
        <pre className="tm-json mono" data-testid="telemetry-payload">
          {JSON.stringify(payload, null, 2)}
        </pre>
      ) : null}

      <div className="tm-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={!consent || total === 0 || busy}
          title={
            consent
              ? 'Отправить показанный payload на локальный сервер приложения'
              : 'Сначала включите «Отправлять анонимную статистику» и сохраните настройки'
          }
          onClick={async () => {
            setBusy(true)
            const r = await sendTelemetry(consent)
            setBusy(false)
            setResult(r.ok ? 'Отправлено. Счётчики обнулены.' : r.error)
            if (r.ok) flash('Статистика отправлена, накопленное обнулено.')
          }}
          data-testid="telemetry-send"
        >
          {busy ? 'Отправляю…' : 'Отправить сейчас'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={total === 0}
          onClick={() => {
            clearTelemetry()
            setResult(null)
            flash('Накопленная статистика стёрта.')
          }}
          data-testid="telemetry-clear"
        >
          Очистить накопленное
        </button>
      </div>

      <div className="setting-note" data-testid="telemetry-status">
        {result
          ? result
          : consent
            ? state.lastSentAt
              ? `Последняя отправка: ${new Date(state.lastSentAt).toLocaleString('ru-RU')} · всего ${state.sent}`
              : 'Согласие дано. Ничего ещё не отправлялось — отправка только по кнопке.'
            : 'Согласие не дано: отправка недоступна, накопленное никуда не уходит.'}
      </div>
    </div>
  )
}

export function ScreenSettings() {
  /* Узкие подписки вместо общего фасада: экран настроек живёт на домене
     настроек, а из остальных берёт ровно то, что показывает. */
  const S = useSettingsStore()
  const D = useDataStore()
  const N = useNotifsStore()
  const NAV = useNavStore()
  const { flash } = useToast()
  const engine = useEngineStore()
  const idxs = useIndexSummary()
  const idxa = useIndexActions()
  /* LG-5: переиндексация — мутация: двойной клик даёт один прогон. */
  const M = useMutations()
  const d = S.draftSettings
  const account = useAccount()
  const SECTIONS = useMemo(
    () => ALL_SECTIONS.filter((sec) => !SECTION_FEATURE[sec.id] || account.has(SECTION_FEATURE[sec.id])),
    [account],
  )
  const [active, setActive] = useState('engine')
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigationTarget = useRef<string | null>(null)
  const scale = useSyncExternalStore(subscribeScale, getScale, () => SCALE_DEFAULT)
  const previousScale = useRef(scale)
  const [confirmWipe, setConfirmWipe] = useState(false)

  // Масштаб меняет высоту всех предыдущих секций: удерживаем текущий раздел,
  // а не старое числовое смещение прокрутки.
  useLayoutEffect(() => {
    if (previousScale.current === scale) return
    previousScale.current = scale
    navigationTarget.current = active
    scrollToSection(scrollRef.current, active)
  }, [scale, active])

  /** Подсветка рельса: активен последний раздел, чья шапка прошла верх области. */
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return

    function onScroll() {
      if (navigationTarget.current) {
        setActive(navigationTarget.current)
        return
      }
      const bounds = root!.getBoundingClientRect()
      const zoom = bounds.width / root!.offsetWidth
      const top = bounds.top + 28 * zoom
      let current = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(`set-${s.id}`)
        if (el && el.getBoundingClientRect().top <= top) current = s.id
      }
      // Последний короткий раздел не всегда можно довести до верхнего края.
      if (root!.scrollHeight - root!.clientHeight - root!.scrollTop < 2) {
        current = SECTIONS[SECTIONS.length - 1].id
      }
      setActive(current)
    }

    onScroll()
    const releaseTarget = () => { navigationTarget.current = null }
    root.addEventListener('scroll', onScroll, { passive: true })
    root.addEventListener('wheel', releaseTarget, { passive: true })
    root.addEventListener('touchstart', releaseTarget, { passive: true })
    root.addEventListener('pointerdown', releaseTarget)
    root.addEventListener('keydown', releaseTarget)
    return () => {
      root.removeEventListener('scroll', onScroll)
      root.removeEventListener('wheel', releaseTarget)
      root.removeEventListener('touchstart', releaseTarget)
      root.removeEventListener('pointerdown', releaseTarget)
      root.removeEventListener('keydown', releaseTarget)
    }
  }, [SECTIONS])

  /** Переход из поиска, палитры или колокольчика ведёт в нужный раздел. */
  useEffect(() => {
    if (!NAV.settingFocus) return
    /* LG-3: ссылка из уведомления приходит как `journal:<id записи>`. */
    const raw = NAV.settingFocus.id.split(':')[0]
    const id = FOCUS_ALIAS[raw] ?? 'engine'
    const el = document.getElementById(`set-${id}`)
    navigationTarget.current = id
    scrollToSection(scrollRef.current, id)
    el?.classList.add('sec-flash')
    const t = setTimeout(() => el?.classList.remove('sec-flash'), 1200)
    setActive(id)
    return () => clearTimeout(t)
  }, [NAV.settingFocus])

  function goTo(id: string) {
    navigationTarget.current = id
    scrollToSection(scrollRef.current, id)
    setActive(id)
  }

  function flip(id: ToggleId) {
    S.setDraftSettings((s) => ({ ...s, toggles: { ...s.toggles, [id]: !s.toggles[id] } }))
  }

  const notifyOn = NOTIFY_TOGGLES.filter((t) => d.toggles[t.id]).length
  const { stats, mix } = D

  /** Шаги конвейера — снимок настоящего состояния корпуса. */
  const steps = useMemo(
    () => [
      {
        Icon: IconInbox,
        name: 'Приём',
        status: `${stats.files} ${plural(stats.files, 'файл', 'файла', 'файлов')}`,
        warn: false,
      },
      {
        Icon: IconSparkText,
        name: 'Распознавание',
        status: S.settings.toggles.ocr ? 'OCR недоступен' : 'OCR выключен',
        warn: true,
      },
      {
        Icon: IconTag,
        name: 'Автотеги',
        status: S.settings.toggles.autotag
          ? stats.processing > 0
            ? `${stats.processing} в очереди`
            : 'очередь пуста'
          : 'выключены',
        warn: !S.settings.toggles.autotag || stats.processing > 0,
      },
      {
        Icon: IconMemory,
        name: 'Карта памяти',
        status: `${stats.links} связей`,
        warn: stats.links === 0,
      },
    ],
    [stats.files, stats.links, stats.processing, S.settings.toggles.autotag, S.settings.toggles.ocr],
  )

  function rows(list: { id: ToggleId; title: string; note: string }[]) {
    return (
      <div className="rows-list">
        {list.map((t) => (
          <div className="setting-row" key={t.id} data-testid={`setting-row-${t.id}`}>
            <div className="setting-row-text">
              <div className="setting-title" data-testid={`setting-title-${t.id}`}>{t.title}</div>
              <div className="setting-note" id={`setting-note-${t.id}`} data-testid={`setting-note-${t.id}`}>{t.note}</div>
            </div>
            <button
              className={`toggle${d.toggles[t.id] ? ' on' : ''}`}
              role="switch"
              aria-checked={d.toggles[t.id]}
              aria-label={t.title}
              aria-describedby={`setting-note-${t.id}`}
              data-testid={`toggle-${t.id}`}
              onClick={() => flip(t.id)}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="set-page" role="main" aria-label="Настройки" data-testid="settings-page">
      <div className="set-mobile-nav" data-testid="settings-mobile-navigation">
        <label htmlFor="settings-section-select" data-testid="settings-section-label">Раздел настроек</label>
        <select id="settings-section-select" className="select" value={active} onChange={(e) => goTo(e.target.value)} data-testid="settings-section-select">
          {SECTION_GROUPS.map((group) => {
            const items = SECTIONS.filter((section) => group.ids.includes(section.id))
            return items.length > 0 && <optgroup key={group.id} label={group.label || 'Опасная зона'}>
              {items.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
            </optgroup>
          })}
        </select>
      </div>
      <div className="scroll-col" ref={scrollRef} data-testid="settings-scroll">
        <div className="set-shell">
          <aside className="set-rail" aria-label="Разделы настроек">
            <div className="set-rail-inner">
              <nav className="set-rail-nav" aria-label="Разделы настроек" data-testid="settings-navigation">
                {SECTION_GROUPS.map((group) => <div className="set-nav-group" key={group.id}>
                  {group.label && SECTIONS.some((s) => group.ids.includes(s.id)) && <div className="set-nav-group-label" data-testid={`settings-nav-group-${group.id}`}>{group.label}</div>}
                {SECTIONS.filter((s) => group.ids.includes(s.id)).map((s) => (
                  <button
                    key={s.id}
                    className={`set-rail-item${active === s.id ? ' on' : ''}${
                      s.id === 'danger' ? ' danger' : ''
                    }`}
                    onClick={() => goTo(s.id)}
                    aria-current={active === s.id ? 'true' : undefined}
                    aria-controls={`set-${s.id}`}
                    data-testid={`settings-nav-${s.id}`}
                  >
                    <s.Icon />
                    <span>{s.label}</span>
                  </button>
                ))}
                </div>)}
              </nav>
            </div>
          </aside>

          <div className="set-main">
            <div className="set-hero" data-testid="settings-header">
              <div className="set-hero-top">
                <div>
                  <h1 data-testid="settings-title">Настройки</h1>
                  <p className="page-sub" data-testid="settings-description">
                    Параметры рабочего пространства и доступа.
                  </p>
                </div>
                {/* NF-2: бейдж не обещает локальный режим, если движок молчит. */}
                {account.has('ai') && <span
                  className="badge set-hero-badge"
                  data-testid="settings-hero-badge"
                >
                  ИИ · {engine.engineView.label}
                </span>}
              </div>
            </div>

            {account.has('ai') && <AiProviderSection />}

            <UiScaleSection />


            <section className="sec panel" id="set-pipeline" data-testid="settings-pipeline-section">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconPipeline />
                </span>
                <div className="sec-head-text">
                  <h2 className="setting-title" data-testid="settings-pipeline-title">Конвейер обработки</h2>
                  <div className="setting-note">
                    Путь файла от появления до связи на карте памяти
                  </div>
                </div>
                <span className="sec-meta label-mono num">
                  {stats.processing > 0 ? `${stats.processing} в очереди` : 'очередь пуста'}
                </span>
              </div>

              {/* Конвейер занят — стрелки между шагами текут акцентным пунктиром. */}
              <div className={`pipeline${stats.processing > 0 ? ' busy' : ''}`}>
                {steps.map((s, i) => (
                  <div key={s.name} style={{ display: 'contents' }}>
                    {i > 0 && (
                      <div className="flow-sep" aria-hidden="true">
                        <IconArrowRight />
                      </div>
                    )}
                    <div className="step">
                      <span className="step-icon">
                        <s.Icon />
                      </span>
                      <span className="step-name">{s.name}</span>
                      <span className={`step-status${s.warn ? ' warn' : ''}`}>
                        <i />
                        {s.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sec-split" />
              {rows(PIPELINE_TOGGLES)}
            </section>

            <section className="sec panel" id="set-notify" data-testid="settings-notify-section">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconBell />
                </span>
                <div className="sec-head-text">
                  <h2 className="setting-title" data-testid="settings-notify-title">Уведомления</h2>
                  <div className="setting-note">
                    О чём колокольчик в шапке сообщает и что остаётся в журнале
                  </div>
                </div>
                <span className="sec-meta label-mono num">{notifyOn} из 3</span>
              </div>

              {rows(NOTIFY_TOGGLES)}

              <div className="sec-note">
                В журнале сейчас {N.notifs.length}{' '}
                {plural(N.notifs.length, 'событие', 'события', 'событий')}
                {N.unread > 0 ? `, из них ${N.unread} непрочитанных` : ', все прочитаны'}. Журнал
                хранится в сейфе и никуда не отправляется: ни push, ни почта, ни внешние сервисы.
              </div>
            </section>

            <section className="sec panel" id="set-storage" data-testid="settings-storage-section">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconDatabase />
                </span>
                <div className="sec-head-text">
                  <h2 className="setting-title" data-testid="settings-storage-title">Хранилище</h2>
                  <div className="setting-note">Расположение сейфа и объём индекса</div>
                </div>
                <span className="sec-meta label-mono num">{fmtBytes(stats.bytes)}</span>
              </div>

              <div className="field-block" style={{ marginTop: 0 }}>
                <span className="label-mono">Папка сейфа</span>
                <div className="folder-row">
                  <input
                    className="input input-mono"
                    value={d.folder}
                    onChange={(e) => S.setDraftSettings((s) => ({ ...s, folder: e.target.value }))}
                    aria-label="Папка сейфа"
                    data-testid="settings-folder"
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    data-testid="set-pick-folder"
                    onClick={() =>
                      idxs.fsaSupported
                        ? void idxa.connectFolder()
                        : flash(
                            'Браузер не даёт доступ к папке: выберите файлы кнопкой «Добавить файл» — содержимое всё равно прочитается локально.',
                          )
                    }
                  >
                    <IconFolder />
                    Выбрать
                  </button>
                  <button
                    className="btn btn-tertiary btn-sm"
                    data-testid="set-reindex"
                    disabled={idxs.busy || M.isPending('vault:reindex')}
                    onClick={() =>
                      void M.runExclusive('vault:reindex', () => D.reindexAll(), {
                        errorMessage: 'Переиндексация не прошла. Прежний индекс на месте.',
                      })
                    }
                  >
                    <IconRefresh />
                    {M.isPending('vault:reindex') ? 'Идёт…' : 'Переиндексировать'}
                  </button>
                </div>
                <div className="sec-note">
                  {idxs.indexedCount > 0
                    ? `Индекс содержимого: ${idxs.indexedCount} файлов прочитано локально${idxs.folder ? ` из «${idxs.folder}»` : ''}. OCR в продукте нет: сканы помечаются «без текстового слоя».`
                    : 'Индекса содержимого нет: подключите папку — файлы прочитаются в фоновом воркере, ни один байт не уйдёт наружу.'}
                </div>
              </div>

              <div className="field-block">
                <span className="label-mono">Из чего состоит сейф</span>
                {mix.length === 0 ? (
                  <div className="stat-line set-empty" data-testid="settings-storage-empty">В сейфе пока нет файлов.</div>
                ) : (
                  <>
                    <div className="mix-bar" role="img" aria-label="Состав хранилища по категориям">
                      {mix.map((m) => (
                        <i
                          key={m.id}
                          style={{ width: `${m.pct}%`, background: `rgba(${m.rgb},.85)` }}
                        />
                      ))}
                    </div>
                    <div className="mix-legend">
                      {mix.map((m) => (
                        <span className="mix-item" key={m.id}>
                          <i style={{ background: `rgba(${m.rgb},.85)` }} />
                          <span className="mix-label">{m.label}</span>
                          <b className="num">{fmtBytes(m.bytes)}</b>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <div className="stat-line">
                  {stats.files} {plural(stats.files, 'файл', 'файла', 'файлов')} · {fmtBytes(stats.bytes)} · индекс{' '}
                  <b className="num">{stats.links} связей</b>
                </div>
              </div>
            </section>

            <section className="sec panel" id="set-privacy" data-testid="settings-privacy-section">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconShield />
                </span>
                <div className="sec-head-text">
                  <h2 className="setting-title" data-testid="settings-privacy-title">Приватность</h2>
                  <div className="setting-note">
                    Что видно на экране и что уходит за пределы устройства
                  </div>
                </div>
                <span className="sec-meta label-mono">
                  {engine.engineView.isCloud ? 'внешний ИИ' : 'локальный ИИ'}
                </span>
              </div>

              {rows(PRIVACY_TOGGLES)}

              <div className="setting-row" data-testid="cloud-consent-row">
                <div className="setting-row-text">
                  <div className="setting-title">Согласие на облачные запросы</div>
                  <div className="setting-note">
                    {S.settings.cloudConsentAt
                      ? `Дано ${new Date(S.settings.cloudConsentAt).toLocaleString('ru-RU')}. Каждый облачный ход пишется в ленту событий.`
                      : 'Не дано: перед первым запросом во внешнюю модель спросим и покажем, что именно уйдёт.'}
                  </div>
                </div>
                {S.settings.cloudConsentAt ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={S.revokeCloudConsent}
                    data-testid="revoke-consent"
                  >
                    Отозвать
                  </button>
                ) : (
                  <span className="badge badge-ok">спросим заранее</span>
                )}
              </div>

              <TelemetryPanel />

              <div className="field-block">
                <div className="mask-head">
                  <span className="label-mono">Пример скрытия</span>
                  <span className="mask-flag">
                    <IconShield width={11} height={11} aria-hidden="true" focusable="false" />
                    <span className="mask-flag-text">
                      {d.toggles.redact ? 'маскируется локально' : 'маскировка выключена'}
                    </span>
                  </span>
                </div>
                <div className="mask-demo">
                  <span className="mask-key mono">ИНН</span>
                  {d.toggles.redact ? (
                    <span className="mask-value" role="img" aria-label="Значение скрыто маской">
                      {[0, 1, 2].map((g) => (
                        <span className="mask-group" key={g}>
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="mask-value mono">7712 3456 7890</span>
                  )}
                  <span className="mask-hint">
                    12 знаков · {d.toggles.redact ? 'не покидает устройство' : 'видно в превью'}
                  </span>
                </div>
              </div>
            </section>

            <SecuritySection />
            {account.has('secrets') && <SecretsSection />}
            {account.has('offline') && <BackupSection />}
            {account.has('offline') && <FlagsSection />}
            {account.has('mcp') && <McpSection />}
            {account.has('sync') && <SyncSection />}
            {account.has('cloud') && <CloudSection />}
            <JournalPanel />

            <section className="sec panel danger-zone" id="set-danger" data-testid="settings-danger-section">
              <div className="sec-head">
                <span className="sec-icon">
                  <IconTrash />
                </span>
                <div className="sec-head-text">
                  <h2 className="setting-title" data-testid="settings-danger-title">Опасная зона</h2>
                  <div className="setting-note">Действия необратимы и затрагивают весь индекс</div>
                </div>
                <span className="sec-meta label-mono">без отмены</span>
              </div>

              <div className="rows-list">
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-title">Очистить ИИ-индекс</div>
                    <div className="setting-note">
                      Файлы останутся на диске, но связи и описания придётся построить заново
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={stats.files === 0}
                    onClick={D.clearIndex}
                    data-testid="settings-clear-index"
                  >
                    Очистить индекс
                  </button>
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-title">Удалить сейф целиком</div>
                    <div className="setting-note">
                      {stats.files} {plural(stats.files, 'файл', 'файла', 'файлов')},{' '}
                      {fmtBytes(stats.bytes)} и все заметки будут стёрты
                    </div>
                  </div>
                  {confirmWipe ? (
                    <span className="save-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setConfirmWipe(false)}
                        data-testid="settings-delete-vault-cancel"
                      >
                        Отмена
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          setConfirmWipe(false)
                          D.wipeVault()
                        }}
                        data-testid="settings-delete-vault-confirm"
                      >
                        Да, стереть
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={stats.files === 0}
                      onClick={() => setConfirmWipe(true)}
                      data-testid="settings-delete-vault"
                    >
                      Удалить сейф
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer className="set-footer">
        <div className="save-bar" data-testid="settings-save-bar">
          <span className={`save-hint${S.dirty ? ' dirty' : ''}`} role="status" data-testid="settings-save-status">
            <i />
            {S.dirty ? 'Есть несохранённые изменения' : 'Нет несохранённых изменений'}
          </span>
          <div className="save-actions">
            <button
              className="btn btn-ghost btn-sm"
              disabled={!S.dirty}
              onClick={S.revertSettings}
              data-testid="settings-revert"
            >
              Отменить
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!S.dirty}
              onClick={S.saveSettings}
              data-testid="settings-save"
            >
              Сохранить
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
